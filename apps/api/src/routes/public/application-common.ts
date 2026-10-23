import { z } from '@hono/zod-openapi';
import { createChallenge, verifySolution, type Challenge, type Solution } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/web/pbkdf2';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Context } from 'hono';

import type { AppEnv } from '../../index';

/**
 * 公開報名（#1123）與公開試聽（#1124）共用：申請人欄位的驗證、寫入 `public_applications`＋targets。
 * 兩張表單的家長／學生欄位一樣（`specs/public/enrollment.md`、`trial.md`），各寫一份遲早會漂。
 */

const GRADES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'J1', 'J2', 'J3', 'S1', 'S2', 'S3'] as const;

/** 台灣手機：去掉空白與連字號後是 09 開頭 10 碼 */
const MobileSchema = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^09\d{8}$/, '手機號碼格式不正確'));

const text = (max: number) => z.string().trim().min(1).max(max);

/** 兩張表單共同的欄位；各自再加選班／選課程 */
export const ApplicantFields = {
  parent: z.object({
    name: text(50),
    // 轉小寫（#1335，使用者 10-23 裁）：寫入與限流比對同源。舊資料不 backfill，比對端用 ilike 接住
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    phone: MobileSchema.optional(),
    relation: z.enum(['father', 'mother', 'other']),
  }),
  student: z.object({
    name: text(50),
    grade: z.enum(GRADES),
    school: text(100),
  }),
  note: z.string().trim().max(500).optional(),
  /** 個資同意；沒勾不收 */
  consent: z.literal(true),
  /** honeypot（#1126）：前端藏起來的欄位，真人不會填。有值就回假成功、不寫 */
  website: z.string().max(500).optional(),
  /**
   * 機器人驗證（#1665）：`CAPTCHA_PROVIDER=altcha`（預設）時是 ALTCHA widget 交出的 payload，
   * `turnstile` 時是 Turnstile token。哪一種由 `GET /api/public/captcha` 告訴前端。
   */
  captchaToken: z.string().max(4096).optional(),
};

/**
 * 速率限制（#1126，計畫席裁：數字是起點、可調）。計數直接數 `public_applications` ——
 * c12 不准用 Workers KV／Durable Objects／Cloudflare Rate Limiting。
 */
export const RATE_LIMITS = {
  /** 同一來源（IP hash）一小時內，報名＋試聽合計 */
  perSourcePerHour: 5,
  /** 同一聯絡方式（手機或 Email）24 小時內，同類型 */
  perContactPerDay: 3,
} as const;

/** 只存 HMAC：數得出「同一個來源」，表裡沒有可還原的 IP（個資） */
export async function hashClientIp(ip: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(ip));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 來源 IP：Workers 的 `CF-Connecting-IP` → `X-Real-IP` → `X-Forwarded-For` 第一段；都沒有回 null（只剩聯絡方式那條限制）。
 * ⚠️ Node 自架前面沒有會覆寫這些標頭的反向代理時，它們可以偽造（見 deploying.md）。
 */
export function clientIp(c: Context<AppEnv>): string | null {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? (forwarded || null);
}

const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * 機器人驗證用哪一家（#1665，使用者 10-16 15:38 裁）：預設 ALTCHA（自架 PoW、不連外，c12），
 * 部署可設 `CAPTCHA_PROVIDER=turnstile` 改走 Cloudflare Turnstile。**兩種都不能被略過**：
 * 設成 turnstile 卻沒設金鑰、或設了不認得的值，一律 503 拒收，不退回「不驗」。
 */
export function captchaProvider(c: Context<AppEnv>): 'altcha' | 'turnstile' | null {
  const v = c.env.CAPTCHA_PROVIDER?.trim().toLowerCase() || 'altcha';
  return v === 'altcha' || v === 'turnstile' ? v : null;
}

/**
 * ALTCHA 金鑰：`ALTCHA_HMAC_KEY`，沒設就從 `BETTER_AUTH_SECRET` 衍生（同 IP 雜湊的做法）——
 * 所以自架的人少設一個變數也不會變成沒有驗證。題目簽章與 derived key 簽章用兩把不同的鑰。
 */
export async function altchaSecrets(env: { ALTCHA_HMAC_KEY?: string; BETTER_AUTH_SECRET: string }) {
  const base = env.ALTCHA_HMAC_KEY?.trim() || env.BETTER_AUTH_SECRET;
  return {
    hmacSignatureSecret: await hashClientIp('altcha-challenge', base),
    hmacKeySignatureSecret: await hashClientIp('altcha-key', base),
  };
}

/**
 * 出題參數：PBKDF2/SHA-256、10 分鐘過期照 altcha-lib 官方範例；cost 與 counter 是 #1665 PR-4 量出來的：
 * Playwright、360 寬、CDP CPU 降速 4 倍、開發版 build，從拿到題目到畫面寫「已通過」——
 * - 官方範例的 cost 5000：Node 單執行緒就要 4.7 秒（PR-2）
 * - cost 1000／counter 5000–10000：14–18 秒
 * - cost 1000／counter 500–1000：中位 4.3 秒（2.4–5.1）
 * - **cost 500／counter 300–600：中位 2.0 秒、最慢 2.5 秒；不降速 0.3–0.4 秒** ← 採用
 * 每一次嘗試是一次 WebCrypto 呼叫，呼叫開銷大於 PBKDF2 本身，所以降 counter 比降 cost 有效。
 * PoW 只是減速帶，擋量靠速率限制（RATE_LIMITS）。
 * 確定式模式（帶 counter＋key 簽章）：伺服器出題算一次 PBKDF2、驗證只做 HMAC，Workers 的 CPU 吃得下。
 * 演算法用 WebCrypto 版（`algorithms/web/*`）—— Workers 與 Node 都有 `crypto.subtle`。
 */
export const ALTCHA_PARAMS = {
  cost: 500,
  counterMin: 300,
  counterMax: 600,
  ttlSeconds: 10 * 60,
} as const;

export async function createAltchaChallenge(c: Context<AppEnv>): Promise<Challenge> {
  const { counterMin, counterMax } = ALTCHA_PARAMS;
  const counter =
    counterMin + (crypto.getRandomValues(new Uint32Array(1))[0]! % (counterMax - counterMin));
  return createChallenge({
    algorithm: 'PBKDF2/SHA-256',
    cost: ALTCHA_PARAMS.cost,
    counter,
    deriveKey,
    expiresAt: Math.floor(Date.now() / 1000) + ALTCHA_PARAMS.ttlSeconds,
    ...(await altchaSecrets(c.env)),
  });
}

/**
 * 驗 widget 交出的 payload：base64(JSON `{ challenge: { parameters, signature }, solution }`)
 * —— altcha 3.2.4 widget 原始碼 `dist/main/altcha.js` 的 verify()。過期、簽章不符、解錯都由
 * `verifySolution` 判；格式壞掉（含 widget test 模式的 `challenge: null`）一律當沒通過。
 *
 * ponytail: 沒有重放防護 —— 同一份解答 10 分鐘內可重送；速率限制（來源每小時 5、聯絡方式每天 3）
 * 已經壓住重送能拿到的額度。出現濫用時加一張 Postgres 表記用過的 signature、過期就刪（不用 KV，c12）。
 */
export async function verifyAltchaPayload(c: Context<AppEnv>, payload: string): Promise<boolean> {
  let decoded: { challenge?: Challenge | null; solution?: Solution | null };
  try {
    decoded = JSON.parse(atob(payload));
  } catch {
    return false;
  }
  const { challenge, solution } = decoded ?? {};
  if (
    !challenge?.parameters ||
    typeof challenge.signature !== 'string' ||
    typeof solution?.counter !== 'number' ||
    typeof solution.derivedKey !== 'string'
  ) {
    return false;
  }
  try {
    const result = await verifySolution({
      challenge,
      solution,
      deriveKey,
      ...(await altchaSecrets(c.env)),
    });
    return result.verified === true;
  } catch {
    return false;
  }
}

const captchaFailed: GuardResult = {
  kind: 'reject',
  status: 400,
  body: { error: '機器人驗證沒有通過，請重試', code: 'CAPTCHA_FAILED' },
};
const captchaUnavailable: GuardResult = {
  kind: 'reject',
  status: 503,
  body: { error: '驗證服務暫時無法使用，請稍後再試', code: 'CAPTCHA_UNAVAILABLE' },
};

/** 沒通過回拒收結果；通過回 null */
async function verifyCaptcha(
  c: Context<AppEnv>,
  token: string | undefined,
  ip: string | null,
): Promise<GuardResult | null> {
  const provider = captchaProvider(c);
  if (!provider) return captchaUnavailable;
  if (provider === 'turnstile' && !c.env.TURNSTILE_SECRET_KEY?.trim()) return captchaUnavailable;
  if (!token) {
    return {
      kind: 'reject',
      status: 400,
      body: { error: '請完成機器人驗證', code: 'CAPTCHA_FAILED' },
    };
  }

  if (provider === 'altcha') return (await verifyAltchaPayload(c, token)) ? null : captchaFailed;

  const form = new FormData();
  form.append('secret', c.env.TURNSTILE_SECRET_KEY!.trim());
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch(TURNSTILE_VERIFY, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`siteverify ${res.status}`);
    const ok = ((await res.json()) as { success?: boolean }).success === true;
    return ok ? null : captchaFailed;
  } catch {
    // fail-closed：驗證服務掛了不放行
    return captchaUnavailable;
  }
}

export type GuardResult =
  | { kind: 'pass'; ipHash: string | null }
  | { kind: 'honeypot' }
  | { kind: 'reject'; status: 400; body: { error: string; code: 'CAPTCHA_FAILED' } }
  | {
      kind: 'reject';
      status: 429;
      body: { error: string; code: 'RATE_LIMITED' };
      retryAfterSeconds: number;
    }
  | {
      kind: 'reject';
      status: 503;
      body: { error: string; code: 'CAPTCHA_UNAVAILABLE' | 'RATE_LIMIT_UNAVAILABLE' };
    };

/**
 * 防濫用（#1126）。順序 honeypot → rate limit → CAPTCHA（便宜的先擋）；都過了才走原本的驗證與寫入。
 */
export async function guardSubmission(
  c: Context<AppEnv>,
  body: Applicant & { website?: string; captchaToken?: string },
  kind: 'enrollment' | 'trial',
): Promise<GuardResult> {
  if (body.website?.trim()) return { kind: 'honeypot' };

  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const ip = clientIp(c);
  const ipHash = ip ? await hashClientIp(ip, c.env.BETTER_AUTH_SECRET) : null;
  const now = Date.now();
  const rateLimited = (retryAfterSeconds: number): GuardResult => ({
    kind: 'reject',
    status: 429,
    body: { error: '送出太多次了，請稍後再試', code: 'RATE_LIMITED' },
    retryAfterSeconds,
  });

  const count = async (column: string, value: string, sinceMs: number, sameKind: boolean) => {
    // Email 不分大小寫（#1335）：新資料寫入時已轉小寫，舊資料可能有大寫 —— ilike 兩邊都接得住。
    // 值要跳脫 ilike 的萬用字元（\ % _），不然 a_b@x.test 會連 axb@x.test 一起算
    const base = supabase
      .from('public_applications')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId);
    let query =
      column === 'parent_email'
        ? base.ilike(
            column,
            value.replace(/[\\%_]/g, (ch) => `\\${ch}`),
          )
        : base.eq(column, value);
    query = query.gte('created_at', new Date(now - sinceMs).toISOString());
    if (sameKind) query = query.eq('kind', kind);
    const { count: n, error } = await query;
    // 數不出來就不知道有沒有超過 —— 回 null 讓呼叫端 fail-closed，不吞成 0 放行
    return error ? null : (n ?? 0);
  };
  const countUnavailable: GuardResult = {
    kind: 'reject',
    status: 503,
    body: { error: '暫時無法送出，請稍後再試', code: 'RATE_LIMIT_UNAVAILABLE' },
  };

  const HOUR = 60 * 60 * 1000;
  if (ipHash) {
    const n = await count('client_ip_hash', ipHash, HOUR, false);
    if (n === null) return countUnavailable;
    if (n >= RATE_LIMITS.perSourcePerHour) return rateLimited(60 * 60);
  }
  for (const [column, value] of [
    ['parent_phone', body.parent.phone],
    ['parent_email', body.parent.email],
  ] as const) {
    if (!value) continue;
    const n = await count(column, value, 24 * HOUR, true);
    if (n === null) return countUnavailable;
    if (n >= RATE_LIMITS.perContactPerDay) return rateLimited(24 * 60 * 60);
  }

  const captcha = await verifyCaptcha(c, body.captchaToken, ip);
  if (captcha) return captcha;

  return { kind: 'pass', ipHash };
}

export const ApplicationErrorSchema = z
  .object({ error: z.string(), code: z.string() })
  .openapi('PublicApplicationError');

type Applicant = {
  parent: { name: string; email?: string; phone?: string; relation: string };
  student: { name: string; grade: string; school: string };
  note?: string;
};

export const EMAIL_OR_PHONE_REQUIRED = {
  error: 'Email 或手機號碼至少填一個',
  code: 'EMAIL_OR_PHONE_REQUIRED',
} as const;
export const hasContact = (a: Applicant) => !!(a.parent.email || a.parent.phone);

/**
 * 寫一筆申請＋targets。targets 寫失敗就收回主列（沒有班／課程的申請沒有用，讓對方重送）。
 * 回申請 id；失敗回 null。
 */
export async function insertApplication(
  supabase: SupabaseClient,
  orgId: string,
  kind: 'enrollment' | 'trial',
  applicant: Applicant,
  extra: {
    preferred_start_date?: string | null;
    preferred_times?: string | null;
    client_ip_hash?: string | null;
  },
  targets: Array<{ class_id?: string; course_id?: string; is_waitlist?: boolean }>,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('public_applications')
    .insert({
      org_id: orgId,
      kind,
      parent_name: applicant.parent.name,
      parent_email: applicant.parent.email ?? null,
      parent_phone: applicant.parent.phone ?? null,
      parent_relation: applicant.parent.relation,
      student_name: applicant.student.name,
      student_grade: applicant.student.grade,
      student_school: applicant.student.school,
      preferred_start_date: extra.preferred_start_date ?? null,
      preferred_times: extra.preferred_times ?? null,
      client_ip_hash: extra.client_ip_hash ?? null,
      note: applicant.note || null,
      // 伺服器時間，不信前端
      consented_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) return null;
  const applicationId = (data as { id: string }).id;

  const { error: targetsError } = await supabase.from('public_application_targets').insert(
    targets.map((t) => ({
      application_id: applicationId,
      class_id: t.class_id ?? null,
      course_id: t.course_id ?? null,
      is_waitlist: t.is_waitlist ?? false,
    })),
  );
  if (targetsError) {
    await supabase.from('public_applications').delete().eq('id', applicationId).eq('org_id', orgId);
    return null;
  }
  return applicationId;
}
