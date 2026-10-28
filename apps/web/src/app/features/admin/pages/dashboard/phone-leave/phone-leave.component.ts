import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';

import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

import {
  ATTENDANCE_STATUS_LABELS,
  AttendanceService,
  type AttendanceRecord,
  type StudentDay,
} from '@core/attendance.service';
import { LeaveService } from '@core/leave.service';
import { StudentsService, type Student } from '@core/students.service';
import { SystemClockService } from '@core/system-clock.service';
import { StudentAutocompleteComponent } from '@shared/components/student-autocomplete/student-autocomplete.component';
import { HeightFollowDirective } from '@shared/directives/height-follow.directive';

/** 結果卡要求儀表板開點名名單時帶的資料 —— 跟 `openAttendance` 開對話框要的同一組 */
export interface PhoneLeaveRosterRequest {
  eventId: string;
  className: string | null;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
}

const REASON_CHIPS = ['病假', '事假'] as const;

/**
 * 「接到電話 → 不換頁請假」（#964，UI 實驗；設計見 issue）。
 *
 * **這是資訊架構的實驗，不是視覺的。** 刻意只用既有元件與 tokens —— 使用者要分辨「平庸」
 * 出在視覺還是流程，這裡若也更漂亮，實驗就混了變數。
 *
 * 一條由上而下的線：找人 → 預覽他今天的課 → 原因 → 送出 → 結果。
 * **只處理今天**（#2035，使用者 10-24）：明天、其他日期、換人都拿掉 —— 其他日期到請假頁，選錯人收起重開。
 * - 寫入**只呼叫**既有 `POST /api/leaves`（請假連動是保留類，只呼叫不改）
 * - 結果卡顯示 `GET /api/attendance` 回來的**實際寫入**，不是自己預測的；預覽與實際有差就寫出來
 * - ⚠️ `POST /api/leaves` 目前沒有分校範圍檢查（#966）—— 這裡**不補、不繞**，照現狀呼叫。
 *   前端搜得到誰不是保護，那條要在伺服器修。
 */
@Component({
  selector: 'app-phone-leave',
  imports: [
    NgTemplateOutlet,
    FormsModule,
    ButtonModule,
    InputTextModule,
    RouterLink,
    StudentAutocompleteComponent,
    HeightFollowDirective,
  ],
  templateUrl: './phone-leave.component.html',
  host: { class: 'block' },
})
export class PhoneLeaveComponent {
  private readonly studentsService = inject(StudentsService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly leaveService = inject(LeaveService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly systemClock = inject(SystemClockService);

  /** 日到班模式沒有逐堂點名，結果卡不給「點名名單」 */
  readonly rosterAvailable = input(false);

  /** 從「該到沒到」的列開的：預帶這位學生（#1314 D），不必再搜尋 */
  readonly presetStudentId = input<string | null>(null);

  /** 送出成功 —— 儀表板據此重抓「今日」，讓結果也出現在底下的看板上 */
  readonly completed = output<void>();
  readonly rosterRequested = output<PhoneLeaveRosterRequest>();
  readonly closed = output<void>();

  constructor() {
    effect(() => {
      const id = this.presetStudentId();
      if (!id) return;
      untracked(() => {
        this.presetLoading.set(true);
        this.studentsService
          .get(id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (res) => {
              this.presetLoading.set(false);
              this.pick(res.data);
            },
            // 讀不到就退回搜尋框，不要卡在骨架
            error: () => this.presetLoading.set(false),
          });
      });
    });
  }

  protected readonly ATTENDANCE_STATUS_LABELS = ATTENDANCE_STATUS_LABELS;
  protected readonly REASON_CHIPS = REASON_CHIPS;

  /** 台北的今天，不是瀏覽器的 —— 見 SystemClockService */
  protected readonly today = this.systemClock.todayTaipei;

  protected readonly suggestions = signal<Student[]>([]);
  protected readonly student = signal<Student | null>(null);
  /** 預帶的學生還在載（#2037）：畫骨架，不畫搜尋框 */
  protected readonly presetLoading = signal(false);
  protected readonly reason = signal('');

  protected readonly preview = signal<StudentDay | 'error' | null>(null);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<{ records: AttendanceRecord[]; expected: number } | null>(
    null,
  );

  /** 只有今天（#2035） */
  protected readonly date = this.today;

  protected readonly previewDay = computed(() => {
    const p = this.preview();
    return p === 'error' || p === null ? null : p;
  });

  /** 預覽說「送出後會標成請假」的堂數：沒停課、也還沒被別張假蓋到的 */
  private readonly expectedCount = computed(
    () =>
      this.previewDay()?.sessions.filter((s) => !s.cancelled && s.existingLeave === null).length ??
      0,
  );

  /** 已經有假蓋到這天的某一堂 —— 送出會撞 409（請假時間重疊），提前擋 */
  protected readonly overlapping = computed(
    () => this.previewDay()?.sessions.find((s) => s.existingLeave !== null) ?? null,
  );

  protected readonly canSubmit = computed(
    () =>
      this.student() !== null &&
      !this.submitting() &&
      this.result() === null &&
      this.overlapping() === null,
  );

  protected onQuery(query: string): void {
    this.studentsService
      // **不帶 `searchScope`**：API 預設會同時比對家長姓名 —— 打電話來的就是家長，
      // 「王媽媽」常常比「王小明」好認。請假頁的對話框刻意只搜學生姓名，這裡不跟
      .list({ search: query, isActive: true, pageSize: 10 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.suggestions.set(res.data),
        error: () => this.suggestions.set([]),
      });
  }

  protected pick(student: Student | null): void {
    this.student.set(student);
    this.error.set(null);
    if (student) this.loadPreview();
    else this.preview.set(null);
  }

  protected toggleReason(chip: string): void {
    this.reason.set(this.reason() === chip ? '' : chip);
  }

  protected submit(): void {
    const student = this.student();
    if (!student || !this.canSubmit()) return;

    const startDate = this.date();
    const endDate = startDate;
    const expected = this.expectedCount();
    this.submitting.set(true);
    this.error.set(null);

    this.leaveService
      .create({
        studentId: student.id,
        startDate,
        endDate,
        reason: this.reason().trim() || null,
      })
      .pipe(
        // 結果卡要的是**伺服器實際寫入的**：請假連動在 POST 裡同步完成，接著撈回來
        switchMap(() =>
          this.attendanceService.list({
            studentId: student.id,
            dateFrom: startDate,
            dateTo: endDate,
            status: 'on_leave',
            pageSize: 100,
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          this.result.set({ records: res.data, expected });
          this.submitting.set(false);
          this.completed.emit();
        },
        error: (err: { error?: { error?: string } }) => {
          // 電話還沒掛 —— 錯誤留在原地，選好的東西不清空，可以直接重送
          this.error.set(err?.error?.error ?? '登記失敗，請再試一次');
          this.submitting.set(false);
        },
      });
  }

  /** 「再登記一位」—— 電話常連著來 */
  protected reset(): void {
    this.student.set(null);
    this.suggestions.set([]);
    this.reason.set('');
    this.preview.set(null);
    this.result.set(null);
    this.error.set(null);
  }

  protected openRoster(record: AttendanceRecord): void {
    this.rosterRequested.emit({
      eventId: record.eventId,
      className: record.className,
      eventDate: record.eventDate,
      startTime: record.startTime,
      endTime: record.endTime,
    });
  }

  private loadPreview(): void {
    const student = this.student();
    if (!student) return;
    this.preview.set(null);
    this.attendanceService
      .studentDay(student.id, this.date())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.preview.set(res.data),
        // 預覽失敗不擋送出 —— 它只是預覽，送出後的結果卡才是真相
        error: () => this.preview.set('error'),
      });
  }
}
