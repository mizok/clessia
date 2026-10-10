import { signal } from '@angular/core';
import { format, subDays } from 'date-fns';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { CampusContextService } from '@core/campus-context.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { ClassesService } from '@core/classes.service';
import {
  EnrollmentsService,
  type Enrollment,
  type EnrollmentListResponse,
} from '@core/enrollments.service';
import { StudentsService } from '@core/students.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

import { EnrollmentsPage } from './enrollments.page';

function enrollment(overrides: Partial<Enrollment> = {}): Enrollment {
  return {
    id: 'enr-1',
    orgId: 'org-1',
    classId: 'class-1',
    className: '國二數學 A',
    campusId: 'campus-1',
    campusName: '本校',
    courseId: 'course-1',
    courseName: '數學',
    studentId: 'stu-1',
    studentName: '陳大同',
    studentSchool: '文山國中',
    studentGrade: 'J2',
    status: 'active',
    billingMode: null,
    feeTemplateId: null,
    agreedAmount: null,
    adjustmentNote: null,
    effectiveFrom: '2026-08-03',
    effectiveTo: null,
    notes: null,
    createdBy: null,
    createdByName: null,
    createdAt: '2026-08-03T00:00:00Z',
    updatedAt: '2026-08-03T00:00:00Z',
    attendanceCount: 0,
    classSchedule: [],
    teacherName: null,
    ...overrides,
  };
}

describe('EnrollmentsPage', () => {
  let fixture: ComponentFixture<EnrollmentsPage>;
  let component: EnrollmentsPage;

  const listMock = vi.fn();
  const COUNTS = { joined: 1, left: 0, paused: 0, voided: 0 };
  const countsMock = vi.fn();
  const refDataMock = { campuses: signal<unknown[]>([]), loadCampuses: vi.fn() };
  const navigateMock = vi.fn();
  const studentsListMock = vi.fn();
  const classesListMock = vi.fn();

  const q = (id: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(
      `[data-testid="${id}"]`,
    ) as HTMLElement | null;
  const qa = (id: string) => [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      `[data-testid="${id}"]`,
    ),
  ];

  async function setup(data: Enrollment[] = [enrollment()], total = data.length) {
    listMock.mockReset();
    studentsListMock.mockReset();
    classesListMock.mockReset();
    classesListMock.mockReturnValue(
      of({
        data: [
          { id: 'class-1', name: '國二數學 A' },
          { id: 'class-2', name: '國三英文 B' },
        ],
        meta: { total: 2, page: 1, pageSize: 100, totalPages: 1 },
      }),
    );
    localStorage.removeItem('clessia.campusContext');
    navigateMock.mockReset();

    listMock.mockReturnValue(of({ data, meta: { total, page: 1, pageSize: 20, totalPages: 1 } }));
    countsMock.mockReset();
    countsMock.mockReturnValue(of({ data: COUNTS }));

    await TestBed.configureTestingModule({
      imports: [EnrollmentsPage],
      providers: [
        { provide: EnrollmentsService, useValue: { list: listMock, getEventCounts: countsMock } },
        { provide: StudentsService, useValue: { list: studentsListMock } },
        { provide: ClassesService, useValue: { list: classesListMock } },
        { provide: ReferenceDataService, useValue: refDataMock },
        provideRouter([]),
      ],
    }).compileComponents();

    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(navigateMock);
    fixture = TestBed.createComponent(EnrollmentsPage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', RoutesCatalog.ADMIN_ENROLLMENTS);
    fixture.detectChanges();
  }

  // #508：載入中原本是整塊被一行文字取代（沒有骨架尺寸，資料到了會跳版）。
  // 改成骨架列表後這裡改斷言骨架元素，不是文字。
  it('載入中顯示骨架列表，不是整塊被文字取代', async () => {
    listMock.mockReset();
    studentsListMock.mockReset();
    classesListMock.mockReset();
    classesListMock.mockReturnValue(
      of({
        data: [
          { id: 'class-1', name: '國二數學 A' },
          { id: 'class-2', name: '國三英文 B' },
        ],
        meta: { total: 2, page: 1, pageSize: 100, totalPages: 1 },
      }),
    );
    localStorage.removeItem('clessia.campusContext');
    listMock.mockReturnValue(NEVER);

    await TestBed.configureTestingModule({
      imports: [EnrollmentsPage],
      providers: [
        { provide: EnrollmentsService, useValue: { list: listMock, getEventCounts: countsMock } },
        { provide: StudentsService, useValue: { list: studentsListMock } },
        { provide: ClassesService, useValue: { list: classesListMock } },
        { provide: ReferenceDataService, useValue: refDataMock },
        provideRouter([]),
      ],
    }).compileComponents();

    const f = TestBed.createComponent(EnrollmentsPage);
    f.componentRef.setInput('page', RoutesCatalog.ADMIN_ENROLLMENTS);
    f.detectChanges();

    expect(f.nativeElement.querySelector('.skeleton-list')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.skeleton-bar').length).toBeGreaterThan(0);
  });

  it('預設查近 30 天（今天往前 29 天到今天），並用 updatedAt 排序', async () => {
    await setup();

    const call = listMock.mock.calls[0][0];
    const day = (offset: number) => format(subDays(new Date(), offset), 'yyyy-MM-dd');
    expect(call.from).toBe(day(29));
    expect(call.to).toBe(day(0));
    expect(call.sort).toBe('updatedAt');
  });

  it('選月份就查那一整個月', async () => {
    await setup();
    listMock.mockClear();

    component['onMonthChange']('2026-08');

    const call = listMock.mock.calls[0][0];
    expect(call.from).toBe('2026-08-01');
    expect(call.to).toBe('2026-08-31');
  });

  // 期間清空 = 看全部在籍，不是看空清單
  it('選「不限期間」就不送期間參數', async () => {
    await setup();
    listMock.mockClear();

    component['onMonthChange']('');

    const call = listMock.mock.calls[0][0];
    expect(call.from).toBeUndefined();
    expect(call.to).toBeUndefined();
  });

  it('新報名與退班在同一張表，各自標記', async () => {
    await setup([
      enrollment({ id: 'a', status: 'active', effectiveFrom: '2026-08-03' }),
      enrollment({
        id: 'b',
        status: 'withdrawal',
        effectiveFrom: '2026-02-01',
        effectiveTo: '2026-08-14',
      }),
    ]);

    // #1022：統計句只能有全量的總數 —— 不能再出現只算當頁的「本頁 新報名 N／退班 M」
    const summary = fixture.nativeElement.querySelector('.enrollments__summary')?.textContent ?? '';
    expect(summary).toMatch(/共\s*\d+\s*筆/);
    expect(summary).not.toContain('本頁');
    expect(fixture.nativeElement.textContent).toContain('新報名');
    expect(fixture.nativeElement.textContent).toContain('退班');
  });

  it('退班顯示的是退班日，不是當初報名的日子', async () => {
    await setup([
      enrollment({
        status: 'withdrawal',
        effectiveFrom: '2026-02-01',
        effectiveTo: '2026-08-14',
      }),
    ]);

    expect(component['rows']()[0].event.date).toBe('2026-08-14');
    expect(fixture.nativeElement.textContent).toContain('08/14');
  });

  it('四種事件詞各自標記，原因寫在狀態下面（#1314 EN5）', async () => {
    await setup([
      enrollment({ id: 'a', status: 'active' }),
      enrollment({
        id: 'b',
        status: 'withdrawal',
        effectiveTo: '2026-08-14',
        statusReason: '搬家',
      }),
      enrollment({
        id: 'c',
        status: 'suspended',
        statusChangedAt: '2026-08-10',
        statusReason: '長期請病假',
      }),
      enrollment({ id: 'd', status: 'void', effectiveTo: '2026-08-12', statusReason: '重複報名' }),
    ]);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    for (const word of ['新報名', '退班', '暫停', '作廢']) expect(text).toContain(word);
    expect(component['rows']().map((r) => r.event.kind)).toEqual([
      'joined',
      'left',
      'paused',
      'voided',
    ]);
    // 暫停的日期是 status_changed_at（它不寫 effective_to）
    expect(text).toContain('08/10');
    for (const why of ['搬家', '長期請病假', '重複報名']) expect(text).toContain(why);
  });

  it('沒有原因就不畫那一行', async () => {
    await setup([enrollment({ status: 'active', statusReason: null })]);
    expect(q('status-reason')).toBeNull();
  });

  it('分校跟頂欄走：頂欄換分校會重新查詢並回到第一頁（#1138）', async () => {
    await setup();
    component['onPageChange'](3);
    listMock.mockClear();

    TestBed.inject(CampusContextService).select('campus-9');
    fixture.detectChanges();

    expect(listMock).toHaveBeenCalledTimes(1);
    const call = listMock.mock.calls[0][0];
    expect(call.campusId).toBe('campus-9');
    expect(call.page).toBe(1);
  });

  it('切換狀態會重新查詢', async () => {
    await setup();
    listMock.mockClear();

    component['onStatusChange']('withdrawal');

    expect(listMock.mock.calls[0][0].status).toBe('withdrawal');
  });

  // pending_payment 目前沒有任何流程會產生，放出來只會讓人以為系統壞了
  it('狀態選項不含待繳費', async () => {
    await setup();

    expect(component['statusOptions'].map((option) => option.value)).not.toContain(
      'pending_payment',
    );
  });

  it('點一列跳到該班的班級詳情頁', async () => {
    await setup();

    component['openClass'](component['rows']()[0]);

    expect(navigateMock).toHaveBeenCalledWith(['/admin/courses', 'course-1', 'classes', 'class-1']);
  });

  it('查詢失敗顯示錯誤而不是空白', async () => {
    listMock.mockReset();
    studentsListMock.mockReset();
    classesListMock.mockReset();
    classesListMock.mockReturnValue(
      of({
        data: [
          { id: 'class-1', name: '國二數學 A' },
          { id: 'class-2', name: '國三英文 B' },
        ],
        meta: { total: 2, page: 1, pageSize: 100, totalPages: 1 },
      }),
    );
    localStorage.removeItem('clessia.campusContext');
    listMock.mockReturnValue(throwError(() => new Error('boom')));

    await TestBed.configureTestingModule({
      imports: [EnrollmentsPage],
      providers: [
        { provide: EnrollmentsService, useValue: { list: listMock, getEventCounts: countsMock } },
        { provide: StudentsService, useValue: { list: studentsListMock } },
        { provide: ClassesService, useValue: { list: classesListMock } },
        { provide: ReferenceDataService, useValue: refDataMock },
        provideRouter([]),
      ],
    }).compileComponents();

    const f = TestBed.createComponent(EnrollmentsPage);
    f.componentRef.setInput('page', RoutesCatalog.ADMIN_ENROLLMENTS);
    f.detectChanges();

    expect(f.componentInstance['loadError']()).toBe(true);
    expect(f.componentInstance['loading']()).toBe(false);
  });

  it('沒有紀錄時顯示空狀態', async () => {
    await setup([], 0);

    expect(fixture.nativeElement.textContent).toContain('近 30 天沒有報名進出');
  });

  // 全站其他頁面（學生管理、成績登錄）都把 J1/J2 轉成國一/國二，這頁原本沒轉（Tester #29）
  it('年級顯示中文，不是 J1/J2 代碼', async () => {
    await setup([enrollment({ studentGrade: 'J2' })]);

    expect(fixture.nativeElement.textContent).toContain('國二');
    expect(fixture.nativeElement.textContent).not.toContain('J2');
  });

  it('查不到對照表的代碼就照原樣顯示，不是空白', () => {
    expect(component['getGradeLabel']('UNKNOWN')).toBe('UNKNOWN');
  });

  describe('A6 列與篩選（#1314 EN3／EN4）', () => {
    it('班名下面寫生效期間與計費模式；沒有結束日寫「起」；沒填計費模式就不寫', async () => {
      await setup([
        enrollment({
          id: 'a',
          effectiveFrom: '2026-08-03',
          effectiveTo: '2026-12-31',
          billingMode: 'monthly',
        }),
        enrollment({
          id: 'b',
          effectiveFrom: '2026-09-01',
          effectiveTo: null,
          billingMode: 'period',
        }),
        enrollment({ id: 'c', effectiveFrom: '2026-09-02', effectiveTo: null, billingMode: null }),
        enrollment({ id: 'd', effectiveFrom: '2026-09-03', billingMode: 'session_pack' }),
      ]);

      expect(qa('period-text').map((e) => e.textContent?.trim())).toEqual([
        '08/03–12/31 · 月繳',
        '09/01 起 · 期繳',
        '09/02 起',
        '09/03 起 · 堂數制',
      ]);
    });

    it('事件 pill：新報名黑框、退班紅、暫停與作廢灰', async () => {
      await setup([
        enrollment({ id: 'a', status: 'active' }),
        enrollment({ id: 'b', status: 'withdrawal', effectiveTo: '2026-08-14' }),
        enrollment({ id: 'c', status: 'suspended', statusChangedAt: '2026-08-10' }),
        enrollment({ id: 'd', status: 'void', effectiveTo: '2026-08-12' }),
      ]);

      const [joined, left, paused, voided] = qa('event-pill');
      expect(joined.classList).toContain('ring-zinc-900');
      expect(left.classList).toContain('text-error-700');
      expect(paused.classList).toContain('ring-zinc-300');
      expect(voided.classList).toContain('ring-zinc-300');
    });

    it('經手人只在新報名列顯示，退班不編造', async () => {
      await setup([
        enrollment({ id: 'a', status: 'active', createdByName: '林主任' }),
        enrollment({
          id: 'b',
          status: 'withdrawal',
          effectiveTo: '2026-08-14',
          createdByName: '林主任',
        }),
      ]);

      const [joined, left] = qa('handler-text');
      expect(joined.textContent).toContain('林主任');
      expect(left.textContent).not.toContain('林主任');
    });

    it('選學生會帶 studentId 重查並回到第一頁；清空就不帶', async () => {
      await setup();
      component['onPageChange'](3);
      listMock.mockClear();

      component['onStudentChange']({ id: 'stu-9', name: '王小明' } as never);
      expect(listMock.mock.calls[0][0].studentId).toBe('stu-9');
      expect(listMock.mock.calls[0][0].page).toBe(1);

      // 打字中（字串）不算選到人
      listMock.mockClear();
      component['onStudentChange']('王');
      expect(listMock.mock.calls[0][0].studentId).toBeUndefined();
    });

    it('打字查學生走學生搜尋，不是前端濾', async () => {
      await setup();
      studentsListMock.mockReturnValue(
        of({ data: [{ id: 'stu-9', name: '王小明' }], meta: { total: 1 } }),
      );

      component['onStudentQuery']('王');

      expect(studentsListMock).toHaveBeenCalledWith({ search: '王', pageSize: 10 });
      expect(component['studentSuggestions']()).toHaveLength(1);
    });

    it('選開課班會帶 classId 重查；班級選項來自班級清單', async () => {
      await setup();
      listMock.mockClear();

      expect(component['classOptions']().map((o) => o.label)).toEqual([
        '全部班級',
        '國二數學 A',
        '國三英文 B',
      ]);
      component['onClassChange']('class-2');

      expect(listMock.mock.calls[0][0].classId).toBe('class-2');
      expect(component['filterSummary']()).toBe('國三英文 B');
    });

    it('班級清單讀不到只是少一個選項，列表照常', async () => {
      classesListMock.mockReset();
      await setup();
      // setup 內已 mockReturnValue；這裡模擬失敗後的狀態：只剩「全部班級」
      component['classOptions'].set([{ label: '全部班級', value: null }]);
      expect(component['classOptions']()).toHaveLength(1);
      expect(component['rows']()).toHaveLength(1);
    });

    it('清除篩選：學生、班級、狀態一起清掉並重查，期間不動', async () => {
      await setup();
      component['onClassChange']('class-1');
      component['onStatusChange']('withdrawal');
      component['onMonthChange']('2026-08');
      listMock.mockClear();

      component['clearFilters']();

      const call = listMock.mock.calls[0][0];
      expect(call.classId).toBeUndefined();
      expect(call.status).toBeUndefined();
      expect(call.studentId).toBeUndefined();
      expect(call.from).toBe('2026-08-01');
      expect(component['hasFilter']()).toBe(false);
    });

    it('有篩選時摘要出現「清除篩選」，空狀態也有', async () => {
      await setup();
      expect(q('clear-filters')).toBeNull();

      component['onStatusChange']('withdrawal');
      listMock.mockReturnValue(
        of({ data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } }),
      );
      component['onStatusChange']('suspended');
      fixture.detectChanges();

      expect(q('empty')).not.toBeNull();
      expect(q('clear-filters')).not.toBeNull();
    });

    it('點學生名只進學生檔案，不會同時開班級', async () => {
      await setup();

      const link = q('student-link') as HTMLAnchorElement;
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(event);

      expect(navigateMock).not.toHaveBeenCalled();
      expect(link.getAttribute('href')).toBe('/admin/students/stu-1');
    });

    it('分頁：上一頁／下一頁與「第 x／y 頁」；第一頁沒有上一頁', async () => {
      await setup([enrollment()], 45);

      expect(q('page-indicator')!.textContent).toContain('第 1／3 頁');
      expect((q('prev-page') as HTMLButtonElement).disabled).toBe(true);

      listMock.mockClear();
      (q('next-page') as HTMLButtonElement).click();
      expect(listMock.mock.calls[0][0].page).toBe(2);
    });

    it('只有一頁就不畫分頁', async () => {
      await setup();
      expect(q('page-indicator')).toBeNull();
    });
  });

  describe('Hero 數字句、事件計數與事件篩選（#1507）', () => {
    const day = (offset: number) => format(subDays(new Date(), offset), 'yyyy-MM-dd');
    const hero = () => q('hero-title')!.textContent!.replace(/\s+/g, '');

    it('照期間寫「新報名 N 筆，退班 M 筆。」', async () => {
      await setup();
      countsMock.mockReturnValue(of({ data: { joined: 12, left: 3, paused: 1, voided: 0 } }));
      component['onMonthChange']('last30');
      fixture.detectChanges();
      expect(hero()).toBe('近30天新報名12筆，退班3筆。');

      component['onMonthChange']('2026-08');
      fixture.detectChanges();
      expect(hero()).toBe('8月新報名12筆，退班3筆。');

      component['onMonthChange']('');
      fixture.detectChanges();
      expect(hero()).toBe('這段期間新報名12筆，退班3筆。');
    });

    it('四個數都是 0 寫「沒有報名進出」', async () => {
      await setup();
      countsMock.mockReturnValue(of({ data: { joined: 0, left: 0, paused: 0, voided: 0 } }));
      component['onMonthChange']('last30');
      fixture.detectChanges();

      expect(hero()).toBe('近30天沒有報名進出。');
    });

    // #1524：載入中不能說成「沒有」，失敗也不能寫 0
    it('計數載入中或失敗時，標題是頁名，不寫數字；列表照常', async () => {
      await setup();
      countsMock.mockReturnValue(NEVER);
      component['onMonthChange']('2026-08');
      fixture.detectChanges();
      expect(hero()).toBe(RoutesCatalog.ADMIN_ENROLLMENTS.label);
      expect(qa('event-count')).toHaveLength(0);

      countsMock.mockReturnValue(throwError(() => new Error('boom')));
      component['onMonthChange']('2026-09');
      fixture.detectChanges();
      expect(hero()).toBe(RoutesCatalog.ADMIN_ENROLLMENTS.label);
      expect(qa('enrollment-row')).toHaveLength(1);
    });

    it('摘要：共 N 筆之後列四種事件數', async () => {
      await setup();
      countsMock.mockReturnValue(of({ data: { joined: 5, left: 2, paused: 1, voided: 1 } }));
      component['onMonthChange']('last30');
      fixture.detectChanges();

      expect(qa('event-count').map((el) => el.textContent!.replace(/\s+/g, ''))).toEqual([
        '·新報名5',
        '·退班2',
        '·暫停1',
        '·作廢1',
      ]);
    });

    it('計數跟著期間、學生、班、狀態、分校走，但不帶分頁', async () => {
      await setup();
      component['onClassChange']('class-1');
      component['onStatusChange']('withdrawal');

      const call = countsMock.mock.calls.at(-1)![0];
      expect(call).toMatchObject({ classId: 'class-1', status: 'withdrawal', from: day(29) });
      expect(call.page).toBeUndefined();
      expect(call.event).toBeUndefined();

      countsMock.mockClear();
      component['onPageChange'](2);
      expect(countsMock).not.toHaveBeenCalled();
    });

    // 計畫席 10-10 裁 (a)：照 A6，選「退班」時新報名寫 0
    it('選事件：列表帶 event；計數只留那一種，其他歸零；篩選摘要與清除都算它', async () => {
      await setup();
      countsMock.mockReturnValue(of({ data: { joined: 5, left: 2, paused: 1, voided: 0 } }));
      listMock.mockClear();

      component['onEventChange']('left');
      fixture.detectChanges();

      expect(listMock.mock.calls[0][0].event).toBe('left');
      expect(hero()).toBe('近30天新報名0筆，退班2筆。');
      expect(component['filterSummary']()).toBe('退班');
      expect(component['hasFilter']()).toBe(true);

      listMock.mockClear();
      component['clearFilters']();
      expect(listMock.mock.calls[0][0].event).toBeUndefined();
      expect(component['event']()).toBeNull();
    });

    it('有指定事件時 pill 寫那件事：報了又退的人在「新報名」篩選下是新報名', async () => {
      const churned = enrollment({
        status: 'withdrawal',
        effectiveFrom: day(8),
        effectiveTo: day(2),
      });
      await setup([churned]);
      expect(q('event-pill')!.textContent).toContain('退班');

      component['onEventChange']('joined');
      fixture.detectChanges();
      expect(q('event-pill')!.textContent).toContain('新報名');
    });

    it('退班副行分「辦理退班」與「到期結束」；到期結束的狀態欄寫「已結束」不寫在學', async () => {
      await setup([
        enrollment({ id: 'w', status: 'withdrawal', effectiveTo: day(5) }),
        enrollment({ id: 'x', status: 'active', effectiveTo: day(3) }),
        // 排定日還沒到：仍是新報名、在學，沒有副行
        enrollment({ id: 'y', status: 'active', effectiveTo: day(-20) }),
      ]);

      expect(component['rows']().map((r) => r.event.kind)).toEqual(['left', 'left', 'joined']);
      expect(qa('event-note').map((el) => el.textContent!.trim())).toEqual([
        '辦理退班',
        '到期結束',
      ]);
      expect(qa('status-text').map((el) => el.textContent!.trim())).toEqual([
        '退班',
        '已結束',
        '在學',
      ]);
    });

    // charter #1524：每條 switchMap 要有亂序 spec —— 先發的慢回應不能蓋掉後發的
    it('列表亂序回應：只認最後一次條件的結果', async () => {
      await setup();
      const slow = new Subject<EnrollmentListResponse>();
      const fast = new Subject<EnrollmentListResponse>();
      listMock.mockReturnValueOnce(slow).mockReturnValueOnce(fast);

      component['onStatusChange']('withdrawal');
      component['onStatusChange']('suspended');
      fast.next({
        data: [enrollment({ id: 'new' })],
        meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
      });
      slow.next({
        data: [enrollment({ id: 'old' })],
        meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
      });

      expect(component['rows']().map((r) => r.enrollment.id)).toEqual(['new']);
    });

    it('計數亂序回應：只認最後一次條件的結果', async () => {
      await setup();
      const slow = new Subject<{ data: typeof COUNTS }>();
      const fast = new Subject<{ data: typeof COUNTS }>();
      countsMock.mockReturnValueOnce(slow).mockReturnValueOnce(fast);

      component['onStatusChange']('withdrawal');
      component['onStatusChange']('suspended');
      fast.next({ data: { joined: 2, left: 0, paused: 7, voided: 0 } });
      slow.next({ data: { joined: 9, left: 9, paused: 0, voided: 0 } });

      expect(component['counts']()).toEqual({ joined: 2, left: 0, paused: 7, voided: 0 });
    });
  });
});
