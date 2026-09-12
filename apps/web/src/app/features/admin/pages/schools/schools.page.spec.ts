import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
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

    await TestBed.configureTestingModule({
      imports: [SchoolsPage],
      // 這支 spec 原本**沒有任何 service mock**，於是元件打真的 HTTP。
      providers: [{ provide: SchoolsService, useValue: schoolsServiceMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(SchoolsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
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
});
