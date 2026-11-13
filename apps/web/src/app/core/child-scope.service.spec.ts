import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AuthService } from './auth.service';
import { ChildrenService, type Child, type ChildrenListResponse } from './children.service';
import { ChildScopeService } from './child-scope.service';

const CHILDREN: Child[] = [
  { id: 'c1', name: '王小明', grade: 'g4', school: '中山國小' },
  { id: 'c2', name: '王小美', grade: 'g6', school: '中山國小' },
];

function setup(children: Child[] = CHILDREN, userId = 'u1') {
  const childrenServiceMock = { list: vi.fn(() => of({ data: children })) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ChildrenService, useValue: childrenServiceMock },
      { provide: AuthService, useValue: { user: () => ({ id: userId }) } },
    ],
  });
  const service = TestBed.inject(ChildScopeService);
  return { service, childrenServiceMock };
}

describe('ChildScopeService', () => {
  afterEach(() => localStorage.clear());

  describe('記住選中的孩子（#2449）', () => {
    it('選過的孩子重新載入（新的 service）時仍選它', () => {
      const first = setup();
      first.service.load();
      first.service.setActiveChild('c2');
      TestBed.resetTestingModule();

      const again = setup();
      again.service.load();
      expect(again.service.activeChildId()).toBe('c2');
    });

    it('key 帶 user id：換帳號不沿用', () => {
      const a = setup(CHILDREN, 'u1');
      a.service.load();
      a.service.setActiveChild('c2');
      TestBed.resetTestingModule();

      const b = setup(CHILDREN, 'u2');
      b.service.load();
      expect(b.service.activeChildId()).toBe('c1');
    });

    it('存著的孩子不在清單（解除綁定）→ 第一個', () => {
      localStorage.setItem('clessia.activeChild.u1', 'gone');
      const { service } = setup();
      service.load();
      expect(service.activeChildId()).toBe('c1');
    });
  });

  it('load 完成後預設選第一個孩子', () => {
    const { service } = setup();
    service.load();
    expect(service.activeChildId()).toBe('c1');
    expect(service.activeChild()?.name).toBe('王小明');
  });

  it('只有一個以上的孩子才允許切換', () => {
    const { service } = setup([CHILDREN[0]]);
    service.load();
    expect(service.canSwitch()).toBe(false);
  });

  it('有兩個以上的孩子時允許切換', () => {
    const { service } = setup();
    service.load();
    expect(service.canSwitch()).toBe(true);
  });

  it('setActiveChild 切換目前孩子', () => {
    const { service } = setup();
    service.load();
    service.setActiveChild('c2');
    expect(service.activeChildId()).toBe('c2');
    expect(service.activeChild()?.name).toBe('王小美');
  });

  it('沒有任何孩子時 activeChild 是 null，不強加預設值', () => {
    const { service } = setup([]);
    service.load();
    expect(service.activeChildId()).toBeNull();
    expect(service.activeChild()).toBeNull();
    expect(service.canSwitch()).toBe(false);
  });

  it('load 只在第一次真的打 API，重複呼叫不重打', () => {
    const { service, childrenServiceMock } = setup();
    service.load();
    service.load();
    service.load();
    expect(childrenServiceMock.list).toHaveBeenCalledTimes(1);
  });

  it('狀態三態分得開 —— 「沒有孩子」跟「讀不到」不能共用空陣列', () => {
    const { service } = setup([]);
    expect(service.status()).toBe('unloaded');

    service.load();
    // 成功但真的沒有孩子：children 空，但狀態是 ready
    expect(service.status()).toBe('ready');
    expect(service.children()).toEqual([]);
  });

  it('載入失敗時 status 是 failed —— 畫面才有東西可講', () => {
    const childrenServiceMock = {
      list: vi.fn((): Observable<ChildrenListResponse> => throwError(() => new Error('boom'))),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ChildrenService, useValue: childrenServiceMock },
        { provide: AuthService, useValue: { user: () => ({ id: 'u1' }) } },
      ],
    });
    const service = TestBed.inject(ChildScopeService);

    service.load();

    expect(service.status()).toBe('failed');
    // 跟成功但沒有孩子的情況比對：children 都是空的，分開它們的只有 status
    expect(service.children()).toEqual([]);
  });

  it('載入失敗時不卡死在 loading，且允許之後重試', () => {
    const childrenServiceMock = {
      list: vi.fn((): Observable<ChildrenListResponse> => throwError(() => new Error('boom'))),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ChildrenService, useValue: childrenServiceMock },
        { provide: AuthService, useValue: { user: () => ({ id: 'u1' }) } },
      ],
    });
    const service = TestBed.inject(ChildScopeService);

    service.load();
    expect(service.loading()).toBe(false);
    expect(service.children()).toEqual([]);

    childrenServiceMock.list.mockReturnValueOnce(of({ data: CHILDREN }));
    service.load();
    expect(childrenServiceMock.list).toHaveBeenCalledTimes(2);
    expect(service.activeChildId()).toBe('c1');
  });

  describe('網址帶 ?child=（從通知點進來，#2497）', () => {
    @Component({ template: '' })
    class Blank {}

    function setupWithRouter(children: Child[] = CHILDREN) {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([{ path: '**', component: Blank }]),
          { provide: ChildrenService, useValue: { list: vi.fn(() => of({ data: children })) } },
          { provide: AuthService, useValue: { user: () => ({ id: 'u1' }) } },
        ],
      });
      return { router: TestBed.inject(Router), service: TestBed.inject(ChildScopeService) };
    }

    it('孩子清單還沒載：先記著，load 完切到通知的孩子（蓋過記住的那個），並記住', async () => {
      localStorage.setItem('clessia.activeChild.u1', 'c1');
      const { router, service } = setupWithRouter();
      await router.navigateByUrl('/parent/payments?child=c2');
      service.load();
      expect(service.activeChildId()).toBe('c2');
      expect(localStorage.getItem('clessia.activeChild.u1')).toBe('c2');
    });

    it('已經載入、正在看別的孩子：導頁時切過去，網址的 child 拿掉（之後自己切孩子不會被網址拉回）', async () => {
      const { router, service } = setupWithRouter();
      service.load();
      expect(service.activeChildId()).toBe('c1');
      await router.navigateByUrl('/parent/enrollment?child=c2#records');
      await new Promise((r) => setTimeout(r));
      expect(service.activeChildId()).toBe('c2');
      expect(router.url).toBe('/parent/enrollment#records');
    });

    it('推播點開：導頁完成後頁面才建出這支服務 → 建立時就讀現在的網址', async () => {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([{ path: '**', component: Blank }]),
          { provide: ChildrenService, useValue: { list: vi.fn(() => of({ data: CHILDREN })) } },
          { provide: AuthService, useValue: { user: () => ({ id: 'u1' }) } },
        ],
      });
      await TestBed.inject(Router).navigateByUrl('/parent/payments?child=c2');
      const service = TestBed.inject(ChildScopeService);
      service.load();
      expect(service.activeChildId()).toBe('c2');
    });

    it('不是這個家長的孩子（已解除綁定）→ 不切，維持原本的', async () => {
      const { router, service } = setupWithRouter();
      service.load();
      await router.navigateByUrl('/parent/schedule?child=gone');
      expect(service.activeChildId()).toBe('c1');
    });
  });
});
