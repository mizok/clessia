import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { EnrollmentsService, type BatchMatchResultItem } from '@core/enrollments.service';
import { SchoolsService } from '@core/schools.service';

import { RosterImportDialogComponent } from './roster-import-dialog.component';
import type { RosterRow } from './roster-import.util';

const CLASS_ID = 'class-1';

const SCHOOLS = [
  { id: 's1', name: '台北市立文山國中', shortName: '文山', isActive: true, studentCount: 0, createdAt: '', updatedAt: '' },
  { id: 's2', name: '新北市立景美國中', shortName: null, isActive: true, studentCount: 0, createdAt: '', updatedAt: '' },
];

function row(index: number, name: string, school: string): RosterRow {
  return { index, name, school, error: null };
}

describe('RosterImportDialogComponent', () => {
  let fixture: ComponentFixture<RosterImportDialogComponent>;
  let component: RosterImportDialogComponent;

  const batchMatchMock = vi.fn();
  const batchCreateMock = vi.fn();
  const schoolsListMock = vi.fn();
  const closeMock = vi.fn();

  async function setup() {
    batchMatchMock.mockReset();
    batchCreateMock.mockReset();
    schoolsListMock.mockReset();
    closeMock.mockReset();

    schoolsListMock.mockReturnValue(of({ data: SCHOOLS, meta: { total: SCHOOLS.length } }));
    batchMatchMock.mockReturnValue(of({ results: [] }));
    batchCreateMock.mockReturnValue(of({ results: [] }));

    await TestBed.configureTestingModule({
      imports: [RosterImportDialogComponent],
      providers: [
        {
          provide: EnrollmentsService,
          useValue: { batchMatch: batchMatchMock, batchCreate: batchCreateMock },
        },
        { provide: SchoolsService, useValue: { list: schoolsListMock } },
        { provide: DynamicDialogRef, useValue: { close: closeMock } },
        { provide: DynamicDialogConfig, useValue: { data: { classId: CLASS_ID } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RosterImportDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  /** 直接把解析結果塞進去，跳過 FileReader —— 解析本身在 util 的測試裡驗過了 */
  function seedRows(rows: RosterRow[]) {
    component['rows'].set(rows);
    component['schools'] = SCHOOLS.map((s) => ({ id: s.id, name: s.name, shortName: s.shortName }));
    component['prepareSchoolStep']();
  }

  it('學校全部只有唯一解時直接跳過對照步驟', async () => {
    await setup();

    seedRows([row(1, '陳大同', '文山國中')]);

    expect(component['step']()).toBe('review');
    expect(batchMatchMock).toHaveBeenCalled();
  });

  it('學校對不到時停在對照步驟，不往下走', async () => {
    await setup();

    seedRows([row(1, '陳大同', '不存在國中')]);

    expect(component['step']()).toBe('schools');
    expect(batchMatchMock).not.toHaveBeenCalled();
  });

  // 這是整個功能的關鍵：後端拿 schools.name 完全相符去查，送簡稱進去每列都會 not_found
  it('送出比對時把學校簡稱換成系統裡的全名', async () => {
    await setup();

    seedRows([row(1, '陳大同', '文山國中')]);

    expect(batchMatchMock).toHaveBeenCalledWith(CLASS_ID, [
      { name: '陳大同', school: '台北市立文山國中' },
    ]);
  });

  it('只送比對成功與人工指定過的學生', async () => {
    await setup();
    const results: BatchMatchResultItem[] = [
      { index: 0, status: 'matched', studentId: 'stu-1' },
      { index: 1, status: 'not_found' },
      { index: 2, status: 'already_enrolled' },
      {
        index: 3,
        status: 'ambiguous',
        candidates: [
          { id: 'stu-4a', name: '林小美', grade: 'J1', school: '文山' },
          { id: 'stu-4b', name: '林小美', grade: 'J2', school: '文山' },
        ],
      },
    ];
    batchMatchMock.mockReturnValue(of({ results }));

    seedRows([
      row(1, 'A', '文山國中'),
      row(2, 'B', '文山國中'),
      row(3, 'C', '文山國中'),
      row(4, '林小美', '文山國中'),
    ]);

    expect(component['selectedStudentIds']()).toEqual(['stu-1']);

    component['onCandidateChoice'](4, 'stu-4b');

    expect(component['selectedStudentIds']()).toEqual(['stu-1', 'stu-4b']);
    expect(component['blockedCount']()).toBe(2);
  });

  it('匯入時帶上生效日', async () => {
    await setup();
    batchMatchMock.mockReturnValue(of({ results: [{ index: 0, status: 'matched', studentId: 'stu-1' }] }));
    batchCreateMock.mockReturnValue(of({ results: [{ studentId: 'stu-1', status: 'enrolled' }] }));

    seedRows([row(1, '陳大同', '文山國中')]);
    component['effectiveFrom'].set(new Date(2026, 5, 1));
    component['submit']();

    expect(batchCreateMock).toHaveBeenCalledWith({
      classId: CLASS_ID,
      studentIds: ['stu-1'],
      skipConflictCheck: false,
      effectiveFrom: '2026-06-01',
    });
    expect(component['step']()).toBe('done');
    expect(component['enrolledCount']()).toBe(1);
  });

  it('衝堂時不寫入，攤開衝突讓人決定', async () => {
    await setup();
    batchMatchMock.mockReturnValue(of({ results: [{ index: 0, status: 'matched', studentId: 'stu-1' }] }));
    batchCreateMock.mockReturnValue(
      throwError(() => ({
        error: {
          code: 'SCHEDULE_CONFLICT',
          warnings: [
            {
              studentId: 'stu-1',
              conflictingClassId: 'c9',
              conflictingClassName: '英文班',
              conflictingCourseName: '英文',
              weekday: 3,
              startTime: '19:00',
              endTime: '21:00',
            },
          ],
        },
      })),
    );

    seedRows([row(1, '陳大同', '文山國中')]);
    component['submit']();

    expect(component['conflicts']()).toHaveLength(1);
    expect(component['step']()).toBe('review');
  });

  it('確認後強制匯入會帶 skipConflictCheck', async () => {
    await setup();
    batchMatchMock.mockReturnValue(of({ results: [{ index: 0, status: 'matched', studentId: 'stu-1' }] }));
    batchCreateMock.mockReturnValue(of({ results: [{ studentId: 'stu-1', status: 'enrolled' }] }));

    seedRows([row(1, '陳大同', '文山國中')]);
    component['submitForce']();

    expect(batchCreateMock.mock.calls[0][0]).toMatchObject({ skipConflictCheck: true });
  });

  it('人數上限的錯誤訊息要帶出數字', async () => {
    await setup();
    batchMatchMock.mockReturnValue(of({ results: [{ index: 0, status: 'matched', studentId: 'stu-1' }] }));
    batchCreateMock.mockReturnValue(
      throwError(() => ({
        error: { code: 'OVER_QUOTA', quota: 20, currentActive: 12, adding: 30 },
      })),
    );

    seedRows([row(1, '陳大同', '文山國中')]);
    component['submit']();

    const message = component['submitError']();
    expect(message).toContain('20');
    expect(message).toContain('12');
    expect(message).toContain('30');
  });

  it('沒有任何可匯入的人時不打 API', async () => {
    await setup();
    batchMatchMock.mockReturnValue(of({ results: [{ index: 0, status: 'not_found' }] }));

    seedRows([row(1, '陳大同', '文山國中')]);
    component['submit']();

    expect(batchCreateMock).not.toHaveBeenCalled();
  });

  it('有匯入才通知呼叫端重新載入名單', async () => {
    await setup();
    batchMatchMock.mockReturnValue(of({ results: [{ index: 0, status: 'matched', studentId: 'stu-1' }] }));
    batchCreateMock.mockReturnValue(of({ results: [{ studentId: 'stu-1', status: 'enrolled' }] }));

    seedRows([row(1, '陳大同', '文山國中')]);
    component['submit']();
    component['close']();

    expect(closeMock).toHaveBeenCalledWith('imported');
  });
});
