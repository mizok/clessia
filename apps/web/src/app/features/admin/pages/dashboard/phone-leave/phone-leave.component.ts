import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { format } from 'date-fns';
import { switchMap } from 'rxjs';

import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';

import {
  ATTENDANCE_STATUS_LABELS,
  AttendanceService,
  type AttendanceRecord,
  type StudentDay,
} from '@core/attendance.service';
import { LeaveService } from '@core/leave.service';
import { StudentsService, type Student } from '@core/students.service';
import { SystemClockService, addDaysToDateString } from '@core/system-clock.service';
import { StudentAutocompleteComponent } from '@shared/components/student-autocomplete/student-autocomplete.component';

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
 * 一條由上而下的線：找人 → 哪一天 → 預覽他那天的課 → 原因 → 送出 → 結果。
 * - 寫入**只呼叫**既有 `POST /api/leaves`（請假連動是保留類，只呼叫不改）
 * - 結果卡顯示 `GET /api/attendance` 回來的**實際寫入**，不是自己預測的；預覽與實際有差就寫出來
 * - ⚠️ `POST /api/leaves` 目前沒有分校範圍檢查（#966）—— 這裡**不補、不繞**，照現狀呼叫。
 *   前端搜得到誰不是保護，那條要在伺服器修。
 */
@Component({
  selector: 'app-phone-leave',
  imports: [
    FormsModule,
    ButtonModule,
    DatePickerModule,
    InputTextModule,
    StudentAutocompleteComponent,
  ],
  templateUrl: './phone-leave.component.html',
  styleUrl: './phone-leave.component.scss',
})
export class PhoneLeaveComponent {
  private readonly studentsService = inject(StudentsService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly leaveService = inject(LeaveService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly systemClock = inject(SystemClockService);

  /** 日到班模式沒有逐堂點名，結果卡不給「點名名單」 */
  readonly rosterAvailable = input(false);

  /** 送出成功 —— 儀表板據此重抓「今日」，讓結果也出現在底下的看板上 */
  readonly completed = output<void>();
  readonly rosterRequested = output<PhoneLeaveRosterRequest>();
  readonly closed = output<void>();

  protected readonly ATTENDANCE_STATUS_LABELS = ATTENDANCE_STATUS_LABELS;
  protected readonly REASON_CHIPS = REASON_CHIPS;

  /** 台北的今天，不是瀏覽器的 —— 見 SystemClockService */
  protected readonly today = this.systemClock.todayTaipei;
  protected readonly tomorrow = computed(() => addDaysToDateString(this.today(), 1));

  protected readonly suggestions = signal<Student[]>([]);
  protected readonly student = signal<Student | null>(null);
  protected readonly startDate = signal<string | null>(null);
  protected readonly endDate = signal<string | null>(null);
  /** 「其他日期」展開時才給選區間；主路徑是單日快選 */
  protected readonly customDates = signal(false);
  protected readonly reason = signal('');

  protected readonly preview = signal<StudentDay | 'error' | null>(null);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<{ records: AttendanceRecord[]; expected: number } | null>(
    null,
  );

  protected readonly date = computed(() => this.startDate() ?? this.today());
  protected readonly isRange = computed(
    () => this.endDate() !== null && this.endDate() !== this.date(),
  );

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

  /** 快選單日（今天／明天／下一堂）。收起區間 */
  protected chooseDate(date: string): void {
    this.customDates.set(false);
    this.startDate.set(date);
    this.endDate.set(null);
    this.loadPreview();
  }

  protected openCustomDates(): void {
    this.customDates.set(true);
    this.endDate.set(this.date());
  }

  protected onCustomStart(value: Date | null): void {
    if (!value) return;
    const start = format(value, 'yyyy-MM-dd');
    this.startDate.set(start);
    const end = this.endDate();
    if (end === null || end < start) this.endDate.set(start);
    this.loadPreview();
  }

  protected onCustomEnd(value: Date | null): void {
    if (value) this.endDate.set(format(value, 'yyyy-MM-dd'));
  }

  protected asDate(value: string | null): Date | null {
    return value ? new Date(`${value}T00:00:00`) : null;
  }

  protected toggleReason(chip: string): void {
    this.reason.set(this.reason() === chip ? '' : chip);
  }

  protected submit(): void {
    const student = this.student();
    if (!student || !this.canSubmit()) return;

    const startDate = this.date();
    const endDate = this.endDate() ?? startDate;
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
    this.startDate.set(null);
    this.endDate.set(null);
    this.customDates.set(false);
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
