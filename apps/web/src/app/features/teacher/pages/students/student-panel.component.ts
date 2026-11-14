import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
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
import { DialogFrameComponent } from '@shared/components/dialog-frame/dialog-frame.component';
import { OrgSettingsService } from '@core/org-settings.service';

/** 往回找幾天的到班格：一週一堂的班也湊得到 5 堂（API 上限 366 天） */
const DAYS_BACK = 90;
/** 往後找幾天的下一堂（#2500）：今天沒這班的課時，主按鈕指到下一堂 */
const DAYS_AHEAD = 14;

const DAY_LABEL = { came: '到', absent: '沒到', on_leave: '請假' } as const;
type TakenState = keyof typeof DAY_LABEL;
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

interface PanelData {
  readonly parent: StudentDetailParent | null;
  readonly days: ReadonlyArray<{ date: string; state: TakenState; dailyCheckin: boolean }>;
  readonly exams: ScoreRecord[];
  /** 主按鈕：今天有這班的課 → 'today'；沒有 → 兩週內這班的下一堂；都沒有 → null（不放鈕） */
  readonly goto: 'today' | { readonly date: string } | null;
}

/**
 * 老師的學生面板（TST1，A6 `t-students.html` 的 `panel()`）：家長聯絡、這班最近 5 堂、這班最近的考試。
 * 三份資料都走既有的老師範圍端點，面板只是讀者（`kb/wiki/architecture/teacher-students-view.md`「學生面板」）。
 * 外框（原生 `<dialog>`）在頁面上；這裡是標題以下的內容，每次打開都是新的一份。
 */
@Component({
  selector: 'app-student-panel',
  imports: [DialogFrameComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-frame [title]="student().name" (closed)="closed.emit()">
      <!-- #2396 B：年級 · 學校 · 班 -->
      @if (subtitle(); as context) {
        <p class="m-0 text-sm text-zinc-600" data-part="dialog-context">{{ context }}</p>
      }
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
                      [attr.title]="
                        x.state === 'absent' && x.dailyCheckin
                          ? '尚無到班紀錄（日到班當天沒刷卡，不一定是缺席）'
                          : null
                      "
                      class="rounded-md bg-white p-2 text-center shadow-[inset_0_0_0_1px_var(--zinc-200)]"
                    >
                      <small class="block text-xs text-zinc-600 tabular-nums">{{
                        md(x.date)
                      }}</small>
                      <!-- #2500：日到班沒刷卡不是點過名的缺席 —— 灰字「無紀錄」（格子窄，全文放 title），跟到班名單同一套 -->
                      @if (x.state === 'absent' && x.dailyCheckin) {
                        <span class="text-base font-semibold text-zinc-600">無紀錄</span>
                      } @else {
                        <span
                          class="text-base font-semibold"
                          [class.text-error-700]="x.state === 'absent'"
                          [class.text-zinc-600]="x.state === 'on_leave'"
                          >{{ dayLabel[x.state] }}</span
                        >
                      }
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
      <ng-container dialogFoot>
        <button
          type="button"
          class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-zinc-300 bg-white px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 wide:h-9"
          (click)="closed.emit()"
        >
          關閉
        </button>
        <!-- #2500：今天沒這班的課時「看到班名單」只會落在空的今天 —— 改指下一堂那天；兩週內都沒有就不放 -->
        @if (data()?.goto; as goto) {
          <a
            class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-accent-vivid bg-accent-vivid px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 no-underline hover:border-accent-vivid-2 hover:bg-accent-vivid-2 wide:h-9"
            [routerLink]="schedulePath"
            [queryParams]="goto === 'today' ? null : { date: goto.date }"
          >
            @if (goto === 'today') {
              {{ teacherLed() ? '到課表點名' : '看到班名單' }}
            } @else {
              下一堂 {{ md(goto.date) }}（{{ weekday(goto.date) }}）
            }
            <i class="pi pi-arrow-right text-sm" aria-hidden="true"></i>
          </a>
        }
      </ng-container>
    </app-dialog-frame>
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
  private readonly orgSettings = inject(OrgSettingsService);

  /**
   * 行政負責點名的機構，課表上沒有點名鈕（只有唯讀名單）—— 寫「到課表點名」是死路（#2317）。
   * 讀不到設定時照課表頁的預設（`?? 'admin'`，保守、不叫老師去點他點不到的名）
   */
  protected readonly teacherLed = computed(
    () => (this.orgSettings.settings()?.attendanceResponsible ?? 'admin') === 'teacher',
  );

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
    if (this.orgSettings.status() === 'unloaded') this.orgSettings.load();
    const id = this.student().id;
    const today = this.clock.todayTaipei();
    forkJoin({
      detail: this.studentsService.get(id),
      days: this.studentsService.attendanceDays(
        id,
        addDaysToDateString(today, -DAYS_BACK),
        addDaysToDateString(today, DAYS_AHEAD),
      ),
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
          goto: this.gotoOf(days, today),
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
      .map((d) => ({ date: d.date, state: d.state, dailyCheckin: d.dailyCheckin }));
  }

  /** 這班今天有沒有上課（停課不算）；沒有就找兩週內這班的下一堂 */
  private gotoOf(res: StudentAttendanceDays, today: string): PanelData['goto'] {
    // 看這班那一堂自己的狀態，不看整天（同一天另一班照上、這班停課時整天不是 cancelled）
    const mine = res.days.filter((d) =>
      d.sessions.some((s) => s.className === this.className() && s.status !== 'cancelled'),
    );
    if (mine.some((d) => d.date === today)) return 'today';
    const next = mine.find((d) => d.date > today);
    return next ? { date: next.date } : null;
  }

  protected weekday(date: string): string {
    return WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
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
