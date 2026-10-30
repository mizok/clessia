import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ScoresService, type ScoreRecord } from '@core/scores.service';
import {
  StudentsService,
  type Student,
  type StudentAttendanceDays,
  type StudentDetail,
} from '@core/students.service';
import { SystemClockService } from '@core/system-clock.service';

import { StudentPanelComponent } from './student-panel.component';

const STUDENT = {
  id: 's1',
  name: '陳大同',
  grade: 'J2',
  school: { id: 'sc', name: '建國國中', shortName: null },
} as Student;

const DETAIL = {
  ...STUDENT,
  parents: [
    {
      id: 'p2',
      name: '陳爸爸',
      phone: '0911000000',
      relation: '父',
      isPrimary: false,
      email: null,
    },
    { id: 'p1', name: '林媽媽', phone: '0922333444', relation: '母', isPrimary: true, email: null },
  ],
} as StudentDetail;

type Day = StudentAttendanceDays['days'][number];
const day = (date: string, state: Day['state'], className = '數學 A'): Day => ({
  date,
  state,
  sessions: [{ sessionId: date, className, startTime: '18:00', status: 'scheduled' }],
});

const score = (overrides: Partial<ScoreRecord>): ScoreRecord =>
  ({
    id: 'r1',
    type: 'academy',
    examName: '第一次小考',
    examDate: '2026-10-20',
    score: 82,
    totalScore: 100,
    status: 'scored',
    classAvg: 76.4,
    ...overrides,
  }) as ScoreRecord;

describe('StudentPanelComponent（老師的學生面板，TST1）', () => {
  const get = vi.fn();
  const attendanceDays = vi.fn();
  const list = vi.fn();
  const add = vi.fn();

  function setup(
    opts: {
      days?: Day[];
      scores?: ScoreRecord[];
      detail?: ReturnType<typeof of> | ReturnType<typeof throwError>;
    } = {},
  ) {
    get.mockReset().mockReturnValue(opts.detail ?? of({ data: DETAIL }));
    attendanceDays.mockReset().mockReturnValue(of({ days: opts.days ?? [] }));
    list.mockReset().mockReturnValue(of({ data: opts.scores ?? [] }));
    add.mockReset();
    TestBed.configureTestingModule({
      imports: [StudentPanelComponent],
      providers: [
        provideRouter([]),
        { provide: StudentsService, useValue: { get, attendanceDays } },
        { provide: ScoresService, useValue: { list } },
        { provide: MessageService, useValue: { add } },
        { provide: SystemClockService, useValue: { todayTaipei: () => '2026-10-30' } },
      ],
    });
    const fixture = TestBed.createComponent(StudentPanelComponent);
    fixture.componentRef.setInput('student', STUDENT);
    fixture.componentRef.setInput('classId', 'k1');
    fixture.componentRef.setInput('className', '數學 A');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('三份資料都走既有的老師範圍端點；成績帶這班的 id、校內考、3 筆', () => {
    setup();
    expect(get).toHaveBeenCalledWith('s1');
    expect(attendanceDays).toHaveBeenCalledWith('s1', expect.any(String), '2026-10-30');
    expect(list).toHaveBeenCalledWith({
      studentId: 's1',
      classId: 'k1',
      type: 'academy',
      pageSize: 3,
    });
  });

  it('家長：主要家長的姓名、關係、電話；複製電話會寫入剪貼簿並提示', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const el = setup();

    expect(el.textContent).toContain('林媽媽（母）');
    expect(el.textContent).toContain('0922333444');
    (el.querySelector('[data-copy]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('0922333444');
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ summary: '已複製 林媽媽 的電話 0922333444' }),
    );
  });

  it('這班最近 5 堂：只挑這班的日子、只算點過名的（到／沒到／請假），新的在後', () => {
    const el = setup({
      days: [
        day('2026-10-01', 'came'),
        day('2026-10-02', 'came', '英文 B'),
        day('2026-10-05', 'absent'),
        day('2026-10-08', 'on_leave'),
        day('2026-10-12', 'cancelled'),
        day('2026-10-15', 'came'),
        day('2026-10-19', 'came'),
        day('2026-10-22', 'came'),
        day('2026-11-02', 'future'),
      ],
    });

    const cells = [...el.querySelectorAll('[data-day]')].map((c) => c.textContent!.replace(/\s+/g, ''));
    expect(el.textContent).toContain('這班最近 5 堂');
    expect(cells).toEqual(['10/5沒到', '10/8請假', '10/15到', '10/19到', '10/22到']);
  });

  it('考試：分數、日期、班平均；不及格標出來', () => {
    const el = setup({
      scores: [
        score({ id: 'a', examName: '第二次小考', score: 52, classAvg: 70 }),
        score({ id: 'b' }),
      ],
    });

    const rows = [...el.querySelectorAll('[data-exam]')].map((r) =>
      r.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(rows[0]).toContain('第二次小考');
    expect(rows[0]).toContain('班平均 70');
    expect(rows[0]).toContain('52 不及格');
    expect(rows[1]).toContain('82');
    expect(rows[1]).not.toContain('不及格');
  });

  it('沒有資料時各寫一句，不留白', () => {
    const el = setup();
    expect(el.textContent).toContain('這班還沒有點過名。');
    expect(el.textContent).toContain('這班還沒有考試成績。');
  });

  it('403：寫「讀不到這位學生」，不是空白', () => {
    const el = setup({
      detail: throwError(() => new HttpErrorResponse({ status: 403 })),
    });
    expect(el.textContent).toContain('讀不到這位學生');
  });

  it('其他錯誤：寫查詢失敗', () => {
    const el = setup({
      detail: throwError(() => new HttpErrorResponse({ status: 500 })),
    });
    expect(el.textContent).toContain('查詢失敗，請稍後再試。');
  });
});
