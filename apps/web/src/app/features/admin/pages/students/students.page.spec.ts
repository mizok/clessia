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
});
