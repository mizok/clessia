import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Subject, of } from 'rxjs';
import { afterEach, beforeEach as viBeforeEach, vi } from 'vitest';

import { StudentsService, type StudentListResponse } from '@core/students.service';

import { StudentsPage } from './students.page';

describe('StudentsPage', () => {
  let component: StudentsPage;
  let fixture: ComponentFixture<StudentsPage>;

  const emptyRes = (names: string[]): StudentListResponse =>
    ({
      // `campusNames` 不能省 —— 模板有 `student.campusNames.length`，
      // 少了它會在測試輸出裡噴 TypeError 而**不讓任何一條測試紅**。
      data: names.map((name, i) => ({ id: `s${i}`, name, campusNames: [], parentNames: [] })),
      meta: { total: names.length, page: 1, pageSize: 20, totalPages: 1 },
      summary: { total: names.length, active: names.length, inactive: 0 },
    }) as unknown as StudentListResponse;

  /** 每次呼叫都記下 search 參數，並回一個我們自己控制何時完成的 Subject */
  const pending: Array<{ search: string | undefined; subject: Subject<StudentListResponse> }> = [];
  const studentsServiceMock = {
    list: vi.fn((params: { search?: string }) => {
      const subject = new Subject<StudentListResponse>();
      pending.push({ search: params.search, subject });
      return subject.asObservable();
    }),
    // #876：這兩支要分得出來 —— 這個 bug 的形狀就是「畫面上是兩件事、網路上是同一支 API」
    update: vi.fn(() => of({ data: {} as never })),
    delete: vi.fn(() => of({ success: true })),
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
    studentsServiceMock.list.mockClear();
    studentsServiceMock.update.mockClear();
    studentsServiceMock.delete.mockClear();

    await TestBed.configureTestingModule({
      imports: [StudentsPage],
      providers: [
        // 原本這支 spec **沒有任何 service mock**，於是元件打真的 HTTP ——
        // `whenStable()` 等到 hook timeout 為止（本機那支卡住的 API 讓它每次 10 秒）。
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn(() => ({ onClose: of(null) })) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StudentsPage);
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

  /**
   * **#788：取數失敗時畫面不能渲染成「尚未有學生資料」。**
   *
   * `catchError` 回 `EMPTY` 之後（那是 #689 的修法，不能拆），`students()` 維持初始的
   * `[]` —— 於是「失敗」與「成功但沒有資料」在狀態上完全相同，畫面走空狀態分支，
   * 還附一顆「新增學生」邀請使用者建出重複資料。而唯一的錯誤訊號是**會自己消失的 toast**。
   *
   * 這裡斷言**畫面主體**，不是斷言某個 signal —— 使用者看到的是畫面。
   */
  it('取數失敗時渲染「載入失敗」而不是「尚未有學生資料」', () => {
    pending[0].subject.error(new Error('boom'));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('載入失敗');
    expect(text).not.toContain('尚未有學生資料');
  });

  it('取數失敗時給得出重試 —— 按下去要重新打一次', () => {
    const callsBefore = studentsServiceMock.list.mock.calls.length;
    pending[0].subject.error(new Error('boom'));
    fixture.detectChanges();

    const retry = (fixture.nativeElement as HTMLElement).querySelector(
      'app-load-failed button',
    ) as HTMLButtonElement | null;
    expect(retry, '失敗狀態要有重試鈕').toBeTruthy();

    retry!.click();
    vi.advanceTimersByTime(500);
    expect(studentsServiceMock.list.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  const type = (text: string) =>
    (component as unknown as { onSearchChange: (v: string) => void }).onSearchChange(text);

  /**
   * #659：每一次按鍵都直接呼叫 `loadStudents()`，沒有 debounce。
   * 打「陳小華」送出 3 支請求，而畫面顯示的是最後一個到達的那支的結果 ——
   * 使用者看到的是「陳」的結果配「陳小華」的輸入框。
   */
  it('連續打字只送出一次請求（最後那個字）', () => {
    studentsServiceMock.list.mockClear();
    pending.length = 0;

    type('陳');
    type('陳小');
    type('陳小華');
    vi.advanceTimersByTime(300);

    expect(studentsServiceMock.list).toHaveBeenCalledTimes(1);
    expect(pending.at(-1)?.search).toBe('陳小華');
  });

  /**
   * **debounce 只解一半。** 打字慢的人（每次間隔超過 debounce）仍然會送出多支請求，
   * 而它們回來的順序不保證 —— 先發的後到就會蓋掉畫面。
   *
   * 這條**故意讓兩支請求都真的送出**（中間 tick 過 debounce），
   * 然後讓**先發的後回**。有 `switchMap` 的話先發的那支已經被取消，
   * 它的結果不該出現在畫面上。
   */
  it('先發的請求後回時不會蓋掉畫面（switchMap 取消）', () => {
    studentsServiceMock.list.mockClear();
    pending.length = 0;

    type('陳');
    vi.advanceTimersByTime(300);
    type('陳小華');
    vi.advanceTimersByTime(300);

    expect(studentsServiceMock.list).toHaveBeenCalledTimes(2);

    // 後發的先回 —— 畫面應該是「陳小華」的結果
    pending[1].subject.next(emptyRes(['陳小華']));
    pending[1].subject.complete();

    // 先發的那支現在才回。它已經被取消，這一筆不該被採用。
    pending[0].subject.next(emptyRes(['陳一', '陳二', '陳三']));
    pending[0].subject.complete();

    const names = (component as unknown as { students: () => Array<{ name: string }> })
      .students()
      .map((s) => s.name);
    expect(names).toEqual(['陳小華']);
  });

  /** 對照組：同樣的字不重複送（否則上面那兩條在「每次都送」的實作下也會過） */
  it('同樣的關鍵字不重複送出請求', () => {
    studentsServiceMock.list.mockClear();
    pending.length = 0;

    type('陳小華');
    vi.advanceTimersByTime(300);
    type('陳小華');
    vi.advanceTimersByTime(300);

    expect(studentsServiceMock.list).toHaveBeenCalledTimes(1);
  });

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
    studentsServiceMock.list.mockClear();
    pending.length = 0;

    type('陳');
    vi.advanceTimersByTime(300);
    expect(studentsServiceMock.list).toHaveBeenCalledTimes(1);

    pending[0].subject.error(new Error('boom'));

    type('林');
    vi.advanceTimersByTime(300);

    expect(studentsServiceMock.list).toHaveBeenCalledTimes(2);

    pending[1].subject.next(emptyRes(['林大明']));
    pending[1].subject.complete();

    const names = (component as unknown as { students: () => Array<{ name: string }> })
      .students()
      .map((s) => s.name);
    expect(names).toEqual(['林大明']);
  });

  /**
   * **#876：「停用」按下去是 `DELETE`，學生從 DB 消失。**
   *
   * 這個 bug 藏得住的原因是 **toast 文字從頭到尾都是對的** ——
   * 畫面說「已停用」、確認文案說「不會出現在預設篩選結果中」，而網路上送的是
   * `DELETE /api/students/{id}`，跟「刪除學生」同一支。**兩個方法在畫面上不同、在網路上相同。**
   *
   * 所以這兩條斷言的是**呼叫了哪一支 API**，不是 toast 文字。
   * 同族：#800 的 `expect(track.hidden).toBe(true)` 綠了一週而東西在畫面上看得見 ——
   * **斷言落在意圖上而不是落在結果上**，只是這一次意圖寫在 toast 裡。
   */
  describe('停用（#876）', () => {
    const student = { id: 's0', name: '陳小明', hasEnrollments: false } as never;

    /**
     * ⚠️ `StudentsPage` 自己 `providers: [MessageService, DialogService]`（`:97`），
     * **所以 TestBed 那一層的 `DialogService` 假物件被元件層遮掉了，設了也沒用**
     * —— 第一版就是這樣，兩條測試都停在「0 次呼叫」，看起來像修法沒生效。
     * 要換的是**元件自己的注入器**拿到的那一個。
     */
    const acceptConfirm = (result: unknown) => {
      const dialogService = fixture.debugElement.injector.get(DialogService);
      vi.spyOn(dialogService, 'open').mockReturnValue({ onClose: of(result) } as never);
    };

    it('確認之後呼叫 update({ isActive: false })，不是 delete', () => {
      acceptConfirm(true);

      component.confirmDeactivate(student);

      expect(studentsServiceMock.update).toHaveBeenCalledWith('s0', { isActive: false });
      expect(studentsServiceMock.delete).not.toHaveBeenCalled();
    });

    it('取消的話兩支都不呼叫', () => {
      acceptConfirm(null);

      component.confirmDeactivate(student);

      expect(studentsServiceMock.update).not.toHaveBeenCalled();
      expect(studentsServiceMock.delete).not.toHaveBeenCalled();
    });

    // 「刪除」那條路**不能被這次修改動到** —— 它本來就該是 DELETE。
    it('「刪除」仍然呼叫 delete', () => {
      acceptConfirm(true);

      component.confirmDelete(student);

      expect(studentsServiceMock.delete).toHaveBeenCalledWith('s0');
      expect(studentsServiceMock.update).not.toHaveBeenCalled();
    });
  });
});
