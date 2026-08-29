import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { CampusesService } from '@core/campuses.service';
import { EnrollmentsService, type Enrollment } from '@core/enrollments.service';
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
    ...overrides,
  };
}

describe('EnrollmentsPage', () => {
  let fixture: ComponentFixture<EnrollmentsPage>;
  let component: EnrollmentsPage;

  const listMock = vi.fn();
  const campusesMock = vi.fn();
  const navigateMock = vi.fn();

  async function setup(data: Enrollment[] = [enrollment()], total = data.length) {
    listMock.mockReset();
    campusesMock.mockReset();
    navigateMock.mockReset();

    listMock.mockReturnValue(of({ data, meta: { total, page: 1, pageSize: 20, totalPages: 1 } }));
    campusesMock.mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [EnrollmentsPage],
      providers: [
        { provide: EnrollmentsService, useValue: { list: listMock } },
        { provide: CampusesService, useValue: { list: campusesMock } },
        { provide: Router, useValue: { navigate: navigateMock } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EnrollmentsPage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', RoutesCatalog.ADMIN_ENROLLMENTS);
    fixture.detectChanges();
  }

  it('預設查當月，並用 updatedAt 排序', async () => {
    await setup();

    const call = listMock.mock.calls[0][0];
    expect(call.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(call.to >= call.from).toBe(true);
    expect(call.sort).toBe('updatedAt');
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

    expect(component['joinedCount']()).toBe(1);
    expect(component['leftCount']()).toBe(1);
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

  it('切換分校會重新查詢並回到第一頁', async () => {
    await setup();
    component['onPageChange'](3);
    listMock.mockClear();

    component['onCampusChange']('campus-9');

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
  it('狀態選項不含待付款', async () => {
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
    campusesMock.mockReset();
    listMock.mockReturnValue(throwError(() => new Error('boom')));
    campusesMock.mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [EnrollmentsPage],
      providers: [
        { provide: EnrollmentsService, useValue: { list: listMock } },
        { provide: CampusesService, useValue: { list: campusesMock } },
        { provide: Router, useValue: { navigate: navigateMock } },
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

    expect(fixture.nativeElement.textContent).toContain('這個月沒有報名進出');
  });
});
