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

/** 後端非 overdue 路徑的 meta.total 回的是當頁筆數 —— mock 照實模擬，不要餵一個假的總數 */
const listResponse = (rows: Invoice[], page = 1) => ({
  data: rows,
  meta: { total: rows.length, page, pageSize: 20 },
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
  it('預設不送 overdue 參數', () => {
    expect(invoices.list).toHaveBeenCalledWith(
      expect.objectContaining({ overdue: undefined, studentId: undefined }),
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
    component['goToPage'](1);
    expect(component['pageIndex']()).toBe(2);

    component['toggleOverdueOnly']();

    expect(component['pageIndex']()).toBe(1);
  });

  it('翻頁不會翻到第 0 頁', () => {
    component['goToPage'](-1);

    expect(component['pageIndex']()).toBe(1);
  });

  // 後端的 meta.total 不可信，所以「有沒有下一頁」只能從當頁滿不滿判斷
  it('當頁不滿一頁時沒有下一頁', async () => {
    invoices.list.mockReturnValue(of(listResponse([invoice()])));
    component['load']();
    await fixture.whenStable();

    expect(component['hasNextPage']()).toBe(false);
  });

  it('當頁剛好滿 20 筆時允許翻下一頁', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => invoice({ id: `inv-${i}` }));
    invoices.list.mockReturnValue(of(listResponse(rows)));
    component['load']();
    await fixture.whenStable();

    expect(component['hasNextPage']()).toBe(true);
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

  it('清除篩選會同時清掉欠繳與學生', () => {
    component['toggleOverdueOnly']();
    component['onStudentChange'](student());
    invoices.list.mockClear();

    component['clearFilters']();

    expect(component['overdueOnly']()).toBe(false);
    expect(component['selectedStudent']()).toBeNull();
    expect(invoices.list).toHaveBeenCalledWith(
      expect.objectContaining({ overdue: undefined, studentId: undefined }),
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
});
