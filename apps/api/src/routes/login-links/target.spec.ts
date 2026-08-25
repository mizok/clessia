import { describe, expect, it } from 'vitest';

import { decideLoginLinkTarget } from './target';

const CALLER_ORG = 'org-a';

// 登入連結等於帳號。誰能替誰產生，是這支端點唯一重要的問題。
describe('decideLoginLinkTarget', () => {
  it('同一個組織、有角色 → 允許', () => {
    expect(decideLoginLinkTarget({ orgId: CALLER_ORG, roles: ['teacher'] }, CALLER_ORG)).toEqual({
      ok: true,
    });
  });

  // 這是本端點最重要的不變量（憲法 c1：授權發生在 API 層，靠 org_id 過濾）
  it('跨組織 → 拒絕，而且不透露那個人存不存在', () => {
    const decision = decideLoginLinkTarget({ orgId: 'org-b', roles: ['admin'] }, CALLER_ORG);

    expect(decision).toEqual({ ok: false, code: 'NOT_FOUND', status: 404 });
  });

  it('找不到人 → 與跨組織回傳完全一樣的結果', () => {
    expect(decideLoginLinkTarget(null, CALLER_ORG)).toEqual(
      decideLoginLinkTarget({ orgId: 'org-b', roles: ['admin'] }, CALLER_ORG),
    );
  });

  // orgId 是 nullable（ba_user 的欄位允許 NULL）—— 不能因為兩邊都 null 就當成同組織
  it('目標沒有 orgId → 拒絕，不能靠 null == null 溜過去', () => {
    expect(decideLoginLinkTarget({ orgId: null, roles: ['admin'] }, CALLER_ORG)).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('呼叫端沒有 orgId → 拒絕', () => {
    expect(decideLoginLinkTarget({ orgId: null, roles: ['admin'] }, '')).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  // 沒有角色的人登進去看不到任何東西，產生連結只會製造困惑
  it('同組織但沒有角色 → 拒絕，且錯誤碼與「找不到」不同', () => {
    const decision = decideLoginLinkTarget({ orgId: CALLER_ORG, roles: [] }, CALLER_ORG);

    expect(decision).toEqual({ ok: false, code: 'NO_ROLES', status: 422 });
  });
});
