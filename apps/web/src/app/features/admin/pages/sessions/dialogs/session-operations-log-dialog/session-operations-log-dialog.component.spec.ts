import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuditLogsService } from '@core/audit-logs.service';

import { SessionOperationsLogDialogComponent } from './session-operations-log-dialog.component';

describe('SessionOperationsLogDialogComponent', () => {
  let component: SessionOperationsLogDialogComponent;
  let fixture: ComponentFixture<SessionOperationsLogDialogComponent>;
  class ResizeObserverMock {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  const auditLogsServiceMock = {
    list: vi.fn((params: { resourceTypes?: string[] }) =>
      of({
        data: [
          {
            id: `log-${params.resourceTypes?.[0] ?? 'unknown'}`,
            userId: 'user-1',
            userName: '王老師',
            resourceType: params.resourceTypes?.[0] ?? 'session',
            resourceId: 'resource-1',
            resourceName: '示範資料',
            action: 'update',
            details: {},
            createdAt: '2026-04-08T10:00:00.000Z',
          },
        ],
        meta: { total: 1, page: 1, pageSize: 10, totalPages: 1 },
      }),
    ),
  };
  const dialogRefMock = { close: vi.fn() };

  beforeEach(async () => {
    auditLogsServiceMock.list.mockClear();
    dialogRefMock.close.mockClear();
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);

    await TestBed.configureTestingModule({
      imports: [SessionOperationsLogDialogComponent],
      providers: [
        { provide: AuditLogsService, useValue: auditLogsServiceMock },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionOperationsLogDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads session audit logs by default and renders both tabs', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(component).toBeTruthy();
    expect(auditLogsServiceMock.list).toHaveBeenCalledWith({
      resourceTypes: ['session'],
      page: 1,
      pageSize: 10,
    });
    expect(text).toContain('課堂異動');
    expect(text).toContain('出勤紀錄');
    expect(text).toContain('示範資料');
  });

  it('switches to attendance logs when attendance tab is selected', () => {
    (
      component as unknown as {
        selectedTab: { set: (value: 'session' | 'attendance') => void };
        onTabChange: (value: string | number) => void;
      }
    ).onTabChange('attendance');
    fixture.detectChanges();

    expect(auditLogsServiceMock.list).toHaveBeenLastCalledWith({
      resourceTypes: ['attendance'],
      page: 1,
      pageSize: 10,
    });
  });
});
