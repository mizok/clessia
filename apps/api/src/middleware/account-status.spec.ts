import { describe, expect, it } from 'vitest';

import { isAccountUsable } from './account-status';

// 原本這個檢查住在 POST /api/login 裡。PR #24 把那支端點刪掉時，**檢查沒有搬家** ——
// 被停用的家長只要還握著 LINE 綁定或未過期的連結就能繼續進系統。
describe('isAccountUsable', () => {
  it('active 就放行', () => {
    expect(isAccountUsable(['active'])).toBe(true);
  });

  it('inactive 擋下來', () => {
    expect(isAccountUsable(['inactive'])).toBe(false);
  });

  it('archived 擋下來', () => {
    expect(isAccountUsable(['archived'])).toBe(false);
  });

  // 一個人可以同時是老師和家長。老師身分被停用，家長身分還在 —— 他仍該進得來
  it('多重身分只要有一個 active 就放行', () => {
    expect(isAccountUsable(['inactive', 'active'])).toBe(true);
    expect(isAccountUsable(['archived', 'active'])).toBe(true);
  });

  it('全部都不是 active 才擋', () => {
    expect(isAccountUsable(['inactive', 'archived'])).toBe(false);
  });

  // **這條最容易寫錯**：bootstrap 建的第一個管理員在 staff / parents 表裡都沒有列。
  // 「沒有任何身分列」不等於「被停用」—— 擋掉的話第一個管理員永遠進不去。
  it('完全沒有身分列時放行 —— 那是系統帳號，不是被停用', () => {
    expect(isAccountUsable([])).toBe(true);
  });

  it('未知的狀態值一律當成不可用 —— fail-closed', () => {
    expect(isAccountUsable(['suspended'])).toBe(false);
    expect(isAccountUsable([''])).toBe(false);
  });
});
