import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, beforeEach as viBeforeEach, vi } from 'vitest';

import { ClassPickerDialogComponent } from './class-picker-dialog.component';
import { ClassesService, type Class } from '@core/classes.service';

interface ClassListResponse {
  data: Class[];
  meta: { total: number };
}

describe('ClassPickerDialogComponent', () => {
  let component: ClassPickerDialogComponent;
  let fixture: ComponentFixture<ClassPickerDialogComponent>;

  // `campusName` / `courseName` / `startDate` / `endDate` / `maxStudents` 不能省 ——
  // 模板讀它們，少了會在測試輸出裡噴 TypeError 而**不讓任何一條測試紅**
  // （students.page.spec 記過同一個坑）。
  const res = (names: string[]): ClassListResponse => ({
    data: names.map(
      (name, i) =>
        ({
          id: `c${i}`,
          name,
          campusName: '台北校',
          courseName: '數學',
          startDate: '2026-01-01',
          endDate: null,
          maxStudents: 20,
          gradeLevels: null,
        }) as unknown as Class,
    ),
    meta: { total: names.length },
  });

  /** 每次呼叫都記下 search 參數，並回一個我們自己控制何時完成的 Subject */
  const pending: Array<{ search: string | undefined; subject: Subject<ClassListResponse> }> = [];
  const classesServiceMock = {
    list: vi.fn((params: { search?: string }) => {
      const subject = new Subject<ClassListResponse>();
      pending.push({ search: params.search, subject });
      return subject.asObservable();
    }),
  };

  viBeforeEach(() => {
    // zoneless（Angular 21 + signals），沒有 `fakeAsync` —— `debounceTime` 走
    // asyncScheduler 的 setTimeout，用 vitest 的假計時器控制。
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    pending.length = 0;
    classesServiceMock.list.mockClear();

    await TestBed.configureTestingModule({
      imports: [ClassPickerDialogComponent],
      providers: [
        { provide: ClassesService, useValue: classesServiceMock },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        // `gradeFilter` 從 `config.data.studentGrade` 初始化，而它是前端二次過濾的
        // 條件 —— 給 null 讓 `filteredClasses` 不篩掉替身回的資料。
        { provide: DynamicDialogConfig, useValue: { data: {} } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClassPickerDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  const type = (text: string) =>
    (component as unknown as { onSearchChange: (v: string) => void }).onSearchChange(text);

  const shownNames = () =>
    (component as unknown as { filteredClasses: () => Array<{ name: string }> })
      .filteredClasses()
      .map((c) => c.name);

  it('連續打字只送出一次請求（最後那個字）', () => {
    classesServiceMock.list.mockClear();
    pending.length = 0;

    type('數');
    type('數學');
    type('數學A');
    vi.advanceTimersByTime(300);

    expect(classesServiceMock.list).toHaveBeenCalledTimes(1);
    expect(pending.at(-1)?.search).toBe('數學A');
  });

  /**
   * #661：這個對話框原本就有 `debounceTime` + `distinctUntilChanged`，**所以它看起來是
   * 修好的** —— 而 `debounce` 只解一半。打字間隔超過 300ms 的人仍然會送出多支請求，
   * 回來的順序不保證，先發的後到就蓋掉清單。
   *
   * ⚠️ **這個時序實機演不到**（本機 API 太快，兩支照順序回來，修前修後畫面一樣），
   * 只有替身做得到 —— #661 的驗收條件因此改看送出的請求數。
   */
  it('先發的請求後回時不會蓋掉清單（switchMap 取消）', () => {
    classesServiceMock.list.mockClear();
    pending.length = 0;

    type('數');
    vi.advanceTimersByTime(300);
    type('數學A');
    vi.advanceTimersByTime(300);

    expect(classesServiceMock.list).toHaveBeenCalledTimes(2);

    // 後發的先回 —— 清單應該是「數學A」的結果
    pending[1].subject.next(res(['數學A']));
    pending[1].subject.complete();

    // 先發的那支現在才回。它已經被取消，這一筆不該被採用。
    pending[0].subject.next(res(['數學一', '數學二', '數學三']));
    pending[0].subject.complete();

    expect(shownNames()).toEqual(['數學A']);
  });

  /** 對照組：同樣的字不重複送（否則上面兩條在「每次都送」的實作下也會過） */
  it('同樣的關鍵字不重複送出請求', () => {
    classesServiceMock.list.mockClear();
    pending.length = 0;

    type('數學A');
    vi.advanceTimersByTime(300);
    type('數學A');
    vi.advanceTimersByTime(300);

    expect(classesServiceMock.list).toHaveBeenCalledTimes(1);
  });

  /**
   * 把所有取數收進同一條 `switchMap` 帶來的新失效模式：**內層一 error，
   * 外層管線就終止** —— 這個對話框之後再也載入不了班級。
   *
   * **而它比列表頁更安靜**：這裡連 toast 都沒有（`error` 分支只有 `loading.set(false)`），
   * 使用者看到的是一個永遠空著的挑選器。
   */
  it('一次請求失敗之後，後續的搜尋仍然會送出（管線沒有被 error 終止）', () => {
    classesServiceMock.list.mockClear();
    pending.length = 0;

    type('數');
    vi.advanceTimersByTime(300);
    expect(classesServiceMock.list).toHaveBeenCalledTimes(1);

    pending[0].subject.error(new Error('boom'));

    type('英');
    vi.advanceTimersByTime(300);

    expect(classesServiceMock.list).toHaveBeenCalledTimes(2);

    pending[1].subject.next(res(['英文A']));
    pending[1].subject.complete();
    expect(shownNames()).toEqual(['英文A']);
  });
});
