import {
  Component,
  ElementRef,
  OnInit,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  format,
  isToday,
  parseISO,
  differenceInDays,
} from 'date-fns';
import { ButtonModule } from 'primeng/button';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { AttendanceService, type EventSessionSummary } from '@core/attendance.service';
import { ContactBookService } from '@core/contact-book.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { PageBandComponent } from '@shared/components/page-band/page-band.component';
import { BandAnchorComponent } from '@shared/components/page-band/band-anchor/band-anchor.component';
import { StatusDotComponent } from '@shared/components/status/status-dot/status-dot.component';
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';
import {
  AttendanceRosterPanelComponent,
  type RosterPanelSession,
} from '@shared/components/attendance-roster-panel/attendance-roster-panel.component';

import { ClassLogSheetComponent } from './class-log-sheet/class-log-sheet.component';
import { ContactBookRosterComponent } from './contact-book-roster/contact-book-roster.component';
import {
  attendanceDisplay,
  canTakeAttendance,
  canWriteClassLog,
  canWriteContactBook,
  daySummary,
  weekAnchor,
} from './schedule.util';

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 老師的課表。**手機是主要形態**，桌機是撐寬的次要情境 ——
 * 設計與取捨見 `kb/wiki/architecture/teacher-schedule-mobile-day.md`。
 *
 * 換日是原生的水平 scroll-snap，**這裡沒有任何手勢或捲動監聽程式碼**。
 * 唯一碰 scroll 的是進頁時把軌道對到今天那一屏（一次性，不是監聽器）。
 */
@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [
    DatePipe,
    ButtonModule,
    DynamicDialogModule,
    PageBandComponent,
    BandAnchorComponent,
    StatusDotComponent,
    DataChipComponent,
  ],
  providers: [DialogService],
  templateUrl: './schedule.page.html',
  styleUrl: './schedule.page.scss',
})
export class SchedulePage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly attendanceService = inject(AttendanceService);
  private readonly orgSettingsService = inject(OrgSettingsService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly contactBookService = inject(ContactBookService);

  private readonly track = viewChild<ElementRef<HTMLElement>>('track');

  protected readonly currentWeekStart = signal<Date>(startOfWeek(new Date(), { weekStartsOn: 1 }));
  protected readonly sessions = signal<EventSessionSummary[]>([]);
  protected readonly loading = signal(false);

  /**
   * 「現在」只在建構時取一次。頁面開著跨過某堂課的結束時間，標記不會自己翻成漏點名 ——
   * 跟 day-timeline 一樣的知情取捨：為了一個標記掛計時器，代價高於它的價值。
   * 換週會重新取數，那時標記就會更新。
   */
  private readonly now = new Date();
  private readonly todayStr = format(this.now, 'yyyy-MM-dd');

  protected readonly weekLabel = computed(() => {
    const start = this.currentWeekStart();
    const end = endOfWeek(start, { weekStartsOn: 1 });
    return `${format(start, 'yyyy年M月d日')} – ${format(end, 'M月d日')}`;
  });

  protected readonly weekDays = computed(() => {
    const start = this.currentWeekStart();
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      return {
        date,
        label: `週${WEEKDAY_LABELS[date.getDay()]}`,
        dateStr: format(date, 'yyyy-MM-dd'),
      };
    });
  });

  protected readonly sessionsByDay = computed(() => {
    const map = new Map<string, EventSessionSummary[]>();
    for (const day of this.weekDays()) map.set(day.dateStr, []);
    for (const s of this.sessions()) {
      const list = map.get(s.eventDate);
      if (list) list.push(s);
    }
    return map;
  });

  /**
   * 每天有幾個學生的聯絡簿還沒寫。
   *
   * **空 Map 在畫面上跟「大家都寫完了」長得一模一樣** —— 兩者都不出徽章。
   * 這支 signal 自己分不出「查不到」與「沒有待辦」，所以失敗另外用
   * `missingFailed` 記，並在畫面上講一句話。**沒有那句話的話，
   * 一次查詢失敗會被讀成一則好消息。**
   */
  protected readonly missingByDate = signal<ReadonlyMap<string, number>>(new Map());

  /** 聯絡簿待辦彙總查失敗了 —— 課表照常顯示，但要講出來（見上方註解） */
  protected readonly missingFailed = signal(false);

  /**
   * 課表本身查失敗了。
   *
   * **失敗時要把 `sessions` 清空**：換週查失敗如果留著上一週的資料，
   * 日期標題已經換過去了而課還是舊的 —— 老師看到的每一堂都是真實資料、
   * 可點、可點名，**比空畫面危險**。
   */
  protected readonly loadError = signal(false);

  /**
   * 點名設定讀不到 —— **不改 `isTeacherLed()` 的預設值**（那個方向是對的），
   * 只是把「我不知道」講出來。不講的話畫面會用中性的「未點名」蓋掉所有逾期警示，
   * 而那跟「這週都點完了」一模一樣。
   */
  protected readonly settingsFailed = computed(
    () => this.orgSettingsService.status() === 'failed',
  );

  /** 橘帶的錨點：整週的數字，不是當日的（面板不追捲動位置，理由見設計文件） */
  protected readonly anchor = computed(() => weekAnchor(this.sessions(), this.now));

  /**
   * 桌機週條的七格。手機不顯示它 —— 手機換日靠滑，多一條導航是重複的。
   *
   * 它讀的是**已經載入的那一週**，沒有額外請求：課表本來就一次抓七天。
   */
  protected readonly weekBar = computed(() => {
    const byDay = this.sessionsByDay();
    const teacherLed = this.isTeacherLed();
    return this.weekDays().map((day, index) => ({
      ...day,
      index,
      isToday: day.dateStr === this.todayStr,
      ...daySummary(byDay.get(day.dateStr) ?? [], this.now, teacherLed),
    }));
  });

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  constructor() {
    // 進頁停在今天那一屏。一次性，之後不再過問捲動位置。
    afterNextRender(() => this.snapToToday());
  }

  ngOnInit(): void {
    // `load()` 而不是自己 subscribe —— 原本這裡只有 next 分支，失敗時沒有人接，
    // 而 `isTeacherLed()` 的 `?? 'admin'` 會把它讀成一個真的答案
    this.orgSettingsService.load();
    this.loadSessions();
  }

  protected prevWeek(): void {
    this.currentWeekStart.update((d) => subWeeks(d, 1));
    this.loadSessions();
    this.snapToToday();
  }

  protected nextWeek(): void {
    this.currentWeekStart.update((d) => addWeeks(d, 1));
    this.loadSessions();
    this.snapToToday();
  }

  /**
   * 把軌道對到今天那一屏；這一週沒有今天就回到週一。
   *
   * 換週時可以同步呼叫 —— 七個面板的幾何在換週時不變（只有面板裡的卡片會換），
   * 所以現有的 `offsetLeft` 已經是對的，不必等下一次 render。
   * 桌機是 grid、沒有水平捲動，這裡設 `scrollLeft` 是無害的 no-op。
   */
  private snapToToday(): void {
    this.snapToDay(this.weekDays().findIndex((d) => d.dateStr === this.todayStr));
  }

  /** 週條點某一天就捲到那一屏。桌機沒有水平捲動時是無害的 no-op */
  protected snapToDay(index: number): void {
    const el = this.track()?.nativeElement;
    if (!el) return;
    if (index <= 0) {
      el.scrollLeft = 0;
      return;
    }

    // 位置問面板自己，不要用 index × clientWidth 去算 —— 那漏掉欄間距，
    // 一天差一個 gap，週日會差到 6 個。scroll-snap 目前會把誤差吸回去，
    // 但那是運氣：間距一改就不成立了。
    const first = el.firstElementChild as HTMLElement | null;
    const target = el.children[index] as HTMLElement | undefined;
    if (!first || !target) return;
    // scrollLeft 而不是 scrollTo()：不需要 smooth，而且 jsdom 沒有實作 scrollTo
    el.scrollLeft = target.offsetLeft - first.offsetLeft;
  }

  protected loadSessions(): void {
    this.loading.set(true);
    // 每次重查都先清掉上一輪的失敗旗標 —— 留著的話重試成功了畫面還在喊失敗
    this.loadError.set(false);
    this.missingFailed.set(false);
    const start = this.currentWeekStart();
    const end = endOfWeek(start, { weekStartsOn: 1 });
    // 不必傳 teacherId：後端看角色強制套用老師自己的 id（attendance/teacher-scope.ts）。
    // 由前端傳的話，直接打 API 的人就能指定別人 —— 前端隱藏不構成授權（c1）。
    const dateFrom = format(start, 'yyyy-MM-dd');
    const dateTo = format(end, 'yyyy-MM-dd');

    // 聯絡簿待辦是獨立的一支，失敗不該讓課表整個空掉 —— 所以各自訂閱，不 forkJoin
    this.contactBookService.missingSummary(dateFrom, dateTo).subscribe({
      next: (res) => this.missingByDate.set(new Map(res.data.map((d) => [d.date, d.missingCount]))),
      error: () => {
        this.missingByDate.set(new Map());
        this.missingFailed.set(true);
      },
    });

    this.attendanceService
      .sessions({
        dateFrom,
        dateTo,
        // 預設不含 cancelled —— 要畫停課就得明式要它
        statuses: ['scheduled', 'completed', 'cancelled'],
      })
      .subscribe({
        next: (response) => {
          this.sessions.set(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.sessions.set([]);
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  protected isTeacherLed(): boolean {
    return (this.orgSettingsService.settings()?.attendanceResponsible ?? 'admin') === 'teacher';
  }

  protected isRetroactiveLocked(session: EventSessionSummary): boolean {
    if (!this.isTeacherLed()) return false;
    const days = this.orgSettingsService.settings()?.attendanceRetroactiveDays ?? 0;
    if (days === 0) return false;
    return differenceInDays(new Date(), parseISO(session.eventDate)) > days;
  }

  /**
   * 課還沒到那一天 —— 這才是「能不能點名」該問的問題。
   *
   * **刻意不是 `hasSessionEnded`。** 老師是在課堂開始時點名，不是等下課才點；
   * 用「上完了沒」當按鈕的門檻，晚上七點的課要到九點才點得了。
   * `hasSessionEnded` 回答的是另一個問題（該點而沒點嗎），它在 `attendanceTone` 裡。
   */
  protected isUpcoming(session: EventSessionSummary): boolean {
    return session.eventDate > this.todayStr;
  }

  /** 狀態點的 tone 與文案。行政負責點名時「漏點名」會降成中性的「未點名」 */
  protected display(session: EventSessionSummary) {
    return attendanceDisplay(session, this.now, this.isTeacherLed());
  }

  protected isToday(dateStr: string): boolean {
    return isToday(parseISO(dateStr));
  }

  protected canTakeAttendance(session: EventSessionSummary): boolean {
    return canTakeAttendance(session);
  }

  /** 這一天有幾個學生的聯絡簿還沒寫；0 或未知都不顯示徽章 */
  protected missingOn(dateStr: string): number {
    return this.missingByDate().get(dateStr) ?? 0;
  }

  protected openPanel(session: EventSessionSummary): void {
    // 停課沒有出勤事件 —— 模板已經藏掉入口，這裡是型別上的第二道
    if (session.eventId === null || !canTakeAttendance(session)) return;

    const data: RosterPanelSession = {
      eventId: session.eventId,
      className: session.className,
      eventDate: session.eventDate,
    };

    const ref = this.dialogService.open(AttendanceRosterPanelComponent, {
      width: '480px',
      modal: true,
      showHeader: false,
      closable: false,
      // 手機從下方升起（bottom sheet）而不是置中彈窗 —— 老師是站著單手用，
      // 置中的面板把主要動作推到螢幕中間、拇指構不到。桌機維持置中。
      // 只有老師端這樣開；admin 出勤頁用同一支元件但保持原本的置中對話框。
      styleClass: 'roster-sheet',
      appendTo: this.overlayContainer ?? 'body',
      data,
    });

    ref?.onClose.subscribe(
      (result?: {
        eventId: string;
        takenAt: string;
        presentCount: number;
        absentCount: number;
        onLeaveCount: number;
      }) => {
        if (result) {
          this.sessions.update((list) =>
            list.map((s) =>
              s.eventId === result.eventId
                ? {
                    ...s,
                    takenAt: result.takenAt,
                    presentCount: result.presentCount,
                    absentCount: result.absentCount,
                    onLeaveCount: result.onLeaveCount,
                  }
                : s,
            ),
          );
        }
      },
    );
  }

  /** 判準在 util（跟 `canTakeAttendance` 同一個家），這裡只是模板的入口 */
  protected readonly canWriteClassLog = canWriteClassLog;
  protected readonly canWriteContactBook = canWriteContactBook;

  /**
   * 開日誌面板。**判準不含 `eventId`** —— 日誌掛班×日期，不掛出勤事件，
   * 所以沒有出勤事件的課堂照樣可以寫（未來的課也可以：規則明說老師會先寫作業）。
   */
  protected openClassLog(session: EventSessionSummary): void {
    const ref = this.dialogService.open(ClassLogSheetComponent, {
      width: '480px',
      modal: true,
      showHeader: false,
      closable: false,
      // 跟點名面板同一個形狀：手機從下方升起，老師站著單手用
      styleClass: 'roster-sheet',
      appendTo: this.overlayContainer ?? 'body',
      data: {
        classId: session.classId,
        className: session.className,
        logDate: session.eventDate,
      },
    });

    ref?.onClose.subscribe((saved?: boolean) => {
      if (saved) this.loadSessions();
    });
  }

  /**
   * 開聯絡簿名單（「今天這堂課還有誰沒寫」）。
   *
   * 跟 `openClassLog` 是同一個位置的兩型 —— 兩型是兩條資料模型
   * （`studentId+entryDate` vs `classId+logDate`），**刻意不做成一支元件的 if/else**。
   */
  protected openContactBook(session: EventSessionSummary): void {
    const ref = this.dialogService.open(ContactBookRosterComponent, {
      width: '480px',
      modal: true,
      showHeader: false,
      closable: false,
      styleClass: 'roster-sheet',
      appendTo: this.overlayContainer ?? 'body',
      data: {
        classId: session.classId,
        className: session.className,
        entryDate: session.eventDate,
      },
    });

    ref?.onClose.subscribe((wrote?: boolean) => {
      if (wrote) this.loadSessions();
    });
  }
}
