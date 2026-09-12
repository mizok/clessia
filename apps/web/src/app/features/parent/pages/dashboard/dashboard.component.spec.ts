import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { ChildScopeService } from '@core/child-scope.service';
import { DashboardComponent } from './dashboard.component';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let childScopeMock: {
    load: ReturnType<typeof vi.fn>;
    children: () => unknown[];
    activeChildId: () => string | null;
    activeChild: () => unknown;
    status: () => 'unloaded' | 'ready' | 'failed';
    canSwitch: () => boolean;
    setActiveChild: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    childScopeMock = {
      load: vi.fn(),
      // **不能留 `[]`**：`activeChildId` 只會從 `children[0]` 來，
      // 所以「0 個孩子卻有 activeChildId」是現實中不存在的狀態，
      // 而 `app-child-scope-gate`（#749）會把它擋掉。
      children: () => [{ id: 'child-1', name: '測試孩子' }],
      activeChildId: () => null,
      activeChild: () => null,
      status: () => 'ready' as const,
      canSwitch: () => false,
      setActiveChild: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [{ provide: ChildScopeService, useValue: childScopeMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', {
      label: 'Test',
      relativePath: '',
      absolutePath: '',
      role: undefined,
      icon: '',
      showInMenu: true,
    });
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('進頁時觸發孩子清單載入——試點證明 ChildScopeService 的接線跑得動', () => {
    expect(childScopeMock.load).toHaveBeenCalledTimes(1);
  });

  /**
   * #749：**接線測試。** `app-child-scope-gate` 的規則與措辭有自己的測試，
   * 但那不代表這一頁真的包了它 —— **元件寫好了不等於接上了**。
   *
   * 斷言的是「頁面內容在 gate **裡面**」而不只是「gate 存在」：
   * 放一個空的 gate 在旁邊也會讓後者通過，而那什麼都擋不住。
   */
  it('頁面內容包在 app-child-scope-gate 裡（#749）', () => {
    const gate = fixture.nativeElement.querySelector('app-child-scope-gate');

    expect(gate).toBeTruthy();
    expect(gate.querySelector('.empty-state')).toBeTruthy();
  });
});
