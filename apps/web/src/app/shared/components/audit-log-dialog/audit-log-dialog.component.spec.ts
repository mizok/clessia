import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError, type Observable } from 'rxjs';
import { beforeAll, vi } from 'vitest';

import { AuditLogsService } from '@core/audit-logs.service';

import { AuditLogDialogComponent } from './audit-log-dialog.component';

/**
 * 這支元件原本沒有 spec。**它的錯誤分支與 `subject-manager` 的一字不差**
 * （`error: () => { this.loading.set(false); }`）—— 工單點名的正是這件事：
 * 那是 pattern 不是個案，所以兩支要一起收，而且兩支都要留下測試。
 */
// jsdom 沒有 ResizeObserver，給了 tabs 時 p-tablist 在 ngAfterViewInit 就會 new 一個（同 settings-shell.page.spec）
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as never;
});

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
    list: vi.fn<(params?: unknown) => Observable<unknown>>(() =>
      of({ data: logs, meta: { total: 1 } }),
    ),
  };

  async function setup(data: Record<string, unknown> = { resourceTypes: ['student'] }) {
    await TestBed.configureTestingModule({
      imports: [AuditLogDialogComponent],
      providers: [
        { provide: AuditLogsService, useValue: auditLogsServiceMock },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data } },
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

  // ── #2006：全站操作紀錄統一成這一支、A6 `.logt` 版型 ──────────────────────
  const log = (over: Record<string, unknown> = {}) => ({
    id: 'log-x',
    userId: 'u1',
    userName: '王小明',
    resourceType: 'session',
    resourceId: 's1',
    resourceName: '國二自然 A 班 10/12',
    action: 'cancel_session',
    details: {},
    createdAt: '2026-09-02T09:18:46Z',
    ...over,
  });
  const listText = () =>
    (
      (fixture.nativeElement as HTMLElement).querySelector('.audit-log-dialog__list')
        ?.textContent ?? ''
    ).replace(/\s+/g, ' ');

  it('手機清單一筆就有四欄的資訊（動作、對象、操作者、時間），不收進展開箭頭', async () => {
    auditLogsServiceMock.list.mockReturnValue(of({ data: [log()], meta: { total: 1 } }));
    await setup();
    const t = listText();
    expect(t).toContain('停課');
    expect(t).toContain('課堂 國二自然 A 班 10/12');
    expect(t).toContain('王小明');
    expect(t).toMatch(/2026-09-02 \d\d:18/);
    expect((fixture.nativeElement as HTMLElement).querySelector('app-responsive-table')).toBeNull();
  });

  it('操作者查不到名字：沒有 userId 寫「系統」、有 userId 寫「不明」，不是一條槓', async () => {
    auditLogsServiceMock.list.mockReturnValue(
      of({
        data: [
          log({ id: 'a', userId: null, userName: null }),
          log({ id: 'b', userId: 'u9', userName: null }),
        ],
        meta: { total: 2 },
      }),
    );
    await setup();
    const t = listText();
    expect(t).toContain('系統 ·');
    expect(t).toContain('不明 ·');
    expect(t).not.toContain('— ·');
  });

  it('給了 tabs：預設查第一個分頁的 resourceTypes，切分頁改查第二個、回第 1 頁、空狀態用分頁的字', async () => {
    auditLogsServiceMock.list.mockReturnValue(of({ data: [], meta: { total: 0 } }));
    await setup({
      tabs: [
        { label: '課堂異動', resourceTypes: ['session'], emptyText: '尚無課堂異動紀錄' },
        { label: '出勤紀錄', resourceTypes: ['attendance'], emptyText: '尚無出勤操作紀錄' },
      ],
    });
    expect(auditLogsServiceMock.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ resourceTypes: ['session'], page: 1 }),
    );
    expect(bodyText()).toContain('尚無課堂異動紀錄');

    (fixture.componentInstance as unknown as { onTab: (v: number) => void }).onTab(1);
    fixture.detectChanges();
    expect(auditLogsServiceMock.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ resourceTypes: ['attendance'], page: 1 }),
    );
    expect(bodyText()).toContain('尚無出勤操作紀錄');
  });
});
