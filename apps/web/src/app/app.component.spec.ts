import { vi } from 'vitest';
import { MessageService } from 'primeng/api';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { AppVersionService } from '@core/app-version.service';
import { App } from './app.component';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        MessageService,
        provideRouter([
          { path: 'a', children: [] },
          { path: 'b', children: [] },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  // #1615：全站唯一的 toast 出口。拿掉的話所有 MessageService.add() 都沒有人在聽
  it('渲染全站唯一的 toast 出口 <app-toast>', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('app-toast')).toHaveLength(1);
  });

  // #1930：一直在前景的分頁（櫃檯）不會觸發「回到前景」—— 每次導覽結束也比一次（節流在 service 裡）
  it('每次導覽結束都呼叫一次版本比對', async () => {
    const check = vi
      .spyOn(TestBed.inject(AppVersionService), 'checkForNewVersion')
      .mockResolvedValue();
    TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/a');
    await router.navigateByUrl('/b');
    expect(check).toHaveBeenCalledTimes(2);
  });

  // 開站畫面靠 CSS :has() 退場；App 等淡出跑完（transitionend）才把節點拿掉，
  // 不支援 :has() 的瀏覽器沒有 transition，靠逾時收掉。只看第一次導覽
  describe('index.html 的開站畫面', () => {
    let splash: HTMLDivElement;
    beforeEach(() => {
      vi.useFakeTimers();
      splash = document.createElement('div');
      splash.className = 'app-splash';
      document.body.append(splash);
    });
    afterEach(() => {
      vi.useRealTimers();
      splash.remove();
    });

    it('淡出跑完（transitionend）才移除，不在導覽結束當下抽掉', async () => {
      TestBed.createComponent(App);
      await TestBed.inject(Router).navigateByUrl('/a');
      expect(splash.isConnected).toBe(true);

      splash.dispatchEvent(new Event('transitionend'));
      expect(splash.isConnected).toBe(false);
    });

    it('沒有 transition（不支援 :has()）：逾時收掉', async () => {
      TestBed.createComponent(App);
      await TestBed.inject(Router).navigateByUrl('/a');
      vi.advanceTimersByTime(799);
      expect(splash.isConnected).toBe(true);
      vi.advanceTimersByTime(1);
      expect(splash.isConnected).toBe(false);
    });
  });
});
