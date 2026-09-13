import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';
import { SessionsService } from '@core/sessions.service';
import { StaffService } from '@core/staff.service';
import { CoursesService } from '@core/courses.service';

import { SessionAssignDialogComponent } from './session-assign-dialog.component';

describe('SessionAssignDialogComponent', () => {
  let component: SessionAssignDialogComponent;
  let fixture: ComponentFixture<SessionAssignDialogComponent>;
  const staffListSpy = vi.fn();
  const courseGetSpy = vi.fn();

  beforeEach(async () => {
    staffListSpy.mockReset();
    courseGetSpy.mockReset();
    staffListSpy.mockReturnValue(of({ data: [] }));
    courseGetSpy.mockReturnValue(of({ data: { subjectId: 'subject-math' } }));

    await TestBed.configureTestingModule({
      imports: [SessionAssignDialogComponent],
      providers: [
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              session: {
                id: '00000000-0000-0000-0000-000000000001',
                classId: '00000000-0000-0000-0000-000000000002',
                className: '測試班級',
                courseId: 'course-math',
                campusId: 'campus-a',
                sessionDate: '2026-03-08',
                startTime: '09:00',
                endTime: '11:00',
                teacherId: null,
                teacherName: null,
                status: 'scheduled',
                assignmentStatus: 'unassigned',
              },
            },
          },
        },
        {
          provide: DynamicDialogRef,
          useValue: { close: vi.fn() },
        },
        {
          provide: SessionsService,
          useValue: {
            batchAssignTeacher: vi.fn(() =>
              of({
                updated: 1,
                skippedConflicts: 0,
                skippedNotEligible: 0,
                conflicts: [],
                dryRun: false,
              }),
            ),
          },
        },
        {
          provide: StaffService,
          useValue: {
            list: staffListSpy,
          },
        },
        {
          provide: CoursesService,
          useValue: {
            get: courseGetSpy,
          },
        },
        {
          provide: MessageService,
          useValue: { add: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionAssignDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load teachers with campus and course subject filter when dialog has no preloaded teachers', async () => {
    await fixture.whenStable();
    expect(staffListSpy).toHaveBeenCalledWith({ role: 'teacher', campusId: 'campus-a' });
    expect(courseGetSpy).toHaveBeenCalledWith('course-math');
  });

  /**
   * **#849：既有那條只驗「有呼叫 API」，而 `staffListSpy` 回的是空陣列** ——
   * 所以那個 filter 從定義上沒有被考驗過：不管它寫成什麼樣，結果都是空的、測試都綠。
   *
   * 而 #849 的現象正是「候選為空」：本機 84% 的課堂所在的分校沒有任何被指派的老師，
   * 於是「指派老師」在任何一堂課上都按不下去。**seed 那半由哨兵守（模擬同一個 SQL），
   * 但畫面上還有這一層自己的 filter** —— 它是唯一沒有人蓋到的地方。
   */
  it('#849 候選要同時符合分校與科目 —— 只符合一邊的不算', async () => {
    staffListSpy.mockReturnValue(
      of({
        data: [
          // 兩邊都符合 → 是候選
          { id: 's1', campusIds: ['campus-a'], subjectIds: ['subject-math'] },
          // 分校對、科目不對
          { id: 's2', campusIds: ['campus-a'], subjectIds: ['subject-eng'] },
          // 科目對、**分校不對** —— 這一格就是 #849 的形狀：
          // 他在那個分校教課，但 `staff_campuses` 沒有該校的列
          { id: 's3', campusIds: ['campus-b'], subjectIds: ['subject-math'] },
        ],
      }),
    );

    const localFixture = TestBed.createComponent(SessionAssignDialogComponent);
    await localFixture.whenStable();

    const ids = (
      localFixture.componentInstance as unknown as { teachers: () => Array<{ id: string }> }
    )
      .teachers()
      .map((teacher) => teacher.id);
    expect(ids).toEqual(['s1']);
  });

  it('#849 候選全被濾掉時是空的 —— 那就是按鈕按不下去的那一刻', async () => {
    staffListSpy.mockReturnValue(
      of({ data: [{ id: 's3', campusIds: ['campus-b'], subjectIds: ['subject-math'] }] }),
    );

    const localFixture = TestBed.createComponent(SessionAssignDialogComponent);
    await localFixture.whenStable();

    expect(
      (localFixture.componentInstance as unknown as { teachers: () => unknown[] }).teachers(),
    ).toEqual([]);
  });

  it('should skip loading teachers when preloaded teachers are provided', async () => {
    staffListSpy.mockClear();
    courseGetSpy.mockClear();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [SessionAssignDialogComponent],
      providers: [
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              session: {
                id: '00000000-0000-0000-0000-000000000001',
                classId: '00000000-0000-0000-0000-000000000002',
                className: '測試班級',
                courseId: 'course-math',
                campusId: 'campus-a',
                sessionDate: '2026-03-08',
                startTime: '09:00',
                endTime: '11:00',
                teacherId: null,
                teacherName: null,
                status: 'scheduled',
                assignmentStatus: 'unassigned',
              },
              teachers: [
                {
                  id: 'teacher-1',
                  displayName: '王老師',
                  campusIds: ['campus-a'],
                  subjectIds: ['subject-math'],
                  roles: ['teacher'],
                  status: 'active',
                },
              ],
            },
          },
        },
        {
          provide: DynamicDialogRef,
          useValue: { close: vi.fn() },
        },
        {
          provide: SessionsService,
          useValue: {
            batchAssignTeacher: vi.fn(() =>
              of({
                updated: 1,
                skippedConflicts: 0,
                skippedNotEligible: 0,
                conflicts: [],
                dryRun: false,
              }),
            ),
          },
        },
        {
          provide: StaffService,
          useValue: {
            list: staffListSpy,
          },
        },
        {
          provide: CoursesService,
          useValue: {
            get: courseGetSpy,
          },
        },
        {
          provide: MessageService,
          useValue: { add: vi.fn() },
        },
      ],
    }).compileComponents();

    const secondFixture = TestBed.createComponent(SessionAssignDialogComponent);
    await secondFixture.whenStable();

    expect(staffListSpy).not.toHaveBeenCalled();
    expect(courseGetSpy).not.toHaveBeenCalled();
  });
});
