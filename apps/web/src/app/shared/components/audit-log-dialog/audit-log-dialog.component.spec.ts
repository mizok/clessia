import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AuditLogsService } from '@core/audit-logs.service';

import { AuditLogDialogComponent } from './audit-log-dialog.component';

/**
 * 這支元件原本沒有 spec。**它的錯誤分支與 `subject-manager` 的一字不差**
 * （`error: () => { this.loading.set(false); }`）—— 工單點名的正是這件事：
 * 那是 pattern 不是個案，所以兩支要一起收，而且兩支都要留下測試。
 */
describe('AuditLogDialogComponent', () => {
  let fixture: ComponentFixture<AuditLogDialogComponent>;

  const logs = [
    {
      id: 'log-1',
      action: 'update',
      resourceType: 'student',
      resourceId: 'student-1',
      actorName: '王小明',
      createdAt: '2026-09-13T00:00:00Z',
      details: null,
    },
  ];
  const auditLogsServiceMock = {
    list: vi.fn(() => of({ data: logs, meta: { total: 1 } })),
  };

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [AuditLogDialogComponent],
      providers: [
        { provide: AuditLogsService, useValue: auditLogsServiceMock },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data: { resourceTypes: ['student'] } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuditLogDialogComponent);
    fixture.detectChanges();
  }

  const bodyText = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(() => {
    vi.clearAllMocks();
    auditLogsServiceMock.list.mockReturnValue(of({ data: logs, meta: { total: 1 } }));
  });

  it('取數成功時渲染紀錄', async () => {
    await setup();

    expect(bodyText()).not.toContain('載入失敗');
    expect(bodyText()).not.toContain('尚無操作紀錄');
  });

  /**
   * **#812：取數失敗時不能說「尚無操作紀錄」。**
   * 量到的實例是 44 筆紀錄的對話框在失敗時渲染成空 —— 而唯一的訊號是「沒有」。
   */
  it('取數失敗時渲染「載入失敗」，不說「尚無操作紀錄」', async () => {
    auditLogsServiceMock.list.mockReturnValue(throwError(() => new Error('boom')));

    await setup();

    expect(bodyText()).toContain('載入失敗');
    expect(bodyText()).not.toContain('尚無操作紀錄');
  });

  it('重試鈕真的重打', async () => {
    auditLogsServiceMock.list.mockReturnValueOnce(throwError(() => new Error('boom')));

    await setup();
    expect(bodyText()).toContain('載入失敗');

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('app-load-failed button')!
      .click();
    fixture.detectChanges();

    expect(auditLogsServiceMock.list).toHaveBeenCalledTimes(2);
    expect(bodyText()).not.toContain('載入失敗');
  });

  // 真的空清單仍然要說「尚無操作紀錄」—— 不然這支 PR 就是把空狀態換成錯誤狀態
  it('真的沒有紀錄時說「尚無操作紀錄」，不是「載入失敗」', async () => {
    auditLogsServiceMock.list.mockReturnValue(of({ data: [], meta: { total: 0 } }));

    await setup();

    expect(bodyText()).toContain('尚無操作紀錄');
    expect(bodyText()).not.toContain('載入失敗');
  });
});
