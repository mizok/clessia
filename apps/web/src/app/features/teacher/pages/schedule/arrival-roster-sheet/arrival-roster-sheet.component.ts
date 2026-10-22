import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { AttendanceService, type RosterStudent } from '@core/attendance.service';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

/** 開到班名單需要的資料 —— 課堂卡上都有 */
export interface ArrivalRosterInput {
  readonly eventId: string;
  readonly className: string;
  readonly campusName: string | null;
  readonly eventDate: string;
  readonly startTime: string | null;
  /** 今天的課才能記「他到了」（依據是「人就在我面前」，後端也只收當天） */
  readonly isToday: boolean;
  /** 行政負責點名：只看名單，不給「他到了」（後端同樣 403） */
  readonly readOnly: boolean;
}

/**
 * 日到班的「到班名單」（#1314 TS3，A6 `t-schedule.html` 的 roster daily 分支）。
 *
 * **不是點名面板的一個模式** —— 兩型是兩條資料：這裡讀到班打卡（`checkedInAt`），點名面板寫
 * 逐堂紀錄。日到班沒有逐堂點名，掃碼就算當天的課都到了；老師能做的只有替沒掃碼的人記到班。
 */
@Component({
  selector: 'app-arrival-roster-sheet',
  imports: [SkeletonComponent, ButtonModule, DatePipe],
  templateUrl: './arrival-roster-sheet.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArrivalRosterSheetComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly attendance = inject(AttendanceService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly input = this.config.data as ArrivalRosterInput;

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly students = signal<RosterStudent[]>([]);
  /** 這次在名單上被老師記到班的人 —— 小字要說「老師標記」，不能說成掃碼 */
  protected readonly markedByMe = signal<ReadonlySet<string>>(new Set());
  protected readonly marking = signal<string | null>(null);
  protected readonly markError = signal<string | null>(null);

  protected readonly summary = computed(() => {
    const list = this.students();
    return {
      arrived: list.filter((s) => s.checkedInAt).length,
      total: list.length,
      onLeave: list.filter((s) => !s.checkedInAt && this.onLeave(s)).length,
    };
  });

  constructor() {
    this.attendance
      .roster(this.input.eventId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.students.set(res.students);
          this.loading.set(false);
        },
        error: () => {
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  /** 有假（紀錄上寫了請假，或有假單蓋到這堂）—— 跟點名面板同兩個來源 */
  protected onLeave(s: RosterStudent): boolean {
    return s.status === 'on_leave' || s.hasLeaveRequest;
  }

  protected canMark(s: RosterStudent): boolean {
    return this.input.isToday && !this.input.readOnly && !s.checkedInAt && !this.onLeave(s);
  }

  protected markArrived(s: RosterStudent): void {
    if (this.marking()) return;
    this.marking.set(s.studentId);
    this.markError.set(null);
    this.attendance
      .checkIn(this.input.eventId, s.studentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.marking.set(null);
          // 剛好在這之前掃了卡：照實顯示那一筆，不說成老師標記
          if (!res.alreadyCheckedIn) {
            this.markedByMe.update((set) => new Set([...set, s.studentId]));
          }
          this.students.update((list) =>
            list.map((row) =>
              row.studentId === s.studentId ? { ...row, checkedInAt: res.checkedInAt } : row,
            ),
          );
        },
        error: (err: { error?: { code?: string; error?: string } }) => {
          this.marking.set(null);
          // 已在別校掃過卡（409）：再按一次也一樣，照實說；其他失敗才請他重按
          this.markError.set(
            err?.error?.code === 'CHECKED_IN_ELSEWHERE'
              ? `${s.studentName}：${err.error.error ?? '今天已在別校掃過卡'}，這裡記不了到班。`
              : `沒記到 ${s.studentName} 的到班，請再按一次。`,
          );
        },
      });
  }

  protected close(): void {
    this.ref.close(this.markedByMe().size > 0);
  }
}
