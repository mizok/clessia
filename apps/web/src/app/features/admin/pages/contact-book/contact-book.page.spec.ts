import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

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
    missing: vi.fn((_date?: string) =>
      of({ data: [] as MissingContactBookStudent[], meta: { total: 0 } }),
    ),
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

  // #508：載入中原本是整塊被一行文字取代（沒有骨架尺寸，資料到了會跳版）。
  // 改成骨架列表後這裡改斷言骨架元素，不是文字。
  it('缺漏名單載入中顯示骨架列表，不是整塊被文字取代', async () => {
    contactBook.missing.mockReset().mockReturnValue(NEVER);

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ContactBookPage],
      providers: [
        { provide: ContactBookService, useValue: contactBook },
        { provide: StudentsService, useValue: students },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(ContactBookPage);
    f.componentRef.setInput('page', { label: '聯絡簿' });
    f.detectChanges();

    expect(f.nativeElement.querySelector('.skeleton-list')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.skeleton-bar').length).toBeGreaterThan(0);
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
      expect(contactBook.missing).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
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

  describe('A6 對齊（CB1 CB2 CB4）', () => {
    const miss = (id: string, ...classes: string[]): MissingContactBookStudent => ({
      studentId: id,
      studentName: `學生${id}`,
      classes: classes.map((c) => ({ classId: c, className: `班${c}` })),
    });
    const el = () => fixture.nativeElement as HTMLElement;

    async function load(
      entries: ContactBookEntry[],
      missing: MissingContactBookStudent[] = [],
    ): Promise<void> {
      contactBook.list.mockReturnValue(of(listResponse(entries)));
      contactBook.missing.mockReturnValue(of({ data: missing, meta: { total: missing.length } }));
      component['load']();
      component['loadMissing']();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('CB1 缺漏名單一班一列，列上寫還差幾則、名字是補寫鈕', async () => {
      await load([], [miss('1', 'A'), miss('2', 'A'), miss('3', 'B', 'A')]);

      const rows = Array.from(el().querySelectorAll('[data-testid="missing-class"]'));
      expect(
        rows.map((r) => r.querySelector('[data-testid="missing-left"]')?.textContent?.trim()),
      ).toEqual(['還差 2 則', '還差 1 則']);
      expect(rows[0].querySelectorAll('[data-testid="missing-write"]').length).toBe(2);
    });

    it('CB1 按學生名字就是補寫該生', async () => {
      await load([], [miss('1', 'A')]);
      const write = vi.spyOn(component as never, 'writeMissing' as never);

      (el().querySelector('[data-testid="missing-write"]') as HTMLButtonElement).click();

      expect(write).toHaveBeenCalledWith(expect.objectContaining({ studentId: '1' }));
    });

    it('CB2 依日分段，只有最新一天展開，每段寫幾則幾則未簽', async () => {
      await load([
        entry({ id: 'a', entryDate: '2026-08-29', isSigned: true }),
        entry({ id: 'b', entryDate: '2026-08-29' }),
        entry({ id: 'c', entryDate: '2026-08-28' }),
      ]);

      const days = Array.from(el().querySelectorAll<HTMLDetailsElement>('[data-testid="day"]'));
      expect(days.map((d) => d.open)).toEqual([true, false]);
      expect(days[0].querySelector('[data-testid="day-meta"]')?.textContent?.trim()).toBe(
        '2 則 · 1 則未簽收',
      );
    });

    it('CB4 篩選中所有日段展開，摘要多一句顯示 N 則', async () => {
      await load([
        entry({ id: 'a', entryDate: '2026-08-29' }),
        entry({ id: 'b', entryDate: '2026-08-28' }),
        entry({ id: 'c', entryDate: '2026-08-27', isSigned: true }),
      ]);

      component['toggleUnsignedOnly']();
      fixture.detectChanges();

      const days = Array.from(el().querySelectorAll<HTMLDetailsElement>('[data-testid="day"]'));
      expect(days.map((d) => d.open)).toEqual([true, true]);
      expect(el().querySelector('[data-testid="shown"]')?.textContent).toBe('2');
    });

    it('簽收欄寫台北時間，沒簽的寫未簽收', async () => {
      await load([
        entry({ id: 'a', isSigned: true, signedAt: '2026-08-29T12:15:00Z' }),
        entry({ id: 'b' }),
      ]);

      expect(el().querySelector('[data-testid="signed"]')?.textContent).toContain('20:15');
      expect(el().querySelectorAll('[data-testid="unsigned"]').length).toBe(1);
    });

    it('缺漏日期下拉選日期就查那天；選其他日期只出現 datepicker 不查', () => {
      contactBook.missing.mockClear();

      component['onMissingPick']('2026-08-27');
      expect(contactBook.missing).toHaveBeenCalledWith('2026-08-27');

      contactBook.missing.mockClear();
      component['onMissingPick']('other');
      expect(contactBook.missing).not.toHaveBeenCalled();
      expect(component['missingPick']()).toBe('other');
    });
  });

  /**
   * #738：行政版那句「這裡是行政的補寫入口」現在要由呼叫端標明對象才會出現
   * （對話框的預設是中性版 —— 失效方向選「少講一句」而不是「講錯一句」）。
   *
   * **所以這條接線不接上，行政就會少掉一句對他有用的話**，而且不會有任何東西報錯。
   *
   * ⚠️ 只有 `writeMissing` 需要標 —— `openEntry` 是用 `{ entry }` 開的，
   * **永遠走不到那個 `@else` 分支**（對話框那邊有一支測試釘著這件事），
   * 標了是噪音。
   */
  describe('#738 補寫缺漏時要標明對象是行政', () => {
    it('writeMissing 開對話框時帶 audience: admin', async () => {
      const dialogServiceMock = { open: vi.fn(() => ({ onClose: NEVER })) };

      // 外層 beforeEach 已經建過元件 —— 不 reset 的話 `configureTestingModule` 會丟
      // 「test module has already been instantiated」
      TestBed.resetTestingModule();

      await TestBed.configureTestingModule({
        imports: [ContactBookPage],
        providers: [
          { provide: ContactBookService, useValue: contactBook },
          { provide: StudentsService, useValue: students },
          { provide: OverlayContainerService, useValue: { getContainer: () => null } },
        ],
      })
        // 頁面在 @Component 的 providers 裡自己給 DialogService —— 元件層級會蓋過
        // TestBed 的，必須用 overrideComponent 才換得掉（作法同 staff.page.spec）
        .overrideComponent(ContactBookPage, {
          set: {
            providers: [MessageService, { provide: DialogService, useValue: dialogServiceMock }],
          },
        })
        .compileComponents();

      const f = TestBed.createComponent(ContactBookPage);
      f.componentRef.setInput('page', { label: '聯絡簿' });
      await f.whenStable();

      (
        f.componentInstance as unknown as {
          writeMissing: (t: MissingContactBookStudent) => void;
        }
      ).writeMissing({ studentId: 'stu-9', studentName: '王柏睿' } as MissingContactBookStudent);

      const lastCall = dialogServiceMock.open.mock.calls.at(-1) as unknown as [
        unknown,
        { data: { audience?: string } },
      ];

      expect(lastCall[1].data.audience).toBe('admin');
    });
  });
});
