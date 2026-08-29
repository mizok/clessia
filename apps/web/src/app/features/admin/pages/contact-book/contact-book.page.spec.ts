import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { OverlayContainerService } from '@core/overlay-container.service';
import {
  ContactBookService,
  type ContactBookEntry,
  type ContactBookQueryParams,
  type MissingContactBookStudent,
} from '@core/contact-book.service';
import { StudentsService, type Student } from '@core/students.service';

import { ContactBookPage } from './contact-book.page';

const entry = (overrides?: Partial<ContactBookEntry>): ContactBookEntry => ({
  id: 'e1',
  studentId: 'stu-1',
  studentName: '陳小明',
  entryDate: '2026-08-29',
  content: '今天上課很專心。',
  lastEditedByName: '王老師',
  signedBy: null,
  signedAt: null,
  isSigned: false,
  ...overrides,
});

const student = (overrides?: Partial<Student>): Student =>
  ({ id: 'stu-1', name: '陳小明', grade: 'g3', ...overrides }) as Student;

const listResponse = (rows: ContactBookEntry[]) => ({
  data: rows,
  meta: { total: rows.length },
});

describe('ContactBookPage', () => {
  let component: ContactBookPage;
  let fixture: ComponentFixture<ContactBookPage>;

  const contactBook = {
    list: vi.fn((_params?: ContactBookQueryParams) => of(listResponse([]))),
    missing: vi.fn((_date?: string) => of({ data: [] as MissingContactBookStudent[], meta: { total: 0 } })),
    upsert: vi.fn(),
  };
  const students = {
    list: vi.fn(() => of({ data: [student()], summary: {}, meta: {} })),
  };

  beforeEach(async () => {
    contactBook.list.mockReset().mockReturnValue(of(listResponse([])));
    contactBook.missing.mockReset().mockReturnValue(of({ data: [], meta: { total: 0 } }));
    students.list.mockReset().mockReturnValue(of({ data: [student()], summary: {}, meta: {} }));

    await TestBed.configureTestingModule({
      imports: [ContactBookPage],
      providers: [
        { provide: ContactBookService, useValue: contactBook },
        { provide: StudentsService, useValue: students },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContactBookPage);
    fixture.componentRef.setInput('page', { label: '聯絡簿' });
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // 這支 API 沒有分頁，不帶區間等於全撈歷史
  it('進頁就帶日期區間，不會不帶區間全撈', () => {
    const params = contactBook.list.mock.calls[0][0]!;

    expect(params.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.from! < params.to!).toBe(true);
  });

  it('選定學生後用 studentId 篩', () => {
    contactBook.list.mockClear();

    component['onStudentChange'](student({ id: 'stu-9' }));

    expect(contactBook.list).toHaveBeenCalledWith(expect.objectContaining({ studentId: 'stu-9' }));
  });

  it('自動完成打字中不觸發查詢', () => {
    contactBook.list.mockClear();

    component['onStudentChange']('陳');

    expect(contactBook.list).not.toHaveBeenCalled();
  });

  // range 模式選第一個日期時 end 還是 null，那時候查會查成單日
  it('日期區間只選了一半時不查', () => {
    contactBook.list.mockClear();

    component['onDateRangeChange']([new Date('2026-08-01T00:00:00'), null as unknown as Date]);

    expect(contactBook.list).not.toHaveBeenCalled();
  });

  it('日期區間選滿才查', () => {
    contactBook.list.mockClear();

    component['onDateRangeChange']([
      new Date('2026-08-01T00:00:00'),
      new Date('2026-08-10T00:00:00'),
    ]);

    expect(contactBook.list).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-08-01', to: '2026-08-10' }),
    );
  });

  describe('未簽收篩選', () => {
    beforeEach(async () => {
      contactBook.list.mockReturnValue(
        of(
          listResponse([
            entry({ id: 'e1', isSigned: true }),
            entry({ id: 'e2', isSigned: false }),
            entry({ id: 'e3', isSigned: false }),
          ]),
        ),
      );
      component['load']();
      await fixture.whenStable();
    });

    it('預設看得到全部', () => {
      expect(component['visibleEntries']().length).toBe(3);
    });

    it('切到只看未簽收會濾掉已簽的', () => {
      component['toggleUnsignedOnly']();

      expect(component['visibleEntries']().length).toBe(2);
      expect(component['visibleEntries']().every((e) => !e.isSigned)).toBe(true);
    });

    // 資料完整（API 無分頁），所以前端篩不必重打 API
    it('切換未簽收不重打 API', () => {
      contactBook.list.mockClear();

      component['toggleUnsignedOnly']();

      expect(contactBook.list).not.toHaveBeenCalled();
    });

    // 摘要算的是整個區間，不是當頁 —— 這是這支 API 沒有分頁才敢寫的
    it('摘要數的是區間內全部，不是篩選後', () => {
      component['toggleUnsignedOnly']();

      expect(component['summary']()).toEqual({ total: 3, signed: 1, unsigned: 2 });
    });
  });

  describe('分頁', () => {
    beforeEach(async () => {
      const rows = Array.from({ length: 20 }, (_, i) => entry({ id: `e${i}` }));
      contactBook.list.mockReturnValue(of(listResponse(rows)));
      component['load']();
      await fixture.whenStable();
    });

    it('第一頁只顯示 15 筆', () => {
      expect(component['pagedEntries']().length).toBe(15);
    });

    it('第二頁顯示剩下的 5 筆', () => {
      component['onPageChange']({ first: 15, rows: 15, page: 1, pageCount: 2 });

      expect(component['pagedEntries']().length).toBe(5);
    });

    it('分頁總數是篩選後的筆數', () => {
      expect(component['pagination']().totalRecords).toBe(20);
    });

    // 停在第 2 頁換篩選會看到空白 —— 篩完要回第一頁
    it('切換未簽收會回到第一頁', () => {
      component['onPageChange']({ first: 15, rows: 15, page: 1, pageCount: 2 });
      expect(component['currentPage']()).toBe(2);

      component['toggleUnsignedOnly']();

      expect(component['currentPage']()).toBe(1);
    });
  });

  it('取數失敗時顯示失敗狀態而不是空清單', async () => {
    contactBook.list.mockReturnValue(throwError(() => new Error('boom')));
    component['load']();
    await fixture.whenStable();

    expect(component['failed']()).toBe(true);
    expect(component['loading']()).toBe(false);
  });

  it('清除篩選會同時清掉未簽收、學生與日期區間', () => {
    component['toggleUnsignedOnly']();
    component['onStudentChange'](student());
    contactBook.list.mockClear();

    component['clearFilters']();

    expect(component['unsignedOnly']()).toBe(false);
    expect(component['selectedStudent']()).toBeNull();
    expect(contactBook.list).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: undefined }),
    );
  });

  describe('當日待辦（還沒寫的）', () => {
    const missingStudent = (
      overrides?: Partial<MissingContactBookStudent>,
    ): MissingContactBookStudent => ({
      studentId: 'stu-1',
      studentName: '陳小明',
      classes: [{ classId: 'c1', className: '三年級數學' }],
      ...overrides,
    });

    it('進頁就查缺漏名單', () => {
      expect(contactBook.missing).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    });

    // 缺漏名單問的是「某一天」，列表問的是「一段區間」—— 綁在一起改一個會動到兩個
    it('缺漏名單的日期跟列表的區間各自獨立', () => {
      contactBook.list.mockClear();
      contactBook.missing.mockClear();

      component['onMissingDateChange'](new Date('2026-08-20T00:00:00'));

      expect(contactBook.missing).toHaveBeenCalledWith('2026-08-20');
      expect(contactBook.list).not.toHaveBeenCalled();
    });

    it('改列表區間不會重查缺漏名單', () => {
      contactBook.missing.mockClear();

      component['onDateRangeChange']([
        new Date('2026-08-01T00:00:00'),
        new Date('2026-08-10T00:00:00'),
      ]);

      expect(contactBook.missing).not.toHaveBeenCalled();
    });

    // 一份名單掛掉不該讓另一份也看不了
    it('缺漏名單失敗時列表照常，只有它自己顯示失敗', async () => {
      contactBook.missing.mockReturnValue(throwError(() => new Error('boom')));
      component['loadMissing']();
      await fixture.whenStable();

      expect(component['missingFailed']()).toBe(true);
      expect(component['failed']()).toBe(false);
    });

    // 同一個學生在兩個開了聯絡簿的班，要寫的仍然只有一則 —— 班名並列不是兩列
    it('多班的學生班名並列在同一列', () => {
      const target = missingStudent({
        classes: [
          { classId: 'c1', className: '三年級數學' },
          { classId: 'c2', className: '三年級英文' },
        ],
      });

      expect(component['classNamesOf'](target)).toBe('三年級數學、三年級英文');
    });

    it('補寫完的學生從待辦名單移掉', async () => {
      contactBook.missing.mockReturnValue(
        of({
          data: [missingStudent({ studentId: 'stu-1' }), missingStudent({ studentId: 'stu-2' })],
          meta: { total: 2 },
        }),
      );
      component['loadMissing']();
      await fixture.whenStable();
      expect(component['missing']().length).toBe(2);

      component['missing'].update((list) => list.filter((item) => item.studentId !== 'stu-1'));

      expect(component['missing']().length).toBe(1);
      expect(component['missing']()[0].studentId).toBe('stu-2');
    });
  });
});
