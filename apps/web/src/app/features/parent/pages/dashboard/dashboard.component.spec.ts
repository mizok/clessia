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
      children: () => [],
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
});
