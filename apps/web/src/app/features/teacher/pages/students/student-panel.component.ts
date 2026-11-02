import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import { forkJoin } from 'rxjs';

import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { ScoresService, type ScoreRecord } from '@core/scores.service';
import {
  GRADE_LEVEL_LABELS,
  StudentsService,
  type Student,
  type StudentAttendanceDays,
  type StudentDetailParent,
} from '@core/students.service';
import { SystemClockService, addDaysToDateString } from '@core/system-clock.service';
import { isFailingScore } from '@shared/utils/score-threshold.util';

/** 往回找幾天的到班格：一週一堂的班也湊得到 5 堂（API 上限 366 天） */
const DAYS_BACK = 90;

const DAY_LABEL = { came: '到', absent: '沒到', on_leave: '請假' } as const;
type TakenState = keyof typeof DAY_LABEL;

interface PanelData {
  readonly parent: StudentDetailParent | null;
  readonly days: ReadonlyArray<{ date: string; state: TakenState }>;
  readonly exams: ScoreRecord[];
}

/**
 * 老師的學生面板（TST1，A6 `t-students.html` 的 `panel()`）：家長聯絡、這班最近 5 堂、這班最近的考試。
 * 三份資料都走既有的老師範圍端點，面板只是讀者（`kb/wiki/architecture/teacher-students-view.md`「學生面板」）。
 * 外框（原生 `<dialog>`）在頁面上；這裡是標題以下的內容，每次打開都是新的一份。
 */
@Component({
  selector: 'app-student-panel',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-col' },
  template: `
    <div class="flex items-start justify-between pt-4 pr-4 pb-2 pl-6 max-wide:pl-4">
      <div>
        <h2 id="student-panel-title" class="m-0 text-xl font-bold">{{ student().name }}</h2>
        <p class="m-0 mt-0.5 text-md text-zinc-600">{{ subtitle() }}</p>
      </div>
      <button
        type="button"
        class="grid size-11 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
        aria-label="關閉"
        (click)="closed.emit()"
      >
        <i class="pi pi-times" aria-hidden="true"></i>
      </button>
    </div>

    <div class="grid min-h-0 gap-5 overflow-y-auto overscroll-contain px-6 py-2 max-wide:px-4">
      @switch (state()) {
        @case ('loading') {
          <p class="m-0 text-md text-zinc-600" aria-live="polite">載入中…</p>
        }
        @case ('forbidden') {
          <p class="m-0 text-md text-zinc-700">讀不到這位學生。他可能已經不在你任課的班了。</p>
        }
        @case ('error') {
          <p class="m-0 text-md text-error-700">查詢失敗，請稍後再試。</p>
        }
        @default {
          @if (data(); as d) {
            <section>
              <h3 class="m-0 mb-2 text-md font-bold text-zinc-800">家長</h3>
              @if (d.parent; as p) {
                <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span>{{ p.name }}{{ p.relation ? '（' + p.relation + '）' : '' }}</span>
                  @if (p.phone) {
                    <b class="text-xl tracking-[0.01em] tabular-nums select-all">{{ p.phone }}</b>
                    <button
                      type="button"
                      data-copy
                      class="inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-solid border-zinc-300 bg-white px-3 text-md font-semibold text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 wide:h-8"
                      (click)="copyPhone(p.name, p.phone)"
                    >
                      複製電話
                    </button>
                  } @else {
                    <span class="text-md text-zinc-600">沒有留電話</span>
                  }
                </div>
              } @else {
                <p class="m-0 text-md text-zinc-600">還沒有登記家長。</p>
              }
            </section>

            <section>
              <h3 class="m-0 mb-2 text-md font-bold text-zinc-800">
                這班最近 {{ d.days.length }} 堂
              </h3>
              @if (d.days.length > 0) {
                <ol class="m-0 grid list-none grid-cols-5 gap-2 p-0">
                  @for (x of d.days; track x.date) {
                    <li
                      data-day
                      class="rounded-md bg-white p-2 text-center shadow-[inset_0_0_0_1px_var(--zinc-200)]"
                    >
                      <small class="block text-xs text-zinc-600 tabular-nums">{{
                        md(x.date)
                      }}</small>
                      <span
                        class="text-base font-semibold"
                        [class.text-error-700]="x.state === 'absent'"
                        [class.text-zinc-600]="x.state === 'on_leave'"
                        >{{ dayLabel[x.state] }}</span
                      >
                    </li>
                  }
                </ol>
              } @else {
                <p class="m-0 text-md text-zinc-600">這班還沒有點過名。</p>
              }
            </section>

            <section>
              <h3 class="m-0 mb-2 text-md font-bold text-zinc-800">這班最近的考試</h3>
              @for (x of d.exams; track x.id) {
                <div
                  data-exam
                  class="flex justify-between gap-3 border-0 border-b border-solid border-zinc-200 py-2 text-md"
                >
                  <span
                    >{{ x.examName }}
                    <small class="text-zinc-600"
                      >{{ md(x.examDate)
                      }}{{ x.classAvg !== null ? ' · 班平均 ' + round(x.classAvg) : '' }}</small
                    ></span
                  >
                  <b class="text-lg tabular-nums" [class.text-error-700]="failing(x)">{{
                    scoreText(x)
                  }}</b>
                </div>
              } @empty {
                <p class="m-0 text-md text-zinc-600">這班還沒有考試成績。</p>
              }
            </section>
          }
        }
      }
    </div>

    <div
      class="flex flex-wrap items-center justify-end gap-2 px-6 pt-3 pb-6 max-wide:px-4 max-wide:pb-[calc(16px+env(safe-area-inset-bottom,0px))]"
    >
      <button
        type="button"
        class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-zinc-300 bg-white px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 wide:h-9"
        (click)="closed.emit()"
      >
        關閉
      </button>
      <a
        class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-accent-vivid bg-accent-vivid px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 no-underline hover:border-accent-vivid-2 hover:bg-accent-vivid-2 wide:h-9"
        [routerLink]="schedulePath"
      >
        到課表點名 <i class="pi pi-arrow-right text-sm" aria-hidden="true"></i>
      </a>
    </div>
  `,
})
export class StudentPanelComponent implements OnInit {
  readonly student = input.required<Student>();
  readonly classId = input.required<string>();
  readonly className = input.required<string>();
  readonly closed = output<void>();

  private readonly studentsService = inject(StudentsService);
  private readonly scoresService = inject(ScoresService);
  private readonly messages = inject(MessageService);
  private readonly clock = inject(SystemClockService);

  protected readonly schedulePath = RoutesCatalog.TEACHER_SCHEDULE.absolutePath;
  protected readonly dayLabel = DAY_LABEL;
  protected readonly state = signal<'loading' | 'forbidden' | 'error' | 'ready'>('loading');
  protected readonly data = signal<PanelData | null>(null);

  protected subtitle(): string {
    const s = this.student();
    return [GRADE_LEVEL_LABELS[s.grade] ?? s.grade, s.school?.name, this.className()]
      .filter(Boolean)
      .join(' · ');
  }

  ngOnInit(): void {
    const id = this.student().id;
    const today = this.clock.todayTaipei();
    forkJoin({
      detail: this.studentsService.get(id),
      days: this.studentsService.attendanceDays(id, addDaysToDateString(today, -DAYS_BACK), today),
      scores: this.scoresService.list({
        studentId: id,
        classId: this.classId(),
        type: 'academy',
        pageSize: 3,
      }),
    }).subscribe({
      next: ({ detail, days, scores }) => {
        const parents = detail.data.parents;
        this.data.set({
          parent: parents.find((p) => p.isPrimary) ?? parents[0] ?? null,
          days: this.classDays(days),
          exams: scores.data,
        });
        this.state.set('ready');
      },
      error: (err: unknown) =>
        this.state.set(
          err instanceof HttpErrorResponse && err.status === 403 ? 'forbidden' : 'error',
        ),
    });
  }

  /**
   * 這班點過名的最近 5 天。到班格一天一格（同一天他在老師的兩個班都有課時合併成一種狀態，
   * 設計頁「到班格的已知近似」）；依 `sessions[].className` 挑出這班的那幾天
   */
  private classDays(res: StudentAttendanceDays): PanelData['days'] {
    return res.days
      .filter(
        (d): d is typeof d & { state: TakenState } =>
          d.state in DAY_LABEL && d.sessions.some((s) => s.className === this.className()),
      )
      .slice(-5)
      .map((d) => ({ date: d.date, state: d.state }));
  }

  protected copyPhone(name: string, phone: string): void {
    navigator.clipboard?.writeText(phone).then(
      () => this.messages.add({ severity: 'success', summary: `已複製 ${name} 的電話 ${phone}` }),
      () => this.messages.add({ severity: 'error', summary: '複製失敗，請手動抄下電話' }),
    );
  }

  protected md(date: string): string {
    const [, m, d] = date.split('-');
    return `${Number(m)}/${Number(d)}`;
  }

  protected round(n: number): number {
    return Math.round(n);
  }

  protected failing(x: ScoreRecord): boolean {
    return x.status === 'scored' && isFailingScore(x.score, { totalScore: x.totalScore });
  }

  protected scoreText(x: ScoreRecord): string {
    if (x.status === 'absent') return '缺考';
    if (x.score === null) return '—';
    return this.failing(x) ? `${x.score} 不及格` : `${x.score}`;
  }
}
