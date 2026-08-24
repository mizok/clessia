import { describe, expect, it } from 'vitest';

import { oauthErrorFor } from './oauth-error';

// OAuth 失敗是「導回來時網址上帶 ?error=」，不是函式回傳值。
describe('oauthErrorFor', () => {
  // 看到招生宣傳連過來的家長會撞到這個。他不是「稍後再試」就會成功 ——
  // 他根本還不是這間補習班的客戶。訊息說錯方向會讓他一直重試。
  it('未登記的帳號給的是「怎麼加入」而不是「再試一次」', () => {
    const result = oauthErrorFor('signup_disabled');

    expect(result?.message).toContain('還沒有被登記');
    expect(result?.showEnrollmentLink).toBe(true);
  });

  it('沒有 error 參數時不顯示任何東西', () => {
    expect(oauthErrorFor(null)).toBeNull();
    expect(oauthErrorFor('')).toBeNull();
  });

  it('其他錯誤給通用訊息，且不引導去報名', () => {
    const result = oauthErrorFor('state_mismatch');

    expect(result?.message).toBeTruthy();
    expect(result?.showEnrollmentLink).toBe(false);
  });

  // 使用者在 LINE 的畫面按了「取消」—— 那不是錯誤，不該嚇他
  it('使用者自己取消授權時語氣要中性', () => {
    const result = oauthErrorFor('access_denied');

    expect(result?.message).toContain('取消');
    expect(result?.showEnrollmentLink).toBe(false);
  });
});
