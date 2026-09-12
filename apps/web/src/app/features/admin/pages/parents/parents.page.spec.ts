import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach as viBeforeEach, vi } from 'vitest';

import { ParentsService, type ParentListResponse } from '@core/parents.service';

import { ParentsPage } from './parents.page';

describe('ParentsPage', () => {
  let component: ParentsPage;
  let fixture: ComponentFixture<ParentsPage>;

  // `studentNames` / `studentCount` 不能省 —— 模板讀它們，少了會在測試輸出裡噴
  // TypeError 而**不讓任何一條測試紅**（students.page.spec 記過同一個坑）。
  const res = (names: string[]): ParentListResponse =>
    ({
      data: names.map((name, i) => ({
        id: `p${i}`,
        name,
        phone: null,
        email: null,
        status: 'active',
        studentCount: 0,
        studentNames: [],
      })),
      meta: { total: names.length, page: 1, pageSize: 20, totalPages: 1 },
      summary: {
        total: names.length,
        activeCount: names.length,
        inactiveCount: 0,
        archivedCount: 0,
      },
    }) as unknown as ParentListResponse;

  /** 每次呼叫都記下 search 參數，並回一個我們自己控制何時完成的 Subject */
  const pending: Array<{ search: string | undefined; subject: Subject<ParentListResponse> }> = [];
  const parentsServiceMock = {
    list: vi.fn((params: { search?: string }) => {
      const subject = new Subject<ParentListResponse>();
      pending.push({ search: params.search, subject });
      return subject.asObservable();
    }),
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
    parentsServiceMock.list.mockClear();

    await TestBed.configureTestingModule({
      imports: [ParentsPage],
      providers: [
        // 這支 spec 原本**沒有任何 service mock**，於是元件打真的 HTTP。
        { provide: ParentsService, useValue: parentsServiceMock },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn(() => ({ onClose: of(null) })) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ParentsPage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', {
      label: 'Test',
      relativePath: '',
      absolutePath: '',
      role: undefined,
      icon: '',
      showInMenu: true,
    });
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  const type = (text: string) =>
    (component as unknown as { onSearchChange: (v: string) => void }).onSearchChange(text);
  const shownNames = () =>
    (component as unknown as { parents: () => Array<{ name: string }> })
      .parents()
      .map((p) => p.name);

  it('連續打字只送出一次請求（最後那個字）', () => {
    parentsServiceMock.list.mockClear();
    pending.length = 0;

    type('陳');
    type('陳小');
    type('陳小華');
    vi.advanceTimersByTime(300);

    expect(parentsServiceMock.list).toHaveBeenCalledTimes(1);
    expect(pending.at(-1)?.search).toBe('陳小華');
  });

  /**
   * #661：這一頁原本就有 `debounceTime` + `distinctUntilChanged`，**所以它看起來是
   * 修好的** —— 而 `debounce` 只解一半。打字間隔超過 300ms 的人仍然會送出多支請求，
   * 回來的順序不保證，先發的後到就蓋掉畫面。
   *
   * 這條**故意讓兩支請求都真的送出**（中間 tick 過 debounce），然後讓**先發的後回**。
   * 有 `switchMap` 的話先發的那支已經被取消，它的結果不該出現在畫面上。
   *
   * ⚠️ **這個時序實機演不到** —— 本機 API 太快，兩支照順序回來，
   * 修好前與修好後的畫面結果一模一樣（#661 的驗收條件因此改看送出的請求數）。
   */
  it('先發的請求後回時不會蓋掉畫面（switchMap 取消）', () => {
    parentsServiceMock.list.mockClear();
    pending.length = 0;

    type('陳');
    vi.advanceTimersByTime(300);
    type('陳小華');
    vi.advanceTimersByTime(300);

    expect(parentsServiceMock.list).toHaveBeenCalledTimes(2);

    // 後發的先回 —— 畫面應該是「陳小華」的結果
    pending[1].subject.next(res(['陳小華']));
    pending[1].subject.complete();

    // 先發的那支現在才回。它已經被取消，這一筆不該被採用。
    pending[0].subject.next(res(['陳一', '陳二', '陳三']));
    pending[0].subject.complete();

    expect(shownNames()).toEqual(['陳小華']);
  });

  /** 對照組：同樣的字不重複送（否則上面兩條在「每次都送」的實作下也會過） */
  it('同樣的關鍵字不重複送出請求', () => {
    parentsServiceMock.list.mockClear();
    pending.length = 0;

    type('陳小華');
    vi.advanceTimersByTime(300);
    type('陳小華');
    vi.advanceTimersByTime(300);

    expect(parentsServiceMock.list).toHaveBeenCalledTimes(1);
  });

  /**
   * **把所有取數收進同一條 `switchMap` 會帶來一個新的失效模式：
   * 內層一 error，外層管線就終止 —— 之後這一頁永遠不會再載入任何東西。**
   *
   * 修改前每次取數是各自獨立的訂閱，錯一次只影響那一次；改成單一管線之後，
   * **一次網路錯誤會把搜尋框變成死的**，而畫面上只有一則 toast，
   * 看起來像「這次失敗了」而不是「這一頁壞了」。
   *
   * 這條釘住「錯過一次之後還能再查」。
   */
  it('一次請求失敗之後，後續的搜尋仍然會送出（管線沒有被 error 終止）', () => {
    parentsServiceMock.list.mockClear();
    pending.length = 0;

    type('陳');
    vi.advanceTimersByTime(300);
    expect(parentsServiceMock.list).toHaveBeenCalledTimes(1);

    pending[0].subject.error(new Error('boom'));

    type('林');
    vi.advanceTimersByTime(300);

    expect(parentsServiceMock.list).toHaveBeenCalledTimes(2);

    pending[1].subject.next(res(['林大明']));
    pending[1].subject.complete();
    expect(shownNames()).toEqual(['林大明']);
  });

  /**
   * **#788：取數失敗時畫面不能渲染成「尚未有資料」。**
   * 斷言**畫面主體**而不是某個 signal —— 使用者看到的是畫面。
   */
  it('取數失敗時渲染「載入失敗」而不是「尚未有家長資料」', () => {
    parentsServiceMock.list.mockReturnValueOnce(throwError(() => new Error('boom')));
    (component as unknown as { loadParents: () => void }).loadParents();
    if (vi.isFakeTimers()) vi.advanceTimersByTime(1000);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('載入失敗');
    expect(text).not.toContain('尚未有家長資料');
  });
});
