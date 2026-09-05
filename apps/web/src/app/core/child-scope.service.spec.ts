import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ChildrenService, type Child, type ChildrenListResponse } from './children.service';
import { ChildScopeService } from './child-scope.service';

const CHILDREN: Child[] = [
  { id: 'c1', name: '王小明', grade: 'g4', school: '中山國小' },
  { id: 'c2', name: '王小美', grade: 'g6', school: '中山國小' },
];

function setup(children: Child[] = CHILDREN) {
  const childrenServiceMock = { list: vi.fn(() => of({ data: children })) };
  TestBed.configureTestingModule({
    providers: [{ provide: ChildrenService, useValue: childrenServiceMock }],
  });
  const service = TestBed.inject(ChildScopeService);
  return { service, childrenServiceMock };
}

describe('ChildScopeService', () => {
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

  it('載入失敗時不卡死在 loading，且允許之後重試', () => {
    const childrenServiceMock = {
      list: vi.fn((): Observable<ChildrenListResponse> => throwError(() => new Error('boom'))),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ChildrenService, useValue: childrenServiceMock }],
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
});
