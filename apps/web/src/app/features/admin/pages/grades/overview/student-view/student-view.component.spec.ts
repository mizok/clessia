import { ToastComponent } from '@shared/components/toast/toast.component';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DialogService } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';
import { vi } from 'vitest';

import { CampusContextService } from '@core/campus-context.service';

import { StudentViewComponent } from './student-view.component';

describe('StudentViewComponent', () => {
  let fixture: ComponentFixture<StudentViewComponent>;
  let component: StudentViewComponent;
  let http: HttpTestingController;

  const openMock = vi.fn();

  beforeEach(async () => {
    // 頂欄分校記在 localStorage —— 不清的話上一條選的分校會漏到下一條
    localStorage.removeItem('clessia.campusContext');
    localStorage.removeItem('clessia.campusContext.single');
    await TestBed.configureTestingModule({
      imports: [StudentViewComponent],
      providers: [
        MessageService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: DialogService, useValue: { open: openMock } },
      ],
    })
      .overrideComponent(StudentViewComponent, {
        set: {
          providers: [{ provide: DialogService, useValue: { open: openMock } }],
        },
      })
      .compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StudentViewComponent);
    component = fixture.componentInstance;
    openMock.mockReset();
  });

  afterEach(() => {
    // 學生名單回來才發成績摘要（G8）—— 多收幾輪，直到沒有新請求
    for (let round = 0; round < 3; round++) {
      http.match(() => true).forEach((req) => {
        if (!req.cancelled) {
          req.flush({ data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 } });
        }
      });
    }
    http.verify();
  });

  it('日常頁：頂欄沒有「全部分校」（#1607）', () => {
    const ctx = TestBed.inject(CampusContextService);
    expect(ctx.inUse()).toBe(true);
    expect(ctx.allowAll()).toBe(false);
  });

  /**
   * #809 → #1615：toast 的出口是全站唯一的 `<app-toast>`（掛在 App）。元件要是自己
   * `providers: [MessageService]`，`add()` 就只進那一層，全站出口收不到 —— 畫面上零訊號。
   * 查的是**出口渲染出來的訊息**，不是「add 有沒有被呼叫」—— 後者是意圖，前者是結果。
   */
  it('發出的 toast 到得了全站出口 —— 出口裡真的長出訊息（#1615）', () => {
    fixture.detectChanges();

    const outlet = TestBed.createComponent(ToastComponent);
    fixture.debugElement.injector
      .get(MessageService)
      .add({ severity: 'error', summary: '載入失敗', detail: '無法載入學生列表' });
    fixture.detectChanges();

    outlet.detectChanges();
    expect((outlet.nativeElement as HTMLElement).querySelector('.toast')).not.toBeNull();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // #1100 #40：匯出成績（A6 工具列下載圖示＋面板）
  describe('匯出成績', () => {
    const student = (id: string, schoolId: string) =>
      ({ id, name: id, grade: 'J1', school: { id: schoolId, name: schoolId } }) as never;
    const panel = { hide: vi.fn() } as never;

    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:x');
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      // jsdom 的 Blob 沒有 text()（瀏覽器都有）
      Blob.prototype.text ??= function (this: Blob) {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsText(this);
        });
      };
      (component as any).rawStudents.set([student('s1', 'sch-a'), student('s2', 'sch-b')]);
    });

    it('照目前的篩選：帶畫面上的學生（學校篩過的）與頂欄分校；面板寫的人數一致', () => {
      TestBed.inject(CampusContextService).select('campus-9');
      (component as any).schoolIdFilter.set('sch-a');
      expect((component as any).totalStudents()).toBe(1);

      (component as any).exportScores(panel);
      const req = http.expectOne((r) => r.url.endsWith('/api/scores/export'));
      expect(req.request.method).toBe('POST');
      expect(req.request.responseType).toBe('blob');
      expect(req.request.body).toEqual({ studentIds: ['s1'], campusId: 'campus-9' });
      req.flush(new Blob(['csv']));
      expect((component as any).exporting()).toBe(false);
    });

    it('全部學生：不帶 studentIds（範圍由後端決定）', () => {
      (component as any).exportRange.set('all');
      (component as any).exportScores(panel);
      const req = http.expectOne((r) => r.url.endsWith('/api/scores/export'));
      expect(req.request.body.studentIds).toBeUndefined();
      req.flush(new Blob(['csv']));
    });

    it('超過上限（413）：顯示後端的訊息', async () => {
      const add = vi.spyOn(TestBed.inject(MessageService), 'add');
      (component as any).exportScores(panel);
      http
        .expectOne((r) => r.url.endsWith('/api/scores/export'))
        .flush(new Blob([JSON.stringify({ error: '筆數超過 20000 筆，請先篩選再匯出' })]), {
          status: 413,
          statusText: 'Payload Too Large',
        });
      await vi.waitFor(() => expect(add).toHaveBeenCalled());
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', detail: '筆數超過 20000 筆，請先篩選再匯出' }),
      );
      expect((component as any).exporting()).toBe(false);
    });
  });

  /**
   * **#812：取數失敗時畫面不能說「請嘗試調整篩選條件或搜尋關鍵字」** ——
   * 那是叫使用者去做一件不會有用的事。#809 讓這支的 toast 出得來了，
   * 但 toast 會消失，而退化畫面留著。
   */
  it('取數失敗時渲染「載入失敗」，不叫使用者調整篩選條件', () => {
    fixture.detectChanges();
    http
      .expectOne((req) => req.url.includes('/api/students'))
      .flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('載入失敗');
    expect(host.textContent).not.toContain('請嘗試調整篩選條件');
  });

  it('loads students on init with active filter by default', () => {
    fixture.detectChanges();

    const studentsReq = http.expectOne((req) => req.url.includes('/api/students'));
    expect(studentsReq.request.params.get('isActive')).toBe('true');
    studentsReq.flush({
      data: [],
      meta: { total: 0, page: 1, pageSize: 100, totalPages: 1 },
    });

    const schoolsReq = http.expectOne((req) => req.url.includes('/api/schools'));
    schoolsReq.flush({ data: [], meta: { total: 0 } });

    const campusReq = http.expectOne((req) => req.url.includes('/api/campuses'));
    campusReq.flush({
      data: [],
      meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 },
    });
    // 成績摘要回來之前名單還在載入（列上的數字要一起出現，不先畫「—」再跳）
    expect((component as any).loadingList()).toBe(true);
    http
      .expectOne((req) => req.url.endsWith('/api/scores/students'))
      .flush({ data: [], meta: { total: 0, page: 1, pageSize: 200 } });

    expect((component as any).loadingList()).toBe(false);
  });

  it('分校跟頂欄走：頂欄換分校帶 campusId 重查學生（#1138）', () => {
    fixture.detectChanges();
    http
      .match((req) => req.url.includes('/api/students'))
      .forEach((r) =>
        r.flush({ data: [], meta: { total: 0, page: 1, pageSize: 100, totalPages: 1 } }),
      );

    TestBed.inject(CampusContextService).select('campus-9');
    fixture.detectChanges();

    const reqs = http.match((req) => req.url.includes('/api/students'));
    expect(reqs.map((r) => r.request.params.get('campusId'))).toEqual(['campus-9']);
    reqs.forEach((r) =>
      r.flush({ data: [], meta: { total: 0, page: 1, pageSize: 100, totalPages: 1 } }),
    );
  });

  it('opens score detail dialog when selecting student', () => {
    const student = { id: 's1', name: '王小明', grade: 'J1' } as any;

    (component as any).selectStudent(student);

    expect(openMock).toHaveBeenCalledTimes(1);
    const [, config] = openMock.mock.calls[0] as [unknown, any];
    expect(config.data.student.id).toBe('s1');
  });

  it('列上的成績摘要（#1314 G8）：撈齊 scope=all 的每頁，依學生配到列上', () => {
    fixture.detectChanges();
    http
      .expectOne((r) => r.url.includes('/api/students'))
      .flush({
        data: [
          { id: 's1', name: '王小明', grade: 'J1', school: null },
          { id: 's2', name: '李小華', grade: 'J1', school: null },
        ],
        meta: { total: 2, page: 1, pageSize: 100, totalPages: 1 },
      });
    const agg = (studentId: string, over: object) => ({
      studentId,
      academySum: 130,
      academyTotalSum: 200,
      latest: null,
      deltaVsPrev: null,
      recentAbsentCount: 0,
      ...over,
    });
    const first = http.expectOne(
      (r) => r.url.endsWith('/api/scores/students') && r.params.get('page') === '1',
    );
    expect(first.request.params.get('scope')).toBe('all');
    first.flush({ data: [], meta: { total: 201, page: 1, pageSize: 200 } });
    http
      .expectOne((r) => r.url.endsWith('/api/scores/students') && r.params.get('page') === '2')
      .flush({
        data: [
          agg('s1', {
            latest: {
              score: 41,
              totalScore: 100,
              examName: '第三次小考',
              examDate: '2026-10-01',
              failing: true,
            },
            deltaVsPrev: -7.6,
            recentAbsentCount: 2,
          }),
        ],
        meta: { total: 201, page: 2, pageSize: 200 },
      });
    fixture.detectChanges();

    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-part="student-row"]',
    );
    const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ');
    expect(text(rows[0])).toContain('最近：第三次小考（10/1） · 比上一次 −8 分 · 缺考 2 次');
    expect(text(rows[0])).toContain('41 不及格');
    expect(text(rows[0])).toContain('65平均');
    expect(text(rows[1])).toContain('這段期間沒有成績');
    expect(text(rows[1])).toContain('—平均');
  });

  it('renders paged students rows', () => {
    const vm = component as any;

    fixture.detectChanges();
    http
      .match(() => true)
      .forEach((req) =>
        req.flush({ data: [], meta: { total: 0, page: 1, pageSize: 100, totalPages: 1 } }),
      );

    vm.loadingList.set(false);
    vm.rawStudents.set([
      {
        id: 's1',
        name: '王小明',
        grade: 'J1',
        campusNames: [],
        isActive: true,
        school: null,
      },
      {
        id: 's2',
        name: '李小華',
        grade: 'J2',
        campusNames: [],
        isActive: true,
        school: null,
      },
    ]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const rows = host.querySelectorAll('[data-part=student-row]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('王小明');
    // 年級改成分章標題（A6，#991 grades Q7）
    const chapters = host.querySelectorAll('[data-part=grade-chapter]');
    expect(chapters.length).toBe(2);
    expect(chapters[0].textContent).toContain('國一');
    expect(chapters[0].textContent).toContain('王小明');
  });

  /**
   * **把所有取數收進同一條 `switchMap` 會帶來一個新的失效模式：
   * 內層一 error，外層管線就終止 —— 之後這一頁永遠不會再載入任何東西。**
   *
   * 修改前每次取數是各自獨立的訂閱，錯一次只影響那一次；改成單一管線之後，
   * **一次網路錯誤會把篩選器變成死的**，而畫面上只有一則 toast，
   * 看起來像「這次失敗了」而不是「這一頁壞了」。
   *
   * 這條釘住「錯過一次之後還能再查」。**沒有它，下一個重構的人會把
   * `catchError` 拿掉，而那個缺陷安靜到沒有人會回報。**
   *
   * 用 `onGradeChange` 觸發而不是搜尋框 —— 它不經 `debounceTime`，
   * 打到的是**同一條管線**，而這支 spec 沒有假計時器。
   */
  describe('取數管線的錯誤復原（#689）', () => {
    const internals = () =>
      component as unknown as {
        onGradeChange: (grade: 'J1' | 'J2' | null | '') => void;
      };

    /** 進場的第一發：學生 + 學校各一支，把它們清掉，讓斷言只看後續的請求 */
    const settleInitialLoad = () => {
      fixture.detectChanges();
      http
        .expectOne((req) => req.url.includes('/api/students'))
        .flush({ data: [], meta: { total: 0, page: 1, pageSize: 100, totalPages: 1 } });
      http
        .expectOne((req) => req.url.includes('/api/schools'))
        .flush({ data: [], meta: { total: 0 } });
    };

    it('第一頁請求失敗之後，後續的取數仍然會送出（管線沒有被 error 終止）', () => {
      settleInitialLoad();

      internals().onGradeChange('J1');
      http
        .expectOne((req) => req.url.includes('/api/students'))
        .flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' });

      internals().onGradeChange('J2');

      // 管線還活著才會有這一支；沒有 `catchError` 的話這裡會是 0 支
      const retry = http.expectOne((req) => req.url.includes('/api/students'));
      expect(retry.request.params.get('grade')).toBe('J2');
      retry.flush({ data: [], meta: { total: 0, page: 1, pageSize: 100, totalPages: 1 } });
    });

    /**
     * **這一支的管線是巢狀的：第一頁回來之後才用 `forkJoin` 撈剩下的分頁。**
     *
     * `catchError` 若只掛在最內層那支 `list({ page: 1 })` 上，**`forkJoin` 那半的
     * 失敗收不到** —— 管線照樣死，而第一頁的測試會是綠的。
     * 所以這條專門讓**第二頁**失敗。
     */
    it('分頁 forkJoin 失敗之後，後續的取數仍然會送出', () => {
      settleInitialLoad();

      internals().onGradeChange('J1');
      // 第一頁說「總共兩頁」→ 元件接著用 forkJoin 去撈第 2 頁
      http
        .expectOne((req) => req.url.includes('/api/students'))
        .flush({
          data: [],
          meta: { total: 150, page: 1, pageSize: 100, totalPages: 2 },
        });

      http
        .expectOne((req) => req.url.includes('/api/students'))
        .flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' });

      internals().onGradeChange('J2');

      const retry = http.expectOne((req) => req.url.includes('/api/students'));
      expect(retry.request.params.get('grade')).toBe('J2');
      retry.flush({ data: [], meta: { total: 0, page: 1, pageSize: 100, totalPages: 1 } });
    });
  });
});
