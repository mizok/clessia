import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { OverlayContainerService } from '@core/overlay-container.service';
import { InvoicesService, type Invoice } from '@core/invoices.service';
import { StudentsService, type Student } from '@core/students.service';

import { PaymentsPage } from './payments.page';

const invoice = (overrides?: Partial<Invoice>): Invoice => ({
  id: 'inv-1',
  orgId: 'org-1',
  studentId: 'stu-1',
  studentName: '陳小明',
  issuedAt: '2026-08-01',
  dueDate: '2026-08-15',
  note: null,
  status: 'unpaid',
  total: 4500,
  netPaid: 0,
  items: [],
  payments: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

const student = (overrides?: Partial<Student>): Student =>
  ({
    id: 'stu-1',
    name: '陳小明',
    grade: 'g7',
    ...overrides,
  }) as Student;

/**
 * `meta.total` 是**篩後全體**的筆數，不是當頁長度（PR #64 修正）——
 * 所以 mock 要能分開表達「這一頁回幾筆」與「總共幾筆」。
 */
const listResponse = (rows: Invoice[], total = rows.length, page = 1) => ({
  data: rows,
  meta: { total, page, pageSize: 20 },
});

describe('PaymentsPage', () => {
  let component: PaymentsPage;
  let fixture: ComponentFixture<PaymentsPage>;

  const invoices = {
    list: vi.fn(() => of(listResponse([]))),
    get: vi.fn(),
    create: vi.fn(),
    addItem: vi.fn(),
    removeItem: vi.fn(),
    recordPayment: vi.fn(),
    listReminders: vi.fn(() => of({ data: [] })),
    createReminder: vi.fn(),
  };
  const students = {
    list: vi.fn(() => of({ data: [student()], summary: {}, meta: {} })),
  };

  beforeEach(async () => {
    invoices.list.mockReset().mockReturnValue(of(listResponse([])));
    students.list.mockReset().mockReturnValue(of({ data: [student()], summary: {}, meta: {} }));

    await TestBed.configureTestingModule({
      imports: [PaymentsPage],
      providers: [
        { provide: InvoicesService, useValue: invoices },
        { provide: StudentsService, useValue: students },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PaymentsPage);
    fixture.componentRef.setInput('page', { label: '繳費紀錄' });
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('進頁就取第一頁帳單', () => {
    expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));
  });

  // 沒有篩選時不要送 overdue —— 送 overdue: false 會讓後端走完全不同的那條查詢路徑
  it('預設不送 overdue 與 status 參數', () => {
    expect(invoices.list).toHaveBeenCalledWith(
      expect.objectContaining({ overdue: undefined, status: undefined, studentId: undefined }),
    );
  });

  it('切到只看欠繳會帶 overdue=true 重新取數', () => {
    invoices.list.mockClear();

    component['toggleOverdueOnly']();

    expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ overdue: true }));
  });

  // 學生搜尋的 API 只吃 uuid，不吃姓名關鍵字 —— 選定之後帶的必須是 id
  it('選定學生後用 studentId 篩，不是姓名', () => {
    invoices.list.mockClear();

    component['onStudentChange'](student({ id: 'stu-9' }));

    expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ studentId: 'stu-9' }));
  });

  // 打字中間 autocomplete 的值是字串，那還不是一個選定的學生
  it('自動完成打字中不觸發列表查詢', () => {
    invoices.list.mockClear();

    component['onStudentChange']('陳');

    expect(invoices.list).not.toHaveBeenCalled();
  });

  it('換篩選條件時回到第一頁', () => {
    component['onPageChange']({ first: 20, rows: 20, page: 1, pageCount: 3 });
    expect(component['pageIndex']()).toBe(2);

    component['toggleOverdueOnly']();

    expect(component['pageIndex']()).toBe(1);
  });

  // total 是篩後全體，分頁器要拿它算總頁數 —— 拿當頁長度算會永遠只有一頁
  it('分頁總數取 meta.total，不是當頁筆數', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => invoice({ id: `inv-${i}` }));
    invoices.list.mockReturnValue(of(listResponse(rows, 137)));
    component['load']();
    await fixture.whenStable();

    expect(component['pagination']().totalRecords).toBe(137);
  });

  it('翻頁會帶新的 page 重打 API', async () => {
    invoices.list.mockClear().mockReturnValue(of(listResponse([invoice()], 137)));

    component['onPageChange']({ first: 40, rows: 20, page: 2, pageCount: 7 });
    await fixture.whenStable();

    expect(component['pageIndex']()).toBe(3);
    expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ page: 3 }));
  });

  // 狀態是推導值，前端篩只篩得到當頁 —— 一定要打後端
  it('狀態篩選打後端，不在前端篩', () => {
    invoices.list.mockClear();

    component['onStatusChange']('partial');

    expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'partial' }));
  });

  it('狀態清成全部時不送 status', () => {
    component['onStatusChange']('paid');
    invoices.list.mockClear();

    component['onStatusChange'](null);

    expect(invoices.list).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
  });

  // 逾期是衍生標記不是第四種狀態，兩個條件並用是常見組合（billing-rules 規則 4）
  it('狀態與欠繳可以並用', () => {
    component['onStatusChange']('partial');
    invoices.list.mockClear();

    component['toggleOverdueOnly']();

    expect(invoices.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'partial', overdue: true }),
    );
  });

  it('取數失敗時把總數歸零，不留上一次的數字', async () => {
    invoices.list.mockReturnValue(of(listResponse([invoice()], 137)));
    component['load']();
    await fixture.whenStable();
    expect(component['pagination']().totalRecords).toBe(137);

    invoices.list.mockReturnValue(throwError(() => new Error('boom')));
    component['load']();
    await fixture.whenStable();

    expect(component['pagination']().totalRecords).toBe(0);
  });

  // 整頁空白比一個錯誤訊息更難查 —— 失敗要看得見
  it('取數失敗時顯示失敗狀態而不是空清單', async () => {
    invoices.list.mockReturnValue(throwError(() => new Error('boom')));
    component['load']();
    await fixture.whenStable();

    expect(component['failed']()).toBe(true);
    expect(component['loading']()).toBe(false);
  });

  it('重試會再打一次 API', async () => {
    invoices.list.mockReturnValue(throwError(() => new Error('boom')));
    component['load']();
    await fixture.whenStable();

    invoices.list.mockClear().mockReturnValue(of(listResponse([invoice()])));
    component['load']();
    await fixture.whenStable();

    expect(invoices.list).toHaveBeenCalledTimes(1);
    expect(component['failed']()).toBe(false);
  });

  it('清除篩選會同時清掉欠繳、狀態與學生', () => {
    component['toggleOverdueOnly']();
    component['onStatusChange']('unpaid');
    component['onStudentChange'](student());
    invoices.list.mockClear();

    component['clearFilters']();

    expect(component['overdueOnly']()).toBe(false);
    expect(component['statusFilter']()).toBeNull();
    expect(component['selectedStudent']()).toBeNull();
    expect(invoices.list).toHaveBeenCalledWith(
      expect.objectContaining({ overdue: undefined, status: undefined, studentId: undefined }),
    );
  });

  describe('狀態顏色', () => {
    it('繳清是綠的', () => {
      expect(component['statusSeverity'](invoice({ status: 'paid' }))).toBe('success');
    });

    it('部分繳是黃的', () => {
      expect(component['statusSeverity'](invoice({ status: 'partial' }))).toBe('warn');
    });

    it('未繳是紅的', () => {
      expect(component['statusSeverity'](invoice({ status: 'unpaid' }))).toBe('danger');
    });
  });

  // 開完帳最常見的下一步就是收錢（新生報名當場繳定金）
  it('開帳成功後直接打開那張帳單的詳情', () => {
    const opened: unknown[] = [];
    const dialogService = (component as unknown as { dialogService: { open: unknown } })
      .dialogService as { open: (c: unknown, cfg: { data?: unknown }) => unknown };
    const originalOpen = dialogService.open.bind(dialogService);
    dialogService.open = (c: unknown, cfg: { data?: unknown }) => {
      opened.push(cfg?.data);
      return { onClose: of(undefined) };
    };

    const created = invoice({ id: 'inv-new' });
    (component as unknown as { openDetail: (i: Invoice) => void }).openDetail(created);

    expect(opened).toHaveLength(1);
    expect((opened[0] as { invoice: Invoice }).invoice.id).toBe('inv-new');
    dialogService.open = originalOpen;
  });
});
