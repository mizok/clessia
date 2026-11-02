import { describe, expect, it } from 'vitest';

import { oauthErrorFor } from './oauth-error';

// OAuth 失敗是「導回來時網址上帶 ?error=」，不是函式回傳值。
describe('oauthErrorFor', () => {
  // 看到招生宣傳連過來的家長會撞到這個。他不是「稍後再試」就會成功 ——
  // 他根本還不是這間補習班的客戶。訊息說錯方向會讓他一直重試。
  it('未登記的帳號給的是「怎麼加入」而不是「再試一次」', () => {
    const result = oauthErrorFor('signup_disabled');

    expect(result?.message).toContain('還沒有被登記');
    expect(result?.showRegisterHint).toBe(true);
  });

  it('沒有 error 參數時不顯示任何東西', () => {
    expect(oauthErrorFor(null)).toBeNull();
    expect(oauthErrorFor('')).toBeNull();
  });

  it('其他錯誤給通用訊息，且不引導去報名', () => {
    const result = oauthErrorFor('state_mismatch');

    expect(result?.message).toBeTruthy();
    expect(result?.showRegisterHint).toBe(false);
  });

  // 使用者在 LINE 的畫面按了「取消」—— 那不是錯誤，不該嚇他
  it('使用者自己取消授權時語氣要中性', () => {
    const result = oauthErrorFor('access_denied');

    expect(result?.message).toContain('取消');
    expect(result?.showRegisterHint).toBe(false);
  });
});

// #1842：Google 失敗回來時網址帶 `?provider=google`（errorCallbackURL 加的）；訊息要說 Google，不能說 LINE
describe('oauthErrorFor 依 provider 換名稱', () => {
  it('Google 的未登記、取消、其他錯誤都寫 Google', () => {
    expect(oauthErrorFor('signup_disabled', 'google')?.message).toContain('這個 Google 帳號');
    expect(oauthErrorFor('access_denied', 'google')?.message).toBe('已取消 Google 登入。');
    expect(oauthErrorFor('state_mismatch', 'google')?.message).toContain('Google 登入沒有完成');
  });

  // 舊的回跳網址沒有 provider：維持今天的 LINE 字樣
  it('沒帶或認不得的 provider 當成 LINE', () => {
    expect(oauthErrorFor('signup_disabled', null)?.message).toContain('這個 LINE 帳號');
    expect(oauthErrorFor('signup_disabled', 'facebook')?.message).toContain('這個 LINE 帳號');
  });

  it('已經綁給別人的帳號：說清楚，不叫人重試', () => {
    expect(oauthErrorFor('account_already_linked_to_different_user', 'google')?.message).toBe(
      '這個 Google 帳號已經綁定在別的帳號上了。請改用另一個 Google 帳號，或聯絡補習班。',
    );
  });
});
