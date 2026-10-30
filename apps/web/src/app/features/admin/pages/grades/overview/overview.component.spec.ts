import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AcademyExamsService, type AcademyExam } from '@core/academy-exams.service';
import { ScoresService, type ScoresOverview } from '@core/scores.service';
import { OverviewComponent } from './overview.component';

describe('OverviewComponent（#991 grades G3）', () => {
  const exam = (id: string, scoreCount: number, expectedCount: number) =>
    ({ id, name: `小考 ${id}`, examDate: '2026-10-01', scoreCount, expectedCount }) as AcademyExam;
  const list = vi.fn();
  const overview = vi.fn();
  const summary = (over: Partial<ScoresOverview> = {}): ScoresOverview => ({
    windowDays: 30,
    exams: { count: 7, pendingCount: 1, avgScore: 72.6 },
    failingStudents: [],
    failingTotal: 0,
    lowestClasses: [],
    totalClasses: 0,
    recentExams: [],
    ...over,
  });

  function render(): HTMLElement {
    TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: [
        provideRouter([]),
        { provide: AcademyExamsService, useValue: { list } },
        {
          provide: ScoresService,
          useValue: {
            overview,
            studentAggregatesAll: () => of({ data: [], meta: { total: 42, page: 1, pageSize: 1 } }),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(OverviewComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    list.mockReset();
    overview.mockReset().mockReturnValue(of(summary()));
  });

  it('標題用近 30 天的場數與還沒登完的場數；清單寫還差幾人', () => {
    list.mockReturnValue(
      of({ data: [exam('a', 3, 9)], meta: { total: 1, page: 1, pageSize: 50 } }),
    );
    const host = render();

    expect(overview).toHaveBeenCalledWith({ days: 30 });
    expect(host.querySelector('h1')!.textContent!.replace(/\s+/g, '')).toBe(
      '近一個月7場考試，1場還沒登錄完。',
    );
    expect(host.textContent).toContain('這 7 場的平均是 73 分。');
    expect(host.textContent).toContain('6人還沒登錄');
    expect(host.querySelector('a[aria-label="去登錄 小考 a"]')).not.toBeNull();
  });

  it('都登完了就說登完了；取數失敗顯示載入失敗', () => {
    list.mockReturnValue(of({ data: [], meta: { total: 0, page: 1, pageSize: 1 } }));
    expect(render().textContent).toContain('成績都登錄完了');

    TestBed.resetTestingModule();
    list.mockReturnValue(throwError(() => new Error('x')));
    expect(render().querySelector('app-load-failed')).not.toBeNull();
  });

  it('彙總（#1314 G5）：不及格學生、班平均最低、最近的考試', () => {
    list.mockReturnValue(of({ data: [], meta: { total: 0, page: 1, pageSize: 50 } }));
    overview.mockReturnValue(
      of(
        summary({
          failingStudents: [
            {
              studentId: 's1',
              name: '王小明',
              grade: 'J2',
              className: '國二數學 A',
              examName: '第三次小考',
              examDate: '2026-10-01',
              score: 41,
              totalScore: 100,
            },
          ],
          failingTotal: 4,
          lowestClasses: [
            {
              classId: 'c1',
              className: '國二數學 A',
              examId: 'e1',
              examName: '第三次小考',
              examDate: '2026-10-01',
              totalScore: 100,
              avgScore: 58.4,
              failCount: 5,
              absentCount: 1,
            },
          ],
          totalClasses: 9,
          recentExams: [
            {
              examId: 'e1',
              className: '國二數學 A',
              examName: '第三次小考',
              examDate: '2026-10-01',
              totalScore: 100,
              avgScore: null,
              failCount: 0,
              absentCount: 0,
              missingCount: 3,
            },
          ],
        }),
      ),
    );
    const host = render();
    const text = host.textContent!.replace(/\s+/g, ' ');

    expect(text).toContain('最近一次考試不及格 4 位');
    expect(host.querySelector('a[href="/admin/students/s1"]')!.textContent).toContain('41 分');
    expect(text).toContain('看全部 42 位學生的成績');
    expect(text).toContain('第三次小考 · 不及格 5 人 · 缺考 1');
    expect(text).toContain('平均 58 分');
    expect(text).toContain('看全部 9 個班的考試統計');
    expect(text).toContain('1 場 · 近 30 天');
    expect(text).toContain('10/1（四） · 不及格 0 人 · 還差 3 人');
    expect(host.querySelector('a[aria-label="看成績 國二數學 A 第三次小考"]')).not.toBeNull();
  });
});
