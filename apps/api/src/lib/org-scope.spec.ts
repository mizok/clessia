import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import { findInOrg, inOrg, missingInOrg } from './org-scope';

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';

function seeded() {
  return createMultiOrgDb({
    subjects: [
      { id: 'sub-a', org_id: ORG_A, name: '數學' },
      { id: 'sub-b', org_id: ORG_B, name: '英文' },
    ],
  });
}

describe('inOrg', () => {
  it('寫入只打到自己 org 的列 —— 別 org 的 id 不動', async () => {
    const db = seeded();
    const supabase = db.client as SupabaseClient;

    await inOrg(supabase.from('subjects').update({ name: '改' }).eq('id', 'sub-b'), ORG_A);
    await inOrg(supabase.from('subjects').update({ name: '改' }).eq('id', 'sub-a'), ORG_A);

    expect(db.rows('subjects')).toEqual([
      { id: 'sub-a', org_id: ORG_A, name: '改' },
      { id: 'sub-b', org_id: ORG_B, name: '英文' },
    ]);
  });
});

describe('findInOrg', () => {
  it('別 org 的 id 跟不存在的 id 一樣回 null', async () => {
    const supabase = seeded().client as SupabaseClient;

    expect(await findInOrg(supabase, 'subjects', ORG_A, 'sub-b')).toBeNull();
    expect(await findInOrg(supabase, 'subjects', ORG_A, 'nope')).toBeNull();
    expect(await findInOrg(supabase, 'subjects', ORG_A, 'sub-a', '*')).toMatchObject({
      id: 'sub-a',
    });
  });

  it('查詢失敗丟例外，不折成 null（「DB 掛了」≠「沒有這筆」）', async () => {
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'down' } }) }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(findInOrg(broken, 'subjects', ORG_A, 'sub-a')).rejects.toThrow('down');
  });
});

describe('missingInOrg', () => {
  it('回出不屬於本 org 的那些（含不存在），去重；全在 org 內回空陣列', async () => {
    const supabase = seeded().client as SupabaseClient;

    expect(
      await missingInOrg(supabase, 'subjects', ORG_A, ['sub-a', 'sub-b', 'nope', 'sub-b']),
    ).toEqual(['sub-b', 'nope']);
    expect(await missingInOrg(supabase, 'subjects', ORG_A, ['sub-a'])).toEqual([]);
    expect(await missingInOrg(supabase, 'subjects', ORG_A, [])).toEqual([]);
  });
});

describe('multi-org-db 替身本身', () => {
  it('沒實作的 builder 方法丟例外，不放行', () => {
    const supabase = seeded().client as SupabaseClient;
    expect(() => supabase.from('subjects').select('*').textSearch('name', 'x')).toThrow(
      /沒有實作 `textSearch`/,
    );
  });
});
