import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';

import { AuthProvidersService, isLineInAppBrowser } from './auth-providers.service';

function setup() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  return {
    service: TestBed.inject(AuthProvidersService),
    http: TestBed.inject(HttpTestingController),
  };
}
const url = `${environment.apiUrl}/api/auth-providers`;

// #1842：要畫哪幾顆由 API 說了算（c12：沒設憑證的部署看不到 Google）
describe('AuthProvidersService', () => {
  // 還沒回來時先畫 LINE：今天的畫面就是這樣，只設 LINE 的部署不會閃
  it('讀到之前是 LINE', () => {
    const { service } = setup();
    expect(service.providers()).toEqual(['line']);
  });

  it('照 API 回的畫；外觀表沒有的 id 不畫', () => {
    const { service, http } = setup();
    http.expectOne(url).flush({ providers: ['line', 'google', 'facebook'] });
    expect(service.providers()).toEqual(['line', 'google']);
  });

  it('API 回空的就是空的（這個部署沒設任何登入方式）', () => {
    const { service, http } = setup();
    http.expectOne(url).flush({ providers: [] });
    expect(service.providers()).toEqual([]);
  });

  // 讀不到清單不能讓所有人都登不進來
  it('讀不到時退回 LINE', () => {
    const { service, http } = setup();
    http.expectOne(url).flush(null, { status: 500, statusText: 'x' });
    expect(service.providers()).toEqual(['line']);
  });
});

// Google 一律擋 LINE 內建瀏覽器（403 disallowed_useragent），而綁定連結常用 LINE 傳
describe('isLineInAppBrowser', () => {
  it('UA 帶 " Line/" 才算', () => {
    expect(
      isLineInAppBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.17.0',
      ),
    ).toBe(true);
    expect(
      isLineInAppBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(false);
    expect(isLineInAppBrowser('Mozilla/5.0 Online/1.0')).toBe(false);
  });
});
