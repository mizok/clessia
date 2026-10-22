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
});
