import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmationService, MessageService } from 'primeng/api';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach as viBeforeEach, vi } from 'vitest';

import { SchoolsService, type SchoolListResponse } from '@core/schools.service';

import { SchoolsPage } from './schools.page';

describe('SchoolsPage', () => {
  let component: SchoolsPage;
  let fixture: ComponentFixture<SchoolsPage>;

  const res = (names: string[]): SchoolListResponse =>
    ({
      data: names.map((name, i) => ({
        id: `school-${i}`,
        name,
        shortName: null,
        isActive: true,
      })),
      meta: { total: names.length },
    }) as unknown as SchoolListResponse;

  /** 每次呼叫都記下 search 參數，並回一個我們自己控制何時完成的 Subject */
  const pending: Array<{ search: string | undefined; subject: Subject<SchoolListResponse> }> = [];
  const schoolsServiceMock = {
    list: vi.fn((params: { search?: string } = {}) => {
      const subject = new Subject<SchoolListResponse>();
      pending.push({ search: params.search, subject });
      return subject.asObservable();
    }),
    delete: vi.fn(),
    update: vi.fn(),
  };

  viBeforeEach(() => {
    // 這個 app 是 zoneless（Angular 21 + signals），沒有 `fakeAsync` ——
    // 時間用 vitest 的假計時器控制。`debounceTime` 走 asyncScheduler 的 setTimeout。
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    pending.length = 0;
    schoolsServiceMock.list.mockClear();
    schoolsServiceMock.delete.mockReset();
    schoolsServiceMock.update.mockReset();

    await TestBed.configureTestingModule({
      imports: [SchoolsPage],
      // 這支 spec 原本**沒有任何 service mock**，於是元件打真的 HTTP。
      providers: [MessageService, { provide: SchoolsService, useValue: schoolsServiceMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(SchoolsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * **#812：取數失敗時畫面不能說「尚無學校」。** 實際有 24 所。
   * 斷言畫面主體，不是某個 signal —— 使用者看到的是畫面。
   */
  it('取數失敗時渲染「載入失敗」，不說「尚無學校」', () => {
    pending[0].subject.error(new Error('boom'));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('載入失敗');
    expect(host.textContent).not.toContain('尚無學校');
  });

  it('重試鈕真的重打，成功後清單回來', () => {
    pending[0].subject.error(new Error('boom'));
    fixture.detectChanges();
    const callsBefore = schoolsServiceMock.list.mock.calls.length;

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('app-load-failed button')!
      .click();
    fixture.detectChanges();

    expect(schoolsServiceMock.list.mock.calls.length).toBe(callsBefore + 1);
    pending[pending.length - 1].subject.next(res(['大安高工']));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('載入失敗');
  });

  const type = (text: string) =>
    (component as unknown as { onSearch: (v: string) => void }).onSearch(text);

  /**
   * **把所有取數收進同一條 `switchMap` 會帶來一個新的失效模式：
   * 內層一 error，外層管線就終止 —— 之後這一頁永遠不會再載入任何東西。**
   *
   * 修改前每次取數是各自獨立的訂閱，錯一次只影響那一次；改成單一管線之後，
   * **一次網路錯誤會把搜尋框變成死的**，而畫面上只有一則 toast，
   * 看起來像「這次失敗了」而不是「這一頁壞了」。
   *
   * 這條釘住「錯過一次之後還能再查」。**沒有它，下一個重構的人會把
   * `catchError` 拿掉，而那個缺陷安靜到沒有人會回報。**
   */
  it('一次請求失敗之後，後續的搜尋仍然會送出（管線沒有被 error 終止）', () => {
    schoolsServiceMock.list.mockClear();
    pending.length = 0;

    type('建國');
    vi.advanceTimersByTime(300);
    expect(schoolsServiceMock.list).toHaveBeenCalledTimes(1);

    pending[0].subject.error(new Error('boom'));

    type('北一女');
    vi.advanceTimersByTime(300);

    expect(schoolsServiceMock.list).toHaveBeenCalledTimes(2);

    pending[1].subject.next(res(['北一女中']));
    pending[1].subject.complete();

    const names = (component as unknown as { schools: () => Array<{ name: string }> })
      .schools()
      .map((s) => s.name);
    expect(names).toEqual(['北一女中']);
  });

  /** 對照組：同樣的字不重複送（否則上面那條在「每次都送」的實作下也會過） */
  it('同樣的關鍵字不重複送出請求', () => {
    schoolsServiceMock.list.mockClear();
    pending.length = 0;

    type('建國');
    vi.advanceTimersByTime(300);
    type('建國');
    vi.advanceTimersByTime(300);

    expect(schoolsServiceMock.list).toHaveBeenCalledTimes(1);
  });

  /**
   * #728：這一頁是 `/admin/settings` tab 殼底下的四個 tab 之一，
   * 而**殼自己已經畫了 `<h1>系統設定</h1>` + tab 列**。
   *
   * 這一頁原本用 `<app-page-breadcrumb [items]="[{系統設定},{學校管理}]" />` 當頁首，
   * 於是切到「學校」時畫面由上而下是：
   *
   * ```
   * 系統設定            ← 殼的 h1
   * [分校][學校][科目][一般]
   * 系統設定 › 學校管理  ← 只有這一頁才有的麵包屑
   * ```
   *
   * **「系統設定」出現兩次**，而切到別的 tab 那條麵包屑又不見了。
   * 另外三個 tab 都是純標題（分校管理／科目管理／一般設定），沒有麵包屑。
   *
   * 成因推測：四頁**先各自存在、後來才被收進 tab 殼**
   * （`app.routes.ts` 留著四個舊網址的 redirect 可以佐證）。
   * 麵包屑在舊結構下是合理的，殼加上去之後它就變成重複的那一份。
   */
  describe('#728 tab 內不該有自己的麵包屑', () => {
    it('不再渲染麵包屑', () => {
      expect(fixture.nativeElement.querySelector('app-page-breadcrumb')).toBeNull();
    });

    it('頁面自己不再出現「系統設定」—— 那是殼的標題', () => {
      expect(fixture.nativeElement.textContent).not.toContain('系統設定');
    });

    it('有一個「學校管理」標題，跟另外三個 tab 一致', () => {
      const title = fixture.nativeElement.querySelector('.schools-page__title');

      expect(title?.textContent?.trim()).toBe('學校管理');
    });

    /**
     * **反向對照**：標題不能是 `<h1>`。
     *
     * 殼已經擁有這個頁面的 `<h1>`（`系統設定`），tab 內容再放一個就是**兩個 h1**。
     * issue 原本建議「改成跟另外三頁一致的 `<h1>學校管理</h1>`」——
     * 而另外三頁裡，`分校` 與 `科目` 用 `<h1>`（**它們才是錯的那一邊**），
     * `一般` 用 `<h2>`（**對的那一邊**）。這裡照 `一般`。
     *
     * 樣式上四者完全相同（`--text-2xl` / bold / `--zinc-900`），
     * **所以這個選擇不會讓畫面長得不一樣**，只是不再多一個 h1。
     */
    it('標題不是 h1 —— 殼已經擁有頁面的 h1', () => {
      expect(fixture.nativeElement.querySelector('h1')).toBeNull();
    });
  });

  describe('#752 刪除確認框的按鈕要是中文', () => {
    /**
     * 這一頁用的是 PrimeNG 原生的 `ConfirmationService`，**不是**共用的
     * `ConfirmDialogComponent`。原生那支沒給 `acceptLabel` / `rejectLabel`
     * 就會吃元件庫的英文預設值（`Yes` / `No`）——而全站其他 9 個
     * `confirmationService.confirm()` 呼叫點**每一個都有給中文**。
     *
     * 所以這裡驗的不是「有沒有中文化的機制」，是**這一處有沒有照既有形狀寫**。
     */
    const zeroStudentSchool = {
      id: 'school-0',
      name: '示範可刪除國中',
      shortName: null,
      isActive: true,
      studentCount: 0,
    };

    it('confirm() 帶的是中文的 acceptLabel / rejectLabel，而不是讓 PrimeNG 用英文預設值', () => {
      const confirmationService = fixture.debugElement.injector.get(ConfirmationService);
      const confirmSpy = vi.spyOn(confirmationService, 'confirm');

      (component as unknown as { onDelete: (s: unknown) => void }).onDelete(zeroStudentSchool);

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      const arg = confirmSpy.mock.calls[0]![0]!;
      expect(arg.acceptLabel).toBe('刪除');
      expect(arg.rejectLabel).toBe('取消');
    });

    it('也帶 header 與 icon —— 跟另外 9 個呼叫點同一個形狀', () => {
      const confirmationService = fixture.debugElement.injector.get(ConfirmationService);
      const confirmSpy = vi.spyOn(confirmationService, 'confirm');

      (component as unknown as { onDelete: (s: unknown) => void }).onDelete(zeroStudentSchool);

      const arg = confirmSpy.mock.calls[0]![0]!;
      expect(arg.header).toBe('確認刪除');
      expect(arg.icon).toBe('pi pi-exclamation-triangle');
    });

    // #1314 SE4（A6）：有學生時跳說明＋「改成停用」，不是只出 toast；永遠不打刪除 API
    it('學生數 > 0 → 說明框給「改成停用」，按下去 PUT isActive=false，不刪', () => {
      const confirmationService = fixture.debugElement.injector.get(ConfirmationService);
      const confirmSpy = vi.spyOn(confirmationService, 'confirm').mockImplementation((c) => {
        c.accept?.();
        return confirmationService;
      });
      schoolsServiceMock.update.mockReturnValueOnce(of({ success: true }));

      (component as unknown as { onDelete: (s: unknown) => void }).onDelete({
        ...zeroStudentSchool,
        shortName: '示範國中',
        studentCount: 2,
      });

      const arg = confirmSpy.mock.calls[0]![0]!;
      expect(arg.header).toBe('「示範國中」不能刪除');
      expect(arg.message).toContain('還有 2 位學生');
      expect(arg.acceptLabel).toBe('改成停用');
      expect(schoolsServiceMock.update).toHaveBeenCalledWith('school-0', { isActive: false });
      expect(schoolsServiceMock.delete).not.toHaveBeenCalled();
    });

    it('已停用又有學生 → 說明框不再給停用動作', () => {
      const confirmationService = fixture.debugElement.injector.get(ConfirmationService);
      const confirmSpy = vi.spyOn(confirmationService, 'confirm').mockImplementation((c) => {
        c.accept?.();
        return confirmationService;
      });

      (component as unknown as { onDelete: (s: unknown) => void }).onDelete({
        ...zeroStudentSchool,
        isActive: false,
        studentCount: 2,
      });

      expect(confirmSpy.mock.calls[0]![0]!.acceptLabel).toBe('它已經停用了');
      expect(schoolsServiceMock.update).not.toHaveBeenCalled();
    });
  });

  // #1641 5b：p-table 改成原生表格＋@for，每一列有穩定身分才能各自淡入淡出
  describe('列表與悲觀刪除（#1641 5b）', () => {
    const rowIds = () =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('tbody tr.vt-row'),
      ).map((tr) => tr.style.getPropertyValue('view-transition-name'));
    const loaded = () => {
      pending[0]!.subject.next(res(['甲國中', '乙國中']));
      fixture.detectChanges();
    };
    const deleteSecond = () => {
      const confirmationService = fixture.debugElement.injector.get(ConfirmationService);
      vi.spyOn(confirmationService, 'confirm').mockImplementation((c) => {
        c.accept?.();
        return confirmationService;
      });
      (component as unknown as { onDelete: (s: unknown) => void }).onDelete({
        id: 'school-1',
        name: '乙國中',
        studentCount: 0,
      });
      fixture.detectChanges();
    };

    it('每一列帶 vt-row 與以 id 為名的 view-transition-name', () => {
      loaded();
      expect(rowIds()).toEqual(['school-school-0', 'school-school-1']);
    });

    it('刪除成功才拿掉那一列', () => {
      loaded();
      schoolsServiceMock.delete.mockReturnValueOnce(of(undefined));
      deleteSecond();
      expect(rowIds()).toEqual(['school-school-0']);
    });

    it('刪除失敗：那一列一直都在，並跳錯誤 toast', () => {
      loaded();
      const add = vi.spyOn(fixture.debugElement.injector.get(MessageService), 'add');
      schoolsServiceMock.delete.mockReturnValueOnce(
        throwError(() => ({ error: { error: '這間學校還有學校考試', code: 'CONSTRAINT' } })),
      );
      deleteSecond();
      expect(rowIds()).toEqual(['school-school-0', 'school-school-1']);
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    });
  });
});
