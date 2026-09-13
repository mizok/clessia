import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DialogService } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';
import { vi } from 'vitest';

import { StudentViewComponent } from './student-view.component';

describe('StudentViewComponent', () => {
  let fixture: ComponentFixture<StudentViewComponent>;
  let component: StudentViewComponent;
  let http: HttpTestingController;

  const openMock = vi.fn();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudentViewComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: openMock } },
      ],
    })
      .overrideComponent(StudentViewComponent, {
        set: {
          providers: [
            // **真的 MessageService，不是 `{ add: vi.fn() }`**：假物件沒有 observable，
            // `<p-toast>` 就算不存在測試也看不出來（#809 就是這樣藏了一週）
            { provide: MessageService, useValue: new MessageService() },
            { provide: DialogService, useValue: { open: openMock } },
          ],
        },
      })
      .compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StudentViewComponent);
    component = fixture.componentInstance;
    openMock.mockReset();
  });

  afterEach(() => {
    const pending = http.match(() => true);
    pending.forEach((req) => {
      if (!req.cancelled) {
        req.flush({ data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 } });
      }
    });
    http.verify();
  });

  /**
   * **#809：這支元件自己 `providers: [MessageService]`，所以它拿到的是自己的實例，
   * 而 `<p-toast>` 訂閱的是注入它的那一層** —— 模板沒有出口的話，
   * `messageService.add()` 的每一則都沒有訂閱者，畫面上零訊號。
   *
   * 斷言查的是 `document`（toast 會被搬出元件），而且查的是**渲染出來的訊息**，
   * 不是「add 有沒有被呼叫」—— 後者是意圖，前者是結果。
   */
  it('發出的 toast 有出口 —— DOM 裡真的長出訊息', () => {
    fixture.detectChanges();

    fixture.debugElement.injector
      .get(MessageService)
      .add({ severity: 'error', summary: '載入失敗', detail: '無法載入學生列表' });
    fixture.detectChanges();

    expect(document.querySelector('.p-toast-message')).not.toBeNull();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
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

    expect((component as any).loadingList()).toBe(false);
  });

  it('opens score detail dialog when selecting student', () => {
    const student = { id: 's1', name: '王小明', grade: 'J1' } as any;

    (component as any).selectStudent(student);

    expect(openMock).toHaveBeenCalledTimes(1);
    const [, config] = openMock.mock.calls[0] as [unknown, any];
    expect(config.data.student.id).toBe('s1');
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
    const rows = host.querySelectorAll('.student-view__row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('王小明');
    expect(rows[0].textContent).toContain('國一');
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
