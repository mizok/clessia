import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateCardCode, normalizeCardCode } from '../lib/checkin-cards';

/**
 * #1100 #42 到班卡的路由層：權限怎麼分（重印 vs 新開）、錯誤怎麼對成 HTTP、稽核有沒有寫。
 * SQL（org、分校範圍、交易、一人一張有效卡）在 `contract/checkin-cards.contract.ts` 對真 Postgres 驗。
 */

const lib = vi.hoisted(() => ({
  printCards: vi.fn(),
  reissueCard: vi.fn(),
  revokeCard: vi.fn(),
}));
vi.mock('../lib/checkin-cards', async (orig) => ({
  ...(await orig<typeof import('../lib/checkin-cards')>()),
  ...lib,
}));
const audits = vi.hoisted(() => [] as Array<{ action: string; details: unknown }>);
vi.mock('../utils/audit', () => ({
  logAudit: (_db: unknown, entry: { action: string; details: unknown }) => audits.push(entry),
}));

const scope = vi.hoisted(() => ({ result: 'ok' as 'ok' | 'not-found' | 'out-of-scope' }));
vi.mock('../lib/campus-write-guard', () => ({
  studentWriteScope: async () => scope.result,
}));

const { default: route } = await import('./checkin-cards');

const STUDENT = '00000000-0000-4000-8000-0000000000b1';

function createApp(permissions: string[], pool: unknown = {}, supabase: unknown = {}) {
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('orgId', 'org-1');
    set('userId', 'user-1');
    set('roles', ['admin']);
    set('permissions', permissions);
    set('campusScope', null);
    set('auth', { pool });
    set('supabase', supabase);
    await next();
  });
  app.route('/api/checkin-cards', route);
  return app;
}
const post = (app: Hono, path: string, body: object) =>
  app.request(`/api/checkin-cards${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  audits.length = 0;
});

describe('POST /print —— 重印 basic_operations、新開要 manage_students（計畫席 10-28）', () => {
  it('只有 basic_operations：以「不能新開」去印，lib 說有人要新開 → 403 並列出是誰', async () => {
    lib.printCards.mockResolvedValue({ ok: false, reason: 'NEEDS_ISSUE', studentIds: [STUDENT] });
    const res = await post(createApp(['basic_operations']), '/print', { studentIds: [STUDENT] });

    expect(lib.printCards.mock.calls[0]![3]).toBe(false);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: 'NEEDS_MANAGE_STUDENTS',
      studentIds: [STUDENT],
    });
    expect(audits).toHaveLength(0);
  });

  it('有 manage_students（或 *）：可以新開', async () => {
    lib.printCards.mockResolvedValue({ ok: true, cards: [] });
    await post(createApp(['manage_students']), '/print', { studentIds: [STUDENT] });
    await post(createApp(['*']), '/print', { studentIds: [STUDENT] });
    expect(lib.printCards.mock.calls.map((call) => call[3])).toEqual([true, true]);
  });

  it('每張卡一筆稽核，新開與重印分開記', async () => {
    lib.printCards.mockResolvedValue({
      ok: true,
      cards: [
        { studentId: STUDENT, studentName: '甲', code: 'CK1-X', issued: true },
        { studentId: 'b2', studentName: '乙', code: 'CK1-Y', issued: false },
      ],
    });
    const res = await post(createApp(['manage_students']), '/print', { studentIds: [STUDENT] });
    expect(res.status).toBe(200);
    expect(audits.map((a) => a.action)).toEqual(['issue_checkin_card', 'reprint_checkin_card']);
  });

  it('有人不在 org／分校範圍：404', async () => {
    lib.printCards.mockResolvedValue({ ok: false, reason: 'NOT_FOUND' });
    const res = await post(createApp(['*']), '/print', { studentIds: [STUDENT] });
    expect(res.status).toBe(404);
  });

  it('沒有 pg 池：500，不退回別的寫法', async () => {
    const res = await post(createApp(['*'], null), '/print', { studentIds: [STUDENT] });
    expect(res.status).toBe(500);
    expect(lib.printCards).not.toHaveBeenCalled();
  });
});

describe('補發／作廢：manage_students', () => {
  it('只有 basic_operations：兩支都 403，沒碰資料', async () => {
    const app = createApp(['basic_operations']);
    expect((await post(app, `/${STUDENT}/reissue`, { reason: '遺失' })).status).toBe(403);
    expect((await post(app, `/${STUDENT}/revoke`, { reason: '遺失' })).status).toBe(403);
    expect(lib.reissueCard).not.toHaveBeenCalled();
    expect(lib.revokeCard).not.toHaveBeenCalled();
  });

  it('補發：回新代碼，稽核記理由、不記代碼', async () => {
    lib.reissueCard.mockResolvedValue({
      ok: true,
      studentName: '甲',
      code: 'CK1-NEW',
      revokedCode: 'CK1-OLD',
    });
    const res = await post(createApp(['manage_students']), `/${STUDENT}/reissue`, {
      reason: '遺失',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ studentId: STUDENT, studentName: '甲', code: 'CK1-NEW' });
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'reissue_checkin_card',
        details: { reason: '遺失', revokedPrevious: true },
      }),
    ]);
  });

  it('理由必填', async () => {
    const app = createApp(['manage_students']);
    expect((await post(app, `/${STUDENT}/reissue`, { reason: '  ' })).status).toBe(400);
    expect((await post(app, `/${STUDENT}/revoke`, {})).status).toBe(400);
  });

  it('作廢：沒有有效卡 409 NO_ACTIVE_CARD；成功 204 並寫稽核', async () => {
    const app = createApp(['manage_students']);
    lib.revokeCard.mockResolvedValueOnce({ ok: false, reason: 'NO_ACTIVE_CARD' });
    const none = await post(app, `/${STUDENT}/revoke`, { reason: '退班' });
    expect(none.status).toBe(409);
    expect(audits).toHaveLength(0);

    lib.revokeCard.mockResolvedValueOnce({ ok: true, studentName: '甲', revokedCode: 'CK1-OLD' });
    expect((await post(app, `/${STUDENT}/revoke`, { reason: '退班' })).status).toBe(204);
    expect(audits.map((a) => a.action)).toEqual(['revoke_checkin_card']);
  });
});

describe('GET /students/:studentId —— 詳情頁的現況（計畫席 10-28：只給後 4 碼）', () => {
  const cardsTable = (rows: unknown[]) => {
    const q = {
      select: () => q,
      eq: () => q,
      then: (f: (v: unknown) => unknown) => f({ data: rows, error: null }),
    };
    return { from: () => q };
  };
  const get = (supabase: unknown) =>
    createApp(['basic_operations'], {}, supabase).request(`/api/checkin-cards/students/${STUDENT}`);

  it('有效卡只回後 4 碼，完整代碼不出現在回應裡', async () => {
    const res = await get(
      cardsTable([
        {
          code: 'CK1-AAAAAAAAAAAA0000',
          issued_at: '2026-10-01T00:00:00Z',
          revoked_at: '2026-10-02T00:00:00Z',
        },
        { code: 'CK1-0123456789ABCDEF', issued_at: '2026-10-02T00:00:00Z', revoked_at: null },
      ]),
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      active: { last4: 'CDEF', issuedAt: '2026-10-02T00:00:00Z' },
      hasAnyCard: true,
    });
    expect(text).not.toContain('0123456789ABCDEF');
  });

  it('沒發過卡：active null、hasAnyCard false；學生不在範圍 403、不存在 404', async () => {
    expect(await (await get(cardsTable([]))).json()).toEqual({ active: null, hasAnyCard: false });
    scope.result = 'out-of-scope';
    expect((await get(cardsTable([]))).status).toBe(403);
    scope.result = 'not-found';
    expect((await get(cardsTable([]))).status).toBe(404);
    scope.result = 'ok';
  });
});

describe('代碼格式', () => {
  it('產生的代碼過得了 DB 的 CHECK，而且每次不同', () => {
    const codes = Array.from({ length: 50 }, generateCardCode);
    for (const code of codes) expect(code).toMatch(/^CK1-[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(new Set(codes).size).toBe(50);
  });

  it('手打的正規化：分組、小寫、I/L→1、O→0；長度不對或不是 CK1 → null', () => {
    expect(normalizeCardCode(' ck1-abcd-efgh-jkmn-pqrs ')).toBe('CK1-ABCDEFGHJKMNPQRS');
    expect(normalizeCardCode('CK1-OILO-0000-0000-0000')).toBe('CK1-0110000000000000');
    expect(normalizeCardCode('CK1-ABCD')).toBeNull();
    expect(normalizeCardCode('CK2-ABCDEFGHJKMNPQRS')).toBeNull();
    expect(normalizeCardCode('CK1-ABCDEFGHJKMNPQRU')).toBeNull(); // U 不在字母表
    expect(normalizeCardCode(STUDENT)).toBeNull();
  });
});
