import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../../lib/child-db';
import { createMultiOrgDb } from '../../test-utils/multi-org-db';
import renewalRequestsRoute from './renewal-requests';

/**
 * 家長端續課異動（#1122）。真的 `createChildDb` 疊在照條件過濾的替身上 —— 範圍檢查是重點。
 */
const ORG = 'org-1';
const MY_CHILD = '00000000-0000-4000-8000-0000000000b1';
const OTHER_CHILD = '00000000-0000-4000-8000-0000000000b2';
const PERIOD = '00000000-0000-4000-8000-0000000000e1';
const MONTHLY = '00000000-0000-4000-8000-0000000000e2';
const OTHERS = '00000000-0000-4000-8000-0000000000e3';
const ENDED = '00000000-0000-4000-8000-0000000000e4';
const REQ = '00000000-0000-4000-8000-0000000000f1';

function seed(requests: Array<Record<string, unknown>> = []) {
  return createMultiOrgDb({
    enrollments: [
      { id: PERIOD, org_id: ORG, student_id: MY_CHILD, status: 'active', billing_mode: 'period' },
      { id: MONTHLY, org_id: ORG, student_id: MY_CHILD, status: 'active', billing_mode: 'monthly' },
      {
        id: OTHERS,
        org_id: ORG,
        student_id: OTHER_CHILD,
        status: 'active',
        billing_mode: 'period',
      },
      // 自己孩子的期繳，但已經不在讀 —— 只有 status 條件擋得住
      { id: ENDED, org_id: ORG, student_id: MY_CHILD, status: 'withdrawn', billing_mode: 'period' },
    ],
    renewal_requests: requests,
  });
}

type Hook = (table: string, ops: string[]) => Promise<unknown> | unknown;

/**
 * 在替身外面包一層：每支查詢 resolve 前問 `hook(表, 呼叫過的方法)`。
 * 回傳物件＝改回這個結果（模擬讀取失敗、23505）；回傳 undefined＝照常跑（hook 裡可以先改資料，模擬插隊）。
 */
function hooked(client: any, hook: Hook): any {
  return {
    from(table: string) {
      const ops: string[] = [];
      const wrap = (b: any): any =>
        new Proxy(b, {
          get(target, prop) {
            if (prop === 'then')
              return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
                Promise.resolve(hook(table, ops)).then((r) =>
                  r === undefined ? target.then(resolve, reject) : resolve(r),
                );
            const v = Reflect.get(target, prop);
            if (typeof v !== 'function') return v;
            return (...args: unknown[]) => {
              ops.push(String(prop));
              return wrap(v.apply(target, args));
            };
          },
        });
      return wrap(client.from(table));
    },
  };
}

function appFor(
  db: ReturnType<typeof createMultiOrgDb>,
  notify = vi.fn(async () => true),
  hook?: Hook,
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', ['parent']);
    set('orgId', ORG);
    set('userId', 'parent-user');
    set('studentScope', [MY_CHILD]);
    const client = hook ? hooked(db.client, hook) : db.client;
    const childDb = createChildDb(client as never, [MY_CHILD], ORG);
    set('childDb', { ...childDb, notifyRenewalRequest: notify });
    await next();
  });
  app.route('/', renewalRequestsRoute as unknown as Hono);
  return app;
}

async function submit(body: Record<string, unknown>, db = seed(), hook?: Hook) {
  const notify = vi.fn(async () => true);
  const res = await appFor(db, notify, hook).request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ childId: MY_CHILD, kind: 'transfer', detail: '想改到週六', ...body }),
  });
  return { status: res.status, body: (await res.json()) as any, db, notify };
}

describe('POST /api/me/renewal-requests', () => {
  it('在讀的期繳報名：建一筆 pending、org 與送出者取 session、通知管理員', async () => {
    const { status, body, db, notify } = await submit({ enrollmentId: PERIOD, note: '平日社團' });
    expect(status).toBe(201);
    expect(body).toMatchObject({ enrollmentId: PERIOD, kind: 'transfer', status: 'pending' });
    expect(db.rows('renewal_requests')[0]).toMatchObject({
      org_id: ORG,
      student_id: MY_CHILD,
      requested_by: 'parent-user',
      note: '平日社團',
    });
    expect(notify).toHaveBeenCalledWith(body.id);
  });

  it('月繳報名、別人的報名、已不在讀的報名 → 404，不寫', async () => {
    for (const enrollmentId of [MONTHLY, OTHERS, ENDED]) {
      const { status, db } = await submit({ enrollmentId });
      expect(status).toBe(404);
      expect(db.rows('renewal_requests')).toHaveLength(0);
    }
  });

  it('別人的孩子 → 403', async () => {
    const { status } = await submit({ enrollmentId: OTHERS, childId: OTHER_CHILD });
    expect(status).toBe(403);
  });

  it('已有處理中的 → 409；撤回過的不算', async () => {
    const pending = { id: REQ, org_id: ORG, student_id: MY_CHILD, status: 'pending' };
    expect((await submit({ enrollmentId: PERIOD }, seed([pending]))).status).toBe(409);
    const withdrawn = { ...pending, status: 'withdrawn' };
    expect((await submit({ enrollmentId: PERIOD }, seed([withdrawn]))).status).toBe(201);
  });

  it('兩個分頁同時送：檢查都過、DB 唯一索引擋下（23505）→ 409，不是 500', async () => {
    const { status, body, notify } = await submit({ enrollmentId: PERIOD }, seed(), (table, ops) =>
      table === 'renewal_requests' && ops.includes('insert')
        ? { data: null, error: { code: '23505', message: 'duplicate key' } }
        : undefined,
    );
    expect(status).toBe(409);
    expect(body.code).toBe('DUPLICATE_REQUEST');
    expect(notify).not.toHaveBeenCalled();
  });

  it('讀報名失敗 → 500（不是 404「找不到這門續課」）', async () => {
    const { status } = await submit({ enrollmentId: PERIOD }, seed(), (table) =>
      table === 'enrollments' ? { data: null, error: { message: 'boom' } } : undefined,
    );
    expect(status).toBe(500);
  });

  it('想怎麼改空白 → 400', async () => {
    expect((await submit({ enrollmentId: PERIOD, detail: '  ' })).status).toBe(400);
  });
});

describe('POST /api/me/renewal-requests/:id/withdraw', () => {
  const withdraw = async (rows: Array<Record<string, unknown>>, hook?: Hook) => {
    const db = seed(rows);
    const res = await appFor(db, undefined, hook).request(`/${REQ}/withdraw`, { method: 'POST' });
    return { status: res.status, db };
  };

  it('讀完之後、寫之前被管理員結案（插隊）→ 409，不蓋成 withdrawn', async () => {
    let raced = false;
    let dbRef: ReturnType<typeof createMultiOrgDb> | null = null;
    const db = seed([{ id: REQ, org_id: ORG, student_id: MY_CHILD, status: 'pending' }]);
    dbRef = db;
    const res = await appFor(db, undefined, async (table, ops) => {
      if (table !== 'renewal_requests' || !ops.includes('update') || raced) return undefined;
      raced = true; // 管理員搶先：這支 update 執行前，狀態已經變成 resolved
      await (dbRef!.client as any).from('renewal_requests').update({ status: 'resolved' }).eq('id', REQ);
      return undefined;
    }).request(`/${REQ}/withdraw`, { method: 'POST' });
    expect(raced).toBe(true);
    expect(res.status).toBe(409);
    expect(db.rows('renewal_requests')[0]!['status']).toBe('resolved');
  });

  it('讀申請失敗 → 500（不是 404）', async () => {
    const { status } = await withdraw(
      [{ id: REQ, org_id: ORG, student_id: MY_CHILD, status: 'pending' }],
      (table, ops) =>
        table === 'renewal_requests' && !ops.includes('update')
          ? { data: null, error: { message: 'boom' } }
          : undefined,
    );
    expect(status).toBe(500);
  });

  it('處理中的 → withdrawn', async () => {
    const { status, db } = await withdraw([
      { id: REQ, org_id: ORG, student_id: MY_CHILD, status: 'pending' },
    ]);
    expect(status).toBe(200);
    expect(db.rows('renewal_requests')[0]!['status']).toBe('withdrawn');
  });

  it('管理員已處理 → 409、不改', async () => {
    const { status, db } = await withdraw([
      { id: REQ, org_id: ORG, student_id: MY_CHILD, status: 'resolved' },
    ]);
    expect(status).toBe(409);
    expect(db.rows('renewal_requests')[0]!['status']).toBe('resolved');
  });

  it('別人孩子的 → 404、不改', async () => {
    const { status, db } = await withdraw([
      { id: REQ, org_id: ORG, student_id: OTHER_CHILD, status: 'pending' },
    ]);
    expect(status).toBe(404);
    expect(db.rows('renewal_requests')[0]!['status']).toBe('pending');
  });
});
