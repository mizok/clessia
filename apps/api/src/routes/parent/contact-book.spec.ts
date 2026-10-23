import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import { createChildDb } from '../../lib/child-db';
import { createMultiOrgDb } from '../../test-utils/multi-org-db';

/**
 * 簽收的 SQL 語意（scope、已簽不覆蓋、兩欄同一個交易時間）由
 * `contract/contact-book-sign.contract.ts` 對真 DB 驗；這裡的 pool 替身只回「找到幾筆、簽了幾筆」，
 * 驗的是路由怎麼用那個結果，以及送進 SQL 的參數是 session 的、不是呼叫端給的。
 */
const pg = {
  result: { found: 1, signed: 1 } as { found: number; signed: number },
  calls: [] as unknown[][],
  noPool: false,
  throws: false,
};
/** 交給 `createChildDb` 的 pool（A19：家長端 route 不碰原始連線，pool 只在 childDb 裡） */
const fakePool = {
  query: async (_sql: string, params: unknown[]) => {
    pg.calls.push(params);
    if (pg.throws) throw new Error('pg boom');
    return { rows: [pg.result] };
  },
};

import contactBookRoute from './contact-book';

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const CHILD = id(1);
const SIBLING = id(2);
const STRANGER = id(3);
const ENTRY = id(11);

const entry = (over: Record<string, unknown>) => ({
  id: ENTRY,
  org_id: 'org-1',
  student_id: CHILD,
  entry_date: '2026-10-20',
  content: '今天單字小考 18／20',
  updated_at: '2026-10-20T10:12:00.000000+00:00',
  signed_at: null,
  editor: { name: '簡老師' },
  signer: null,
  ...over,
});

function appWith(rows: Record<string, unknown>[], roles = ['parent']) {
  const db = createMultiOrgDb({ contact_book_entries: rows });
  const scope = [CHILD, SIBLING];
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', roles);
    set('studentScope', scope);
    set('userId', 'parent-user');
    set(
      'childDb',
      createChildDb(
        db.client as never,
        scope,
        'org-1',
        pg.noPool ? undefined : (fakePool as never),
      ),
    );
    await next();
  });
  app.route('/', contactBookRoute as unknown as Hono);
  return app;
}

const WINDOW = 'dateFrom=2026-10-01&dateTo=2026-10-31';

beforeEach(() => {
  pg.result = { found: 1, signed: 1 };
  pg.calls = [];
  pg.noPool = false;
  pg.throws = false;
});

describe('GET /api/me/contact-book', () => {
  it('只回這個孩子、窗內的；新到舊', async () => {
    const app = appWith([
      entry({ id: id(11), entry_date: '2026-10-05' }),
      entry({ id: id(12), entry_date: '2026-10-20' }),
      entry({ id: id(13), entry_date: '2026-09-30' }), // 窗外
      entry({ id: id(14), student_id: SIBLING }), // 兄弟姊妹
      entry({ id: id(15), student_id: STRANGER }), // 別人家
    ]);
    const res = await app.request(`/?childId=${CHILD}&${WINDOW}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data.map((e) => e.id)).toEqual([id(12), id(11)]);
  });

  it('帶簽收者、簽收時間；簽收後又改 → editedAfterSign', async () => {
    const app = appWith([
      entry({
        id: id(11),
        entry_date: '2026-10-05',
        signed_at: '2026-10-05T12:00:00.000000+00:00',
        updated_at: '2026-10-05T12:00:00.000000+00:00',
        signer: { name: '王媽媽' },
      }),
      entry({
        id: id(12),
        entry_date: '2026-10-06',
        signed_at: '2026-10-06T12:00:00.000000+00:00',
        updated_at: '2026-10-06T13:00:00.000000+00:00',
        signer: { name: '王媽媽' },
      }),
    ]);
    const body = (await (await app.request(`/?childId=${CHILD}&${WINDOW}`)).json()) as {
      data: Record<string, unknown>[];
    };
    expect(body.data[1]).toEqual({
      id: id(11),
      entryDate: '2026-10-05',
      content: '今天單字小考 18／20',
      lastEditedByName: '簡老師',
      updatedAt: '2026-10-05T12:00:00.000000+00:00',
      signedAt: '2026-10-05T12:00:00.000000+00:00',
      signedByName: '王媽媽',
      editedAfterSign: false,
    });
    expect(body.data[0]['editedAfterSign']).toBe(true);
  });

  it('不是家長 403；孩子不在 scope 403；窗超過 120 天或倒置 400', async () => {
    expect((await appWith([], ['teacher']).request(`/?childId=${CHILD}&${WINDOW}`)).status).toBe(
      403,
    );
    expect((await appWith([]).request(`/?childId=${STRANGER}&${WINDOW}`)).status).toBe(403);
    const app = appWith([]);
    expect(
      (await app.request(`/?childId=${CHILD}&dateFrom=2026-06-01&dateTo=2026-09-30`)).status,
    ).toBe(400);
    expect(
      (await app.request(`/?childId=${CHILD}&dateFrom=2026-10-31&dateTo=2026-10-01`)).status,
    ).toBe(400);
    // 剛好 120 天放行
    expect(
      (await app.request(`/?childId=${CHILD}&dateFrom=2026-06-02&dateTo=2026-09-30`)).status,
    ).toBe(200);
  });
});

describe('POST /api/me/contact-book/{id}/sign', () => {
  const sign = (app: Hono, entryId = ENTRY) => app.request(`/${entryId}/sign`, { method: 'POST' });

  it('簽到了：回那一則；SQL 收到的是 session 的 org、scope、使用者', async () => {
    const res = await sign(appWith([entry({})]));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(ENTRY);
    expect(pg.calls).toEqual([[ENTRY, 'org-1', [CHILD, SIBLING], 'parent-user']]);
  });

  it('本來就簽過：一樣 200 回現狀（冪等）', async () => {
    pg.result = { found: 1, signed: 0 };
    const res = await sign(
      appWith([entry({ signed_at: '2026-10-20T12:00:00Z', signer: { name: '王爸爸' } })]),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { signedByName: string }).signedByName).toBe('王爸爸');
  });

  it('不是自己孩子的（SQL 找不到）→ 404', async () => {
    pg.result = { found: 0, signed: 0 };
    expect((await sign(appWith([entry({ student_id: STRANGER })]))).status).toBe(404);
  });

  it('不是家長 403、不打 SQL', async () => {
    expect((await sign(appWith([entry({})], ['teacher']))).status).toBe(403);
    expect(pg.calls).toEqual([]);
  });

  it('pool 不在、SQL 丟例外 → 500', async () => {
    pg.noPool = true;
    expect((await sign(appWith([entry({})]))).status).toBe(500);
    pg.noPool = false;
    pg.throws = true;
    expect((await sign(appWith([entry({})]))).status).toBe(500);
  });
});
