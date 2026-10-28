import type { Pool, PoolClient } from 'pg';

import type { CampusScope } from './campus-scope';
import { withTx } from './pg-tx';

/**
 * 可作廢的到班卡（#1100 #42；schema `20261023034347_checkin_cards.sql`）。
 *
 * 一張卡一個隨機代碼，補發＝作廢舊的＋開新的（同一個交易）。印卡、補發、作廢都走 pg 池：
 * - 補發是兩步寫入，要全有或全無（`kb/wiki/architecture/pg-pool-writes.md` 規則 1）
 * - 批次印卡的分校範圍一句 SQL 判完 —— 逐位 `studentWriteScope` 每位兩個 subrequest，
 *   一頁 20 位就撞 Workers 的 50 上限；`.in()` 塞幾百個 uuid 又會 414
 *
 * **卡片 org＝學生 org 由這裡守**（DB 沒有約束）：每句都先用 `org_id = $1` 鎖學生，
 * 鎖到的才開卡，開卡的 `org_id` 用同一個 `$1`。
 */

/** Crockford base32（去掉 I L O U）。DB 的 CHECK 是同一組字元 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CARD_CODE_RE = /^CK1-[0-9A-HJKMNP-TV-Z]{16}$/;

/** `CK1-`＋16 位（80 bit）。32 整除 256，取模沒有偏差 */
export function generateCardCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return 'CK1-' + Array.from(bytes, (b) => ALPHABET[b % 32]).join('');
}

/**
 * 掃到或手打的代碼 → DB 的正規形式（不分組）。卡面印 `CK1-XXXX-XXXX-XXXX-XXXX`，
 * 手打可能小寫、少打或多打連字號；Crockford 的 I/L 讀成 1、O 讀成 0。不合格式回 null。
 */
export function normalizeCardCode(raw: string): string | null {
  const flat = raw.toUpperCase().replace(/[\s-]/g, '');
  if (!flat.startsWith('CK1')) return null;
  const body = flat.slice(3).replace(/[IL]/g, '1').replace(/O/g, '0');
  const code = `CK1-${body}`;
  return CARD_CODE_RE.test(code) ? code : null;
}

export interface CardActor {
  orgId: string;
  userId: string;
  scope: CampusScope;
}

interface LockedStudent {
  id: string;
  name: string;
  active_code: string | null;
}

/**
 * 交易裡鎖住這些學生（`FOR UPDATE`，同一位學生的印卡／補發／作廢因此排隊），順便讀出有效卡。
 * 範圍判準跟 `studentWriteScope` 同一份：有任何一筆報名的班級在範圍內就算。
 * 回傳筆數少於要求的 → 有人不在 org 或不在範圍，呼叫端整批 404（pg-pool-writes 規則 4）。
 */
async function lockStudents(
  db: PoolClient,
  { orgId, scope }: CardActor,
  studentIds: readonly string[],
): Promise<LockedStudent[]> {
  const { rows } = await db.query<LockedStudent>(
    `SELECT s.id, s.name,
            (SELECT k.code FROM checkin_cards k
              WHERE k.org_id = $1 AND k.student_id = s.id AND k.revoked_at IS NULL) AS active_code
       FROM students s
      WHERE s.org_id = $1 AND s.id = ANY($2::uuid[])
        AND ($3::uuid[] IS NULL OR EXISTS (
              SELECT 1 FROM enrollments e JOIN classes cl ON cl.id = e.class_id
               WHERE e.org_id = $1 AND e.student_id = s.id AND cl.campus_id = ANY($3::uuid[])))
      ORDER BY s.id
        FOR UPDATE OF s`,
    [orgId, [...new Set(studentIds)], scope === null ? null : [...scope]],
  );
  return rows;
}

async function insertCard(db: PoolClient, { orgId, userId }: CardActor, studentId: string) {
  const code = generateCardCode();
  await db.query(
    `INSERT INTO checkin_cards (org_id, student_id, code, issued_by) VALUES ($1, $2, $3, $4)`,
    [orgId, studentId, code, userId],
  );
  return code;
}

/** 23505 撞到的是代碼唯一索引（80 bit 隨機，理論上不會）—— 整個交易重來一次，重抽代碼 */
const isCodeCollision = (err: unknown) =>
  (err as { code?: string; constraint?: string } | null)?.code === '23505' &&
  (err as { constraint?: string }).constraint === 'checkin_cards_code_key';

async function txWithCodeRetry<T>(pool: Pool, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTx(pool, fn);
    } catch (err) {
      if (attempt >= 3 || !isCodeCollision(err)) throw err;
    }
  }
}

export interface PrintedCard {
  studentId: string;
  studentName: string;
  code: string;
  /** 這次才開的（之前沒有有效卡）；false＝重印同一張 */
  issued: boolean;
}

export type PrintResult =
  | { ok: true; cards: PrintedCard[] }
  | { ok: false; reason: 'NOT_FOUND' }
  /** 有人還沒有有效卡、而呼叫者只能重印（計畫席 10-28：新開＝發身分憑證，要 manage_students） */
  | { ok: false; reason: 'NEEDS_ISSUE'; studentIds: string[] };

/**
 * 印卡：已有有效卡就回那張（**重印不換碼**），沒有就開一張。`canIssue` 是「能新開卡嗎」，
 * 不能而又有人需要新開 → 整批不動，回 `NEEDS_ISSUE`。
 */
export function printCards(
  pool: Pool,
  actor: CardActor,
  studentIds: readonly string[],
  canIssue: boolean,
): Promise<PrintResult> {
  return txWithCodeRetry(pool, async (db): Promise<PrintResult> => {
    const locked = await lockStudents(db, actor, studentIds);
    if (locked.length !== new Set(studentIds).size) return { ok: false, reason: 'NOT_FOUND' };

    const missing = locked.filter((s) => !s.active_code).map((s) => s.id);
    if (missing.length > 0 && !canIssue) {
      return { ok: false, reason: 'NEEDS_ISSUE', studentIds: missing };
    }
    const byId = new Map(locked.map((s) => [s.id, s]));
    const cards: PrintedCard[] = [];
    // 照呼叫端給的順序回（卡片照列表順序印）
    for (const id of new Set(studentIds)) {
      const s = byId.get(id)!;
      const code = s.active_code ?? (await insertCard(db, actor, id));
      cards.push({ studentId: id, studentName: s.name, code, issued: !s.active_code });
    }
    return { ok: true, cards };
  });
}

export type ReissueResult =
  | { ok: true; studentName: string; code: string; revokedCode: string | null }
  | { ok: false; reason: 'NOT_FOUND' };

/** 補發：作廢這位學生的有效卡＋開新卡，同一個交易。舊卡從 COMMIT 起失效 */
export function reissueCard(
  pool: Pool,
  actor: CardActor,
  studentId: string,
  reason: string,
): Promise<ReissueResult> {
  return txWithCodeRetry(pool, async (db): Promise<ReissueResult> => {
    const [s] = await lockStudents(db, actor, [studentId]);
    if (!s) return { ok: false, reason: 'NOT_FOUND' };
    const revokedCode = await revokeActive(db, actor, studentId, reason);
    const code = await insertCard(db, actor, studentId);
    return { ok: true, studentName: s.name, code, revokedCode };
  });
}

export type RevokeResult =
  | { ok: true; studentName: string; revokedCode: string }
  | { ok: false; reason: 'NOT_FOUND' | 'NO_ACTIVE_CARD' };

/** 只作廢、不補發（遺失、退班） */
export function revokeCard(
  pool: Pool,
  actor: CardActor,
  studentId: string,
  reason: string,
): Promise<RevokeResult> {
  return withTx(pool, async (db): Promise<RevokeResult> => {
    const [s] = await lockStudents(db, actor, [studentId]);
    if (!s) return { ok: false, reason: 'NOT_FOUND' };
    const revokedCode = await revokeActive(db, actor, studentId, reason);
    if (!revokedCode) return { ok: false, reason: 'NO_ACTIVE_CARD' };
    return { ok: true, studentName: s.name, revokedCode };
  });
}

async function revokeActive(
  db: PoolClient,
  { orgId, userId }: CardActor,
  studentId: string,
  reason: string,
): Promise<string | null> {
  const { rows } = await db.query<{ code: string }>(
    `UPDATE checkin_cards SET revoked_at = now(), revoked_by = $3, revoke_reason = $4
      WHERE org_id = $1 AND student_id = $2 AND revoked_at IS NULL
      RETURNING code`,
    [orgId, studentId, userId, reason],
  );
  return rows[0]?.code ?? null;
}
