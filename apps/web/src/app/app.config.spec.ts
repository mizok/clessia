import { TestBed } from '@angular/core/testing';
import { ApplicationInitStatus } from '@angular/core';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AuthService } from '@core/auth.service';

import { appConfig } from './app.config';

/**
 * #951：開站時 `/api/me` 不排在 `/api/system-time` 後面。
 *
 * 時鐘 initializer 會擋住啟動（同步前不能用瀏覽器的時間算「今天」去渲染或發查詢），
 * 而 `/api/me` 原本要等到路由守衛第一次注入 AuthService 才出發 —— 守衛又要等啟動完成。
 * 兩段往返依序走，每次整頁重新載入多一段 Worker 往返。
 *
 * 守的是**真的 `appConfig`**，不是另外組一套 providers：要驗的就是實際的接線。
 */
describe('appConfig 開站請求', () => {
  it('system-time 還沒回來時，/api/me 已經發出去了（兩者同時在路上）', () => {
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClientTesting()],
    });
    TestBed.inject(ApplicationInitStatus);
    const http = TestBed.inject(HttpTestingController);

    const systemTime = http.match((req) => req.url.endsWith('/api/system-time'));
    const me = http.match((req) => req.url.endsWith('/api/me'));

    expect(systemTime.length, 'system-time requests').toBe(1);
    expect(me.length, '/api/me requests').toBe(1);
    // 啟動仍然等時鐘 —— 同步前不渲染任何依賴「今天」的畫面（約束不變）
    expect(TestBed.inject(ApplicationInitStatus).done).toBe(false);

    // 守衛之後注入的是同一個 root 單例 —— 不會再發第二支 /me
    TestBed.inject(AuthService);
    expect(http.match((req) => req.url.endsWith('/api/me')).length, 'second /api/me').toBe(0);
  });
});
