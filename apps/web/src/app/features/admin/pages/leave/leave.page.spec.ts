import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ConfirmEventType, ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import type { Campus } from '@core/campuses.service';
import type { LeaveRequest } from '@core/leave.service';
import { LeaveService } from '@core/leave.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { LeavePage } from './leave.page';
import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';

describe('LeavePage', () => {
  const leaveServiceMock = {
    list: vi.fn(() =>
      of({
        data: [],
        meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 },
      }),
    ),
    delete: vi.fn(() => of(void 0)),
  };
  const referenceDataServiceMock = {
    campuses: signal<Campus[]>([]),
    loadCampuses: vi.fn(),
  };
  const confirmationService = new ConfirmationService();
  const messageService = new MessageService();
  const dialogServiceMock = {
    open: vi.fn(),
  };

  let component: LeavePage;

  const activeRecord: LeaveRequest = {
    id: 'leave-1',
    orgId: 'org-1',
    studentId: 'student-1',
    studentName: '劉靖雯',
    startDate: '2000-01-01',
    endDate: '2999-12-31',
    startTime: null,
    endTime: null,
    reason: null,
    submittedBy: 'user-1',
    submittedByRole: 'admin',
    submittedByName: '管理員',
    createdAt: '2026-04-02T00:00:00Z',
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    leaveServiceMock.list.mockClear();
    leaveServiceMock.delete.mockClear();
    referenceDataServiceMock.loadCampuses.mockClear();
    vi.restoreAllMocks();
    dialogServiceMock.open.mockClear();

    await TestBed.configureTestingModule({
      imports: [LeavePage],
      providers: [
        { provide: LeaveService, useValue: leaveServiceMock },
        { provide: ReferenceDataService, useValue: referenceDataServiceMock },
      ],
    })
      .overrideComponent(LeavePage, {
        set: {
          providers: [
            { provide: MessageService, useValue: messageService },
            { provide: ConfirmationService, useValue: confirmationService },
            { provide: DialogService, useValue: dialogServiceMock },
          ],
        },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(LeavePage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', { label: '學生請假紀錄' });
    vi.spyOn(confirmationService, 'confirm');
    vi.spyOn(messageService, 'add');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('在進行中假期選擇完全刪除時，會延後開啟第二次確認視窗', () => {
    component['confirmDelete'](activeRecord);

    expect(confirmationService.confirm).toHaveBeenCalledTimes(1);

    const firstConfirm = vi.mocked(confirmationService.confirm).mock.calls[0]?.[0] as {
      reject?: (type?: ConfirmEventType) => void;
    };

    firstConfirm.reject?.(ConfirmEventType.REJECT);
    expect(confirmationService.confirm).toHaveBeenCalledTimes(1);

    vi.runAllTimers();

    expect(confirmationService.confirm).toHaveBeenCalledTimes(2);
    expect(vi.mocked(confirmationService.confirm).mock.calls[1]?.[0]).toMatchObject({
      header: '完全刪除請假紀錄',
      acceptLabel: '確認完全刪除',
    });
  });

  it('確認完全刪除後會以 full 模式呼叫刪除 API', () => {
    component['confirmDelete'](activeRecord);

    const firstConfirm = vi.mocked(confirmationService.confirm).mock.calls[0]?.[0] as {
      reject?: (type?: ConfirmEventType) => void;
    };

    firstConfirm.reject?.(ConfirmEventType.REJECT);
    vi.runAllTimers();

    const secondConfirm = vi.mocked(confirmationService.confirm).mock.calls[1]?.[0] as {
      accept?: () => void;
    };

    secondConfirm.accept?.();

    expect(leaveServiceMock.delete).toHaveBeenCalledWith(activeRecord.id, 'full');
  });

  it('opens audit log dialog for leave records', () => {
    component['openAuditLog']();

    // 同 attendance.page.spec：`showHeader: false` 讓 `header` 永遠不渲染（#448）
    expect(dialogServiceMock.open).toHaveBeenCalledWith(AuditLogDialogComponent, {
      width: '800px',
      modal: true,
      showHeader: false,
      appendTo: 'body',
      data: {
        resourceTypes: ['leave'],
      },
    });
  });
});
