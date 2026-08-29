import { describe, expect, it, vi } from 'vitest';

import { provisionOrg } from './bootstrap-org.util';

/** 記下每一句 SQL 與參數，用來斷言寫入序列。 */
function recordingDeps(overrides: { slugTaken?: boolean } = {}) {
  const queries: Array<{ text: string; values: unknown[] }> = [];

  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    queries.push({ text, values });

    if (text.includes('from public.organizations')) {
      return { rows: [], rowCount: overrides.slugTaken ? 1 : 0 };
    }
    if (text.includes('insert into public.organizations')) {
      return { rows: [{ id: 'org-1' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });

  return {
    queries,
    deps: { query, createAdminUser: vi.fn(async () => 'user-1') },
  };
}

const input = {
  orgName: '向上補習班',
  orgSlug: 'xiangshang',
  adminEmail: 'owner@example.com',
  adminName: '王主任',
};

describe('provisionOrg', () => {
  it('回傳建好的 org 與 user id', async () => {
    const { deps } = recordingDeps();

    await expect(provisionOrg(deps, input)).resolves.toEqual({ orgId: 'org-1', userId: 'user-1' });
  });

  /**
   * 這條是本次事故的核心。原本的開站序列是 org → ba_user → user_roles，**沒有 staff 列**，
   * 於是第一個管理員在人員管理頁（讀 staff 表）根本不存在 —— 看不到自己、也改不了自己的
   * 角色。這對每一個乾淨部署都成立，不是某一站的資料意外。
   */
  it('建立 staff 列 —— 組織的第一個管理員必須出現在人員名冊裡', async () => {
    const { queries, deps } = recordingDeps();

    await provisionOrg(deps, input);

    const staffInsert = queries.find((q) => q.text.includes('insert into public.staff'));

    expect(staffInsert, '沒有 insert staff —— 管理員會變成人員名冊上的幽靈').toBeDefined();
    expect(staffInsert?.values).toEqual(['user-1', 'org-1', '王主任']);
  });

  it('staff 列接在 user_roles 之後 —— 前面任何一步失敗就不該留下半套資料', async () => {
    const { queries, deps } = recordingDeps();

    await provisionOrg(deps, input);

    const order = queries.map((q) => q.text).filter((t) => t.includes('insert into public.'));
    const names = order.map((t) => t.match(/insert into public\.(\w+)/)?.[1]);

    expect(names).toEqual(['organizations', 'user_roles', 'staff']);
  });

  // 冪等：slug 已存在就整個中止，不覆寫任何東西，也不該建出一個沒有組織的孤兒帳號
  it('slug 已存在時丟出錯誤，而且沒有建立任何使用者', async () => {
    const { queries, deps } = recordingDeps({ slugTaken: true });

    await expect(provisionOrg(deps, input)).rejects.toThrow(/xiangshang/);

    expect(deps.createAdminUser).not.toHaveBeenCalled();
    expect(queries.some((q) => q.text.includes('insert into'))).toBe(false);
  });
});
