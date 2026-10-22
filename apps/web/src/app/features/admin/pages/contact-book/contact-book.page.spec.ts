import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import { signal } from '@angular/core';
import { OverlayContainerService } from '@core/overlay-container.service';
import { SystemClockService } from '@core/system-clock.service';
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
  signedByName: null,
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
  // 2027-03-05＝週五；刻意與真實日期不同，元件若改用 new Date() 就會紅
  const today = signal('2027-03-05');
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
    today.set('2027-03-05');

    await TestBed.configureTestingModule({
      imports: [ContactBookPage],
      providers: [
        MessageService,
        { provide: ContactBookService, useValue: contactBook },
        { provide: StudentsService, useValue: students },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
        { provide: SystemClockService, useValue: { todayTaipei: today } },
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
        MessageService,
        { provide: ContactBookService, useValue: contactBook },
        { provide: StudentsService, useValue: students },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(ContactBookPage);
    f.componentRef.setInput('page', { label: '聯絡簿' });
    f.detectChanges();

    expect(f.nativeElement.querySelector('.skeleton-list')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.skeleton-list .skeleton').length).toBeGreaterThan(0);
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

  describe('C1 色面固定數字與白框鈕', () => {
    const q = (id: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`) as HTMLElement;
    const entry = (id: string, signed: boolean): ContactBookEntry =>
      ({
        id,
        studentId: `s${id}`,
        studentName: `學生${id}`,
        entryDate: '2027-03-04',
        content: '今天表現很好',
        lastEditedByName: '王老師',
        signedBy: signed ? '家長' : null,
        signedByName: null,
        signedAt: signed ? '2027-03-04T12:00:00Z' : null,
        isSigned: signed,
      }) as unknown as ContactBookEntry;
    const missingOf = (n: number): MissingContactBookStudent[] =>
      Array.from({ length: n }, (_, i) => ({
        studentId: `m${i}`,
        studentName: `缺${i}`,
        classes: [{ classId: 'c', className: '班' }],
      }));
    /** 重新建立元件：hero 的兩支請求在 ngOnInit 打 */
    const boot = async (opts: {
      missing?: MissingContactBookStudent[];
      entries?: ContactBookEntry[];
      failMissing?: boolean;
      failList?: boolean;
    }) => {
      contactBook.missing
        .mockReset()
        .mockReturnValue(
          opts.failMissing
            ? throwError(() => new Error('boom'))
            : of({ data: opts.missing ?? [], meta: { total: opts.missing?.length ?? 0 } }),
        );
      contactBook.list
        .mockReset()
        .mockReturnValue(
          opts.failList
            ? throwError(() => new Error('boom'))
            : of(listResponse(opts.entries ?? [])),
        );
      fixture = TestBed.createComponent(ContactBookPage);
      fixture.componentRef.setInput('page', { label: '聯絡簿' });
      component = fixture.componentInstance;
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };

    it('兩個固定數字：今天還沒寫＝今天的缺漏人數；這週還沒簽＝週一到今天未簽的則數', async () => {
      await boot({
        missing: missingOf(6),
        entries: [entry('1', false), entry('2', false), entry('3', true)],
      });
      expect(q('hero-missing').textContent!.replace(/\s+/g, '')).toContain('6則今天還沒寫');
      expect(q('hero-unsigned').textContent!.replace(/\s+/g, '')).toContain('2則這週家長還沒簽');
      // 請求：缺漏用今天；列表用「週一到今天」（2027-03-05 是週五 → 3/1）
      expect(contactBook.missing).toHaveBeenCalledWith('2027-03-05');
      expect(contactBook.list.mock.calls.map((c) => [c[0]!.from, c[0]!.to])).toContainEqual([
        '2027-03-01',
        '2027-03-05',
      ]);
    });

    it('週一當天＝只看今天；週日＝回 6 天前的週一（邊界 ±1）', async () => {
      for (const [day, from] of [
        ['2027-03-01', '2027-03-01'],
        ['2027-03-07', '2027-03-01'],
        ['2027-03-08', '2027-03-08'],
      ] as const) {
        today.set(day);
        await boot({});
        expect(contactBook.list.mock.calls.map((c) => [c[0]!.from, c[0]!.to])).toContainEqual([
          from,
          day,
        ]);
      }
    });

    it('0 與 1 都照實顯示（不是「沒有」）', async () => {
      await boot({ missing: missingOf(0), entries: [entry('1', false)] });
      expect(q('hero-missing').textContent).toContain('0');
      expect(q('hero-unsigned').textContent).toContain('1');
    });

    it('不隨篩選走：切未簽收、改缺漏名單日期、換期間，兩個數字都不變也不重打 hero', async () => {
      await boot({ missing: missingOf(6), entries: [entry('1', false)] });
      const before = [q('hero-missing').textContent, q('hero-unsigned').textContent];
      component['toggleUnsignedOnly']();
      component['onMissingPick']('2027-03-04');
      component['onDateRangeChange']([
        new Date('2027-02-01T00:00:00'),
        new Date('2027-02-05T00:00:00'),
      ]);
      fixture.detectChanges();
      expect([q('hero-missing').textContent, q('hero-unsigned').textContent]).toEqual(before);
    });

    it('請求失敗顯示「—」，不宣稱 0；一邊失敗不影響另一邊', async () => {
      await boot({ failMissing: true, entries: [entry('1', false)] });
      expect(q('hero-missing').textContent).toContain('—');
      expect(q('hero-unsigned').textContent).toContain('1');
      await boot({ missing: missingOf(3), failList: true });
      expect(q('hero-missing').textContent).toContain('3');
      expect(q('hero-unsigned').textContent).toContain('—');
    });

    it('台北時鐘跨過午夜後重載（補寫完成）用新的今天', async () => {
      await boot({ missing: missingOf(2) });
      today.set('2027-03-06');
      contactBook.missing.mockClear();
      component['loadHero']();
      expect(contactBook.missing).toHaveBeenCalledWith('2027-03-06');
    });

    // #1877：跟同列的搜尋框、期間下拉同高 44（原本桌機 36，比另外兩個矮一截）；按下照 A6 `.toggle` 多一圈內框線
    it('「只看未簽收」是白框鈕：aria-pressed 跟狀態、邊框黑／灰、文字不變、兩種寬度都 44', async () => {
      await boot({});
      const btn = q('unsigned-only');
      expect(btn.tagName).toBe('BUTTON');
      expect(btn.getAttribute('aria-pressed')).toBe('false');
      expect([...btn.classList]).toEqual(
        expect.arrayContaining(['bg-white', 'border-zinc-300', 'h-11']),
      );
      expect(btn.className).not.toMatch(/wide:h-/);
      btn.click();
      fixture.detectChanges();
      expect(btn.getAttribute('aria-pressed')).toBe('true');
      expect(btn.classList).toContain('border-zinc-900');
      expect(btn.classList).toContain('shadow-[inset_0_0_0_1px_var(--zinc-900)]');
      expect(btn.classList).not.toContain('border-zinc-300');
      expect(btn.textContent!.trim()).toBe('只看未簽收');
      expect(fixture.nativeElement.querySelector('app-filter-chip')).toBeNull();
    });

    // #1877：兩個區塊用同一套規則 —— 控制項同一條中線、下拉不畫上方標籤（讀屏名稱還在）
    it('篩選列與「還沒寫的」標題列：items-center、兩個下拉 hideLabel', async () => {
      await boot({});
      const el = fixture.nativeElement as HTMLElement;
      const bar = el.querySelector('[role="search"][aria-label="篩選聯絡簿"]')!;
      expect(bar.classList).toContain('items-center');
      expect(bar.querySelector('.clessia-filter-search')!.classList).toContain('min-h-11');
      const head = el.querySelector('#cb-missing-h')!.parentElement!;
      expect(head.classList).toContain('items-center');
      const labels = [...el.querySelectorAll('app-select-field')].map(
        (f) => f.querySelector('span[id^="select-field-"]') as HTMLElement,
      );
      expect(labels.map((l) => l.textContent!.trim())).toEqual(['缺漏名單的日期', '期間']);
      for (const l of labels) expect(l.classList).toContain('sr-only');
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

    // #1705：同一組一次只開一個（使用者 2026-10-16 指定）—— 篩選中也只展開最新一天（原本 A6 是全部展開）
    it('CB4 篩選中只展開最新一天（同組互斥），摘要多一句顯示 N 則', async () => {
      await load([
        entry({ id: 'a', entryDate: '2026-08-29' }),
        entry({ id: 'b', entryDate: '2026-08-28' }),
        entry({ id: 'c', entryDate: '2026-08-27', isSigned: true }),
      ]);

      component['toggleUnsignedOnly']();
      fixture.detectChanges();

      const days = Array.from(el().querySelectorAll<HTMLDetailsElement>('[data-testid="day"]'));
      expect(days.map((d) => d.open)).toEqual([true, false]);
      expect(new Set(days.map((d) => d.getAttribute('name')))).toEqual(
        new Set(['contact-book-days']),
      );
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
  describe('C2 簽收者姓名與期間下拉', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const datepicker = () => el().querySelector('p-datepicker[selectionmode="range"]');

    async function render(entries: ContactBookEntry[]): Promise<void> {
      contactBook.list.mockReturnValue(of(listResponse(entries)));
      component['load']();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('簽收欄：有姓名寫「姓名 時間 簽」，沒姓名寫「已簽收 時間」', async () => {
      await render([
        entry({
          id: 'a',
          isSigned: true,
          signedByName: '林太太',
          signedAt: '2026-08-29T12:06:00Z',
        }),
        entry({ id: 'b', isSigned: true, signedByName: null, signedAt: '2026-08-29T12:07:00Z' }),
      ]);

      const cells = Array.from(el().querySelectorAll('[data-testid="signed"]')).map((n) =>
        n.textContent?.replace(/\s+/g, ' ').trim(),
      );
      expect(cells).toEqual(['林太太 20:06 簽', '已簽收 20:07']);
    });

    it('預設是最近 7 天，範圍選擇器收起來', () => {
      expect(component['periodPick']()).toBe('7');
      expect(datepicker()).toBeNull();
    });

    it.each([
      ['7', '2027-02-27'],
      ['14', '2027-02-20'],
      ['30', '2027-02-04'],
    ])('選最近 %s 天：to＝今天、from＝往回 N-1 天（含今天）', (days, from) => {
      contactBook.list.mockClear();

      component['onPeriodPick'](days);

      expect(contactBook.list).toHaveBeenCalledTimes(1);
      expect(contactBook.list).toHaveBeenCalledWith(
        expect.objectContaining({ from, to: '2027-03-05' }),
      );
    });

    it('選「自訂區間…」才出現範圍選擇器，而且不查；選滿區間才查；切回天數就收起來', async () => {
      contactBook.list.mockClear();

      component['onPeriodPick']('custom');
      fixture.detectChanges();
      expect(contactBook.list).not.toHaveBeenCalled();
      expect(datepicker()).not.toBeNull();

      component['onDateRangeChange']([
        new Date('2027-01-01T00:00:00'),
        new Date('2027-01-31T00:00:00'),
      ]);
      expect(contactBook.list).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2027-01-01', to: '2027-01-31' }),
      );

      component['onPeriodPick']('7');
      fixture.detectChanges();
      expect(datepicker()).toBeNull();
    });

    it('換期間只重查列表，不動缺漏名單與色面兩個數字', () => {
      contactBook.missing.mockClear();
      contactBook.list.mockClear();

      component['onPeriodPick']('30');

      expect(contactBook.missing).not.toHaveBeenCalled();
      expect(contactBook.list).toHaveBeenCalledTimes(1);
    });

    it('亂序：先選 30 天、再選 7 天，30 天的回應晚到也不能蓋掉 7 天的結果', () => {
      const slow = new Subject<ReturnType<typeof listResponse>>();
      const fast = new Subject<ReturnType<typeof listResponse>>();
      contactBook.list.mockReset().mockReturnValueOnce(slow).mockReturnValueOnce(fast);

      component['onPeriodPick']('30');
      component['onPeriodPick']('7');
      fast.next(listResponse([entry({ id: 'new' })]));
      slow.next(listResponse([entry({ id: 'old-1' }), entry({ id: 'old-2' })]));

      expect(component['entries']().map((e) => e.id)).toEqual(['new']);
      expect(component['loading']()).toBe(false);
    });

    it('亂序：舊請求晚到的失敗也不能把新結果換成失敗畫面', () => {
      const slow = new Subject<ReturnType<typeof listResponse>>();
      const fast = new Subject<ReturnType<typeof listResponse>>();
      contactBook.list.mockReset().mockReturnValueOnce(slow).mockReturnValueOnce(fast);

      component['onPeriodPick']('30');
      component['onPeriodPick']('7');
      fast.next(listResponse([entry({ id: 'new' })]));
      slow.error(new Error('late'));

      expect(component['failed']()).toBe(false);
      expect(component['entries']().map((e) => e.id)).toEqual(['new']);
    });

    it('清除篩選把期間拉回最近 7 天', () => {
      component['onPeriodPick']('custom');
      contactBook.list.mockClear();

      component['clearFilters']();

      expect(component['periodPick']()).toBe('7');
      expect(contactBook.list).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2027-02-27', to: '2027-03-05' }),
      );
    });
  });

  describe('#738 補寫缺漏時要標明對象是行政', () => {
    it('writeMissing 開對話框時帶 audience: admin', async () => {
      const dialogServiceMock = { open: vi.fn(() => ({ onClose: NEVER })) };

      // 外層 beforeEach 已經建過元件 —— 不 reset 的話 `configureTestingModule` 會丟
      // 「test module has already been instantiated」
      TestBed.resetTestingModule();

      await TestBed.configureTestingModule({
        imports: [ContactBookPage],
        providers: [
          MessageService,
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

    it('補寫完成（對話框關閉回傳那一則）→ 色面兩個數字重載', async () => {
      const closed = new Subject<unknown>();
      const dialogServiceMock = { open: vi.fn(() => ({ onClose: closed })) };
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [ContactBookPage],
        providers: [
          MessageService,
          { provide: ContactBookService, useValue: contactBook },
          { provide: StudentsService, useValue: students },
          { provide: OverlayContainerService, useValue: { getContainer: () => null } },
          { provide: SystemClockService, useValue: { todayTaipei: today } },
        ],
      })
        .overrideComponent(ContactBookPage, {
          set: {
            providers: [MessageService, { provide: DialogService, useValue: dialogServiceMock }],
          },
        })
        .compileComponents();
      const f = TestBed.createComponent(ContactBookPage);
      f.componentRef.setInput('page', { label: '聯絡簿' });
      await f.whenStable();
      const page = f.componentInstance as unknown as {
        writeMissing: (t: MissingContactBookStudent) => void;
      };

      contactBook.missing.mockClear();
      contactBook.list.mockClear();
      page.writeMissing({ studentId: 'stu-9', studentName: '王柏睿' } as MissingContactBookStudent);
      expect(contactBook.missing).not.toHaveBeenCalled(); // 還沒寫完，不重載

      closed.next({ id: 'e1', studentId: 'stu-9' });
      // 色面的今天缺漏人數（用「今天」）＋這週未簽（週一到今天）各重打一次
      expect(contactBook.missing).toHaveBeenCalledWith('2027-03-05');
      expect(contactBook.list.mock.calls.map((c) => [c[0]!.from, c[0]!.to])).toContainEqual([
        '2027-03-01',
        '2027-03-05',
      ]);
    });
  });

  // #1641 5b（使用者 10-16 裁定第 3 點）：已經有資料時重抓保留舊內容並變淡，只有第一次才是骨架
  it('重抓時舊的聯絡簿留著並變淡，不回到骨架', async () => {
    contactBook.list.mockReturnValue(of(listResponse([entry()])));
    (component as unknown as { load: () => void }).load();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-testid="entry"]').length).toBe(1);

    contactBook.list.mockReturnValue(NEVER);
    (component as unknown as { load: () => void }).load();
    fixture.detectChanges();
    expect(el.querySelector('.reload-veil--stale')).not.toBeNull();
    expect(el.querySelector('.skeleton-list')).toBeNull();
    expect(el.querySelectorAll('[data-testid="entry"]').length).toBe(1);
  });
});
