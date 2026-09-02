import { DatePipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { SkeletonModule } from 'primeng/skeleton';
import { type Session } from '@core/sessions.service';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
import { hasSessionStarted, todayLocal } from '@shared/utils/session-time.util';
import { attendanceTone } from '@shared/utils/attendance-tone.util';
import {
  StatusDotComponent,
  type StatusTone,
} from '@shared/components/status/status-dot/status-dot.component';

export interface SessionListMenuRequest {
  readonly event: MouseEvent;
  readonly session: Session;
}

@Component({
  selector: 'app-session-list',
  imports: [
    StatusDotComponent,
    DatePipe,
    FormsModule,
    ButtonModule,
    CheckboxModule,
    SkeletonModule,
    ResponsiveTableComponent,
    RtColCellDirective,
    RtColDefDirective,
    RtRowDirective,
  ],
  templateUrl: './session-list.component.html',
  styleUrl: './session-list.component.scss',
})
export class SessionListComponent {
  readonly sessions = input<readonly Session[]>([]);
  readonly loading = input(false);
  readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
  readonly total = input(0);
  readonly pageSize = input(50);
  readonly currentPage = input(1);

  readonly selectedIdsChange = output<string[]>();
  readonly contextMenuRequested = output<SessionListMenuRequest>();
  readonly pageChange = output<number>();

  protected readonly sessionCountLabel = computed(() => {
    const visibleCount = this.sessions().length;
    const total = this.total();
    if (visibleCount === 0 && total === 0) return '';
    const cancelled = this.sessions().filter((s) => s.status === 'cancelled').length;
    const unassigned = this.sessions().filter(
      (s) => s.assignmentStatus === 'unassigned' && s.status === 'scheduled',
    ).length;
    const parts = [
      total > visibleCount ? `本頁 ${visibleCount} 堂，共 ${total} 堂` : `共 ${visibleCount} 堂`,
    ];
    if (unassigned > 0) parts.push(`${unassigned} 堂未指派`);
    if (cancelled > 0) parts.push(`${cancelled} 堂已停課`);
    return parts.join('・');
  });

  protected readonly listPagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: Math.max((this.currentPage() - 1) * this.pageSize(), 0),
    rows: this.pageSize(),
    totalRecords: this.total(),
  }));

  protected readonly allPageSelected = computed(() => {
    const page = this.sessions();
    if (page.length === 0) return false;
    const ids = this.selectedIds();
    return page.every((session) => ids.has(session.id));
  });

  protected onListPage(event: ResponsiveTablePageEvent): void {
    this.pageChange.emit((event.page ?? 0) + 1);
  }

  protected toggleSelectAll(): void {
    const page = this.sessions();
    const updated = new Set(this.selectedIds());
    if (this.allPageSelected()) {
      page.forEach((session) => updated.delete(session.id));
    } else {
      page.forEach((session) => updated.add(session.id));
    }
    this.emitSelected(updated);
  }

  protected toggleSelect(sessionId: string): void {
    const updated = new Set(this.selectedIds());
    if (updated.has(sessionId)) {
      updated.delete(sessionId);
    } else {
      updated.add(sessionId);
    }
    this.emitSelected(updated);
  }

  protected openContextMenu(event: MouseEvent, session: Session): void {
    this.contextMenuRequested.emit({ event, session });
  }

  protected getDayLabel(date: string): string {
    const labels = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    return labels[new Date(date).getDay()];
  }

  protected sessionStatusLabel(session: Session): string {
    if (session.status === 'cancelled') return '已停課';
    if (session.status === 'completed') return '已完成';
    return '正常';
  }

  /** 停課 = 不在等了；已完成 = 已定案；其餘（正常）= 還在等 */
  protected sessionStatusTone(session: Session): StatusTone {
    if (session.status === 'cancelled') return 'inactive';
    if (session.status === 'completed') return 'done';
    return 'pending';
  }

  /**
   * 未指派：課還沒開始只是還沒輪到（pending），**課都開始了還沒指派才是積欠**（overdue）。
   *
   * 原本無條件 warn —— 於是一個下週才上、還沒排老師的課，今天看起來就像出事了。
   * 那是 #103 學到的同一件事：只看值不看時間，警示就會失去意義。
   */
  protected unassignedTone(session: Session, now: Date = new Date()): StatusTone {
    return hasSessionStarted(toSessionTime(session), now) ? 'overdue' : 'pending';
  }

  /** `todayLocal` 而不是 `toISOString()` —— 後者是 UTC 日期，半夜會把今天的課判成未來 */
  private isFutureSession(session: Session): boolean {
    return session.sessionDate > todayLocal();
  }

  protected attendanceStatusLabel(session: Session): string {
    if (session.status === 'cancelled') return '不適用';
    if (this.isFutureSession(session)) return '未開放點名';
    if (session.attendanceTakenAt) return '已點名';

    const enrolledCount = session.attendanceEnrolledCount;
    return typeof enrolledCount === 'number' && enrolledCount > 0
      ? `未點名 ${enrolledCount} 人`
      : '未點名';
  }

  /**
   * 點名狀態的顏色。**只有「上完了卻沒點名」是警示**。
   *
   * 舊版有兩個問題，都讓漏點名變得看不見：
   *
   * 1. `status === 'completed'` 那條是**死碼** —— 全 repo 沒有任何一行把 `status`
   *    寫成 `'completed'`（`core/classes.service.ts` 還留著「待老師點名功能完成後」
   *    的 TODO）。所有漏點名的課都掉到最後的 `info`，而藍色不是警示：它跟
   *    「今天稍晚要上的課」長得一樣，掃表格時該跳出來的沒有跳出來。
   * 2. `isFutureSession` 只比日期不比時間，所以**今天晚上七點的課，早上八點就被
   *    歸進「該點名而沒點」**。
   *
   * 現在用跟儀表板同一個 `hasSessionEnded` —— 兩個畫面對「漏點名」的定義必須一致，
   * 否則儀表板說 6 堂、這裡標 8 堂。
   *
   * 文字（`attendanceStatusLabel`）維持說事實「未點名 N 人」，顏色說判斷：
   * 還沒上完是中性，上完了沒點才是警示。
   *
   * `now` 可注入**只為了測試** —— 模板呼叫時用預設值。沒有它的話這條判斷就綁在
   * 牆鐘上，測試得自己算「今天」，而那正是 UTC 日期坑的入口。
   */
  protected attendanceStatusTone(session: Session, now: Date = new Date()): StatusTone {
    return attendanceTone(
      {
        time: toSessionTime(session),
        cancelled: session.status === 'cancelled',
        taken: session.attendanceTakenAt !== null && session.attendanceTakenAt !== undefined,
      },
      now,
    );
  }

  protected attendanceStatusSummary(session: Session): string {
    if (session.status === 'cancelled') return '';
    if (this.isFutureSession(session)) return '';
    const presentCount = session.attendancePresentCount ?? 0;
    const onLeaveCount = session.attendanceOnLeaveCount ?? 0;
    const absentCount = session.attendanceAbsentCount ?? 0;
    const hasRecordedStatuses = presentCount > 0 || onLeaveCount > 0 || absentCount > 0;

    if (session.attendanceTakenAt || hasRecordedStatuses) {
      return `到 ${presentCount} ・ 請 ${onLeaveCount} ・ 缺 ${absentCount}`;
    }

    const enrolledCount = session.attendanceEnrolledCount;
    return typeof enrolledCount === 'number' && enrolledCount > 0
      ? `${enrolledCount} 人待點名`
      : '';
  }

  private emitSelected(selected: ReadonlySet<string>): void {
    this.selectedIdsChange.emit([...selected]);
  }
}

/** `Session` 用 `sessionDate`，共用的 `hasSessionEnded` 吃的是 `date` */
function toSessionTime(session: Session) {
  return {
    date: session.sessionDate,
    startTime: session.startTime ?? null,
    endTime: session.endTime ?? null,
  };
}
