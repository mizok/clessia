import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../../test-utils/multi-org-db';
import { publicOrgMiddleware } from '../../lib/public-org';
import publicOrgRoute from './org';

/** #1858：公開頁的補習班名稱。免登入，所以只能回名稱 —— 斷言回應的 key 只有 `name` */

const ORG = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';

function call(slug: string | undefined) {
  const db = createMultiOrgDb({
    organizations: [
      { id: ORG, slug: 'demo', name: 'Demo 補習班', settings: { secret: 1 } },
      { id: ORG_B, slug: 'other', name: '別家補習班' },
    ],
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set('supabase', db.client);
    await next();
  });
  app.use('*', publicOrgMiddleware);
  app.route('/', publicOrgRoute as unknown as Hono);
  return app.request('/', {}, { PUBLIC_ORG_SLUG: slug });
}

describe('GET /api/public/org', () => {
  it('回部署那個 org 的名稱，回應只有 name 一個 key', async () => {
    const res = await call('demo');
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toEqual({ name: 'Demo 補習班' });
    expect(Object.keys(body)).toEqual(['name']);
  });

  it.each([
    ['沒設 PUBLIC_ORG_SLUG', undefined],
    ['slug 對不到任何 org', 'nope'],
  ])('%s：404 PUBLIC_DISABLED', async (_, slug) => {
    const res = await call(slug);

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('PUBLIC_DISABLED');
  });
});
