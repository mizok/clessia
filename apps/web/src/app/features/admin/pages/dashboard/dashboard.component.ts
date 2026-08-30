import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { endOfMonth, format, startOfMonth, subDays } from 'date-fns';
import { TagModule } from 'primeng/tag';
import { catchError, forkJoin, of, type Observable } from 'rxjs';

import { AcademyExamsService } from '@core/academy-exams.service';
import { AttendanceService, type EventSessionSummary } from '@core/attendance.service';
import { DayTimelineComponent } from '@shared/components/day-timeline/day-timeline.component';
import { AuthService } from '@core/auth.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { LeaveService, type LeaveRequest } from '@core/leave.service';
import { OrgSettingsService, type AttendanceMode } from '@core/org-settings.service';
import { SchoolExamsService } from '@core/school-exams.service';
import { StudentsService } from '@core/students.service';
import { RoutesCatalog, type RouteObj } from '@core/smart-enums/routes-catalog';

import { countUntakenSessions } from './dashboard.util';

/** `null` 是還在載入，`'error'` 是這張卡自己的查詢掛了 */
type CardValue = number | 'error' | null;

interface StatCard {
  readonly label: string;
  readonly value: CardValue;
  readonly sub?: string;
  readonly icon: string;
  readonly routerLink: string;
  readonly accent?: boolean;
  /**
   * 這張卡是「今天要動作的事」還是「背景脈絡」。
   *
   * 舊版六張卡等權排成一列，所以「未點名 6」跟「在籍學生 27」長得一樣大 ——
   * 但一個要動作、一個只是背景。分類讓構圖能把它們放到不同的地方：
   * `todo` 進待處理區、其餘退到右側安靜的現況欄。
   */
  readonly kind: 'todo' | 'fact';
}

const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'] as const;

const FAILED = 'error' as const;

/** 一張卡的查詢掛掉不該讓整頁空白，所以每支查詢各自把錯誤吞成 `'error'` */
function failSoft<T>(source: Observable<T>): Observable<T | typeof FAILED> {
  return source.pipe(catchError(() => of(FAILED)));
}

function countOf(items: readonly unknown[] | 'error' | null): CardValue {
  return items === null || items === FAILED ? items : items.length;
}

/** 回溯窗：昨天忘記點的今天要追得到，更久以前的漏點名是報表該查的異常 */
const UNTAKEN_LOOKBACK_DAYS = 7;

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, TagModule, DayTimelineComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  readonly page = input.required<RouteObj>();

  private readonly attendanceService = inject(AttendanceService);
  private readonly leaveService = inject(LeaveService);
  private readonly academyExamsService = inject(AcademyExamsService);
  private readonly schoolExamsService = inject(SchoolExamsService);
  private readonly studentsService = inject(StudentsService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly orgSettingsService = inject(OrgSettingsService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly now = new Date();
  private readonly todayIso = format(this.now, 'yyyy-MM-dd');

  protected readonly today = this.now;
  /** 時間軸要的是本地日期字串。用 date-fns 的 format 而不是 toISOString ——
      補習班的「今天」是本地的今天，UTC+8 的凌晨會差一天（既有 spec 踩過）。 */
  protected readonly todayKey = format(this.now, 'yyyy-MM-dd');

  /**
   * 橘帶上的日期。**在這裡算而不是用 DatePipe 帶 locale** ——
   * `registerLocaleData(localeZhTW)` 是在 `app.config.ts` 跑的，TestBed 不載它，
   * 所以 `date: … : 'zh-TW'` 在測試環境會炸「Missing locale data」。
   * 星期用自己的陣列，不依賴任何 locale 註冊。
   */
  protected readonly todayLabel =
    `${format(this.now, 'yyyy 年 M 月 d 日')} · ${WEEKDAYS[this.now.getDay()]}`;

  private readonly todaySessions = signal<EventSessionSummary[] | 'error' | null>(null);
  private readonly recentSessions = signal<EventSessionSummary[] | 'error' | null>(null);
  private readonly todayLeaves = signal<LeaveRequest[] | 'error' | null>(null);
  private readonly gradesTodo = signal<CardValue>(null);
  private readonly activeStudents = signal<CardValue>(null);
  private readonly enrollmentChanges = signal<CardValue>(null);
  /** `null` 代表讀不到機構設定 */
  private readonly attendanceMode = signal<AttendanceMode | null>(null);

  protected readonly todaySessionList = computed(() => {
    const sessions = this.todaySessions();
    if (sessions === null || sessions === FAILED) return [];

    return [...sessions].sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
  });

  protected readonly todayLeaveList = computed(() => {
    const leaves = this.todayLeaves();
    return leaves === null || leaves === FAILED ? [] : leaves;
  });

  protected readonly sessionsFailed = computed(() => this.todaySessions() === FAILED);
  protected readonly leavesFailed = computed(() => this.todayLeaves() === FAILED);

  /**
   * `'hidden'` 是整張卡不該存在：`daily-checkins` 建立 attendance_records 但從不蓋
   * `events.attendance_taken_at`，日到班模式下每一堂都會被算成漏點名。讀不到機構設定時
   * 同樣不顯示 —— 無從判斷這個數字有沒有意義，寧可少一張卡也不要給一個可能全錯的數。
   */
  private readonly untaken = computed<CardValue | 'hidden'>(() => {
    const mode = this.attendanceMode();
    if (mode !== 'per_session') return 'hidden';

    const sessions = this.recentSessions();
    if (sessions === null || sessions === FAILED) return sessions;

    return countUntakenSessions(sessions, mode, this.now) ?? 'hidden';
  });

  protected readonly cards = computed<StatCard[]>(() => {
    const cards: StatCard[] = [
      {
        kind: 'fact',
        label: '今日課堂',
        value: countOf(this.todaySessions()),
        icon: 'pi-calendar',
        routerLink: RoutesCatalog.ADMIN_SESSIONS.absolutePath,
      },
    ];

    const untaken = this.untaken();
    if (untaken !== 'hidden') {
      cards.push({
        kind: 'todo',
        label: '未點名課堂',
        value: untaken,
        sub: `近 ${UNTAKEN_LOOKBACK_DAYS} 天`,
        icon: 'pi-exclamation-triangle',
        routerLink: RoutesCatalog.ADMIN_ATTENDANCE.absolutePath,
        accent: true,
      });
    }

    cards.push(
      {
        kind: 'fact',
        label: '今日請假',
        value: countOf(this.todayLeaves()),
        icon: 'pi-file',
        routerLink: RoutesCatalog.ADMIN_LEAVE.absolutePath,
      },
      {
        kind: 'todo',
        label: '成績待登錄',
        value: this.gradesTodo(),
        sub: '校內考 + 段考',
        icon: 'pi-pencil',
        routerLink: RoutesCatalog.ADMIN_GRADES_EXAMS.absolutePath,
      },
    );

    if (this.auth.hasPermission('view_reports')) {
      cards.push(
        {
          kind: 'fact',
        label: '在籍學生',
          value: this.activeStudents(),
          icon: 'pi-users',
          routerLink: RoutesCatalog.ADMIN_STUDENTS.absolutePath,
        },
        {
          kind: 'fact',
        label: '本月報名異動',
          value: this.enrollmentChanges(),
          // meta.total 數的是「期間內有異動的報名記錄」，一筆當月插班又退班的報名在這裡是 1，
          // 在總覽頁的事件分類裡會是 joined + left 兩筆 —— 所以單位是「筆」，分項去那邊看
          sub: '筆 · 點擊查看進出分項',
          icon: 'pi-sign-in',
          routerLink: RoutesCatalog.ADMIN_ENROLLMENTS.absolutePath,
        },
      );
    }

    return cards;
  });

  /** 待處理：只有真的要動作的才進來 */
  protected readonly todoCards = computed(() => this.cards().filter((c) => c.kind === 'todo'));

  /** 現況：背景脈絡，放右側安靜的窄欄 */
  protected readonly factCards = computed(() => this.cards().filter((c) => c.kind === 'fact'));

  /**
   * 橘帶上那句話。**它算的是總數**，而時間軸只畫得出有時間的那部分 ——
   * 兩者不一致時由時間軸自己說出來（「另有 N 堂未排定時間」），不在這裡對齊。
   */
  protected readonly todayHeadline = computed(() => {
    const sessions = this.todaySessions();
    if (sessions === null || sessions === FAILED) return null;
    const untaken = sessions.filter((s) => s.takenAt === null).length;
    return { total: sessions.length, untaken };
  });

  constructor() {
    const lookbackFrom = format(subDays(this.now, UNTAKEN_LOOKBACK_DAYS), 'yyyy-MM-dd');

    forkJoin({
      // `date` 會蓋掉 dateFrom/dateTo，所以今日與回溯窗本來就是兩個請求 ——
      // 也剛好讓兩張卡各自失敗，不會一起死
      todaySessions: failSoft(
        this.attendanceService.sessions({ date: this.todayIso, pageSize: 100 }),
      ),
      recentSessions: failSoft(
        this.attendanceService.sessions({
          dateFrom: lookbackFrom,
          dateTo: this.todayIso,
          pageSize: 100,
        }),
      ),
      leaves: failSoft(this.leaveService.list({ coverDate: this.todayIso, pageSize: 100 })),
      grades: failSoft(
        forkJoin([
          this.academyExamsService.getTodoCount(),
          this.schoolExamsService.getTodoCount(),
        ]),
      ),
      students: failSoft(this.studentsService.list({ pageSize: 1 })),
      // 只要 meta.total：pageSize 上限是 100，抓明細自己分類會在異動破百的月份
      // 悄悄少算，而且錯得沒有徵兆
      enrollments: failSoft(
        this.enrollmentsService.list({
          from: format(startOfMonth(this.now), 'yyyy-MM-dd'),
          to: format(endOfMonth(this.now), 'yyyy-MM-dd'),
          pageSize: 1,
        }),
      ),
      org: failSoft(this.orgSettingsService.getSettings()),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        this.todaySessions.set(res.todaySessions === FAILED ? FAILED : res.todaySessions.data);
        this.recentSessions.set(res.recentSessions === FAILED ? FAILED : res.recentSessions.data);
        this.todayLeaves.set(res.leaves === FAILED ? FAILED : res.leaves.data);
        this.gradesTodo.set(
          res.grades === FAILED ? FAILED : res.grades[0].count + res.grades[1].count,
        );
        this.activeStudents.set(
          res.students === FAILED ? FAILED : res.students.summary.activeCount,
        );
        this.enrollmentChanges.set(res.enrollments === FAILED ? FAILED : res.enrollments.meta.total);
        this.attendanceMode.set(res.org === FAILED ? null : res.org.attendanceMode);
      });
  }
}
