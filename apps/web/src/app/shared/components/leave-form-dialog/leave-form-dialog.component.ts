import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import type { Observable } from 'rxjs';
import { format, parseISO } from 'date-fns';
import {
  StudentsService,
  type Student,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
  type GradeLevel,
} from '@core/students.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { LeaveService, type CreateLeaveInput, type LeaveRequest } from '@core/leave.service';
import { StudentAutocompleteComponent } from '@shared/components/student-autocomplete/student-autocomplete.component';

interface SelectOption<T> {
  label: string;
  value: T | null;
}

function isStudentSelection(value: unknown): value is Student {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value['id'] === 'string' &&
    'name' in value &&
    typeof value['name'] === 'string'
  );
}

/** DB 回 `HH:MM:SS`，picker 要 Date */
function toTimeDate(time: string | null): Date | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  return new Date(2000, 0, 1, h, m);
}

@Component({
  selector: 'app-leave-form-dialog',
  standalone: true,
  imports: [
    FormsModule,
    DatePickerModule,
    InputTextModule,
    SelectModule,
    StudentAutocompleteComponent,
  ],
  template: `
    <div class="flex flex-col gap-5 py-2">
      <!-- 嵌入（家長端）時學生寫在外框的副標，這裡不出學生欄（A6 forms.leave） -->
      @if (student()) {
      } @else if (fixedStudentName(); as fixedName) {
        <div class="flex w-full flex-col gap-1.5">
          <label class="text-sm font-medium text-zinc-700">學生</label>
          <strong>{{ fixedName }}</strong>
        </div>
      } @else {
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-zinc-700">分校</label>
            <p-select
              [(ngModel)]="selectedCampusId"
              [options]="campusOptions()"
              optionLabel="label"
              optionValue="value"
              placeholder="全部分校"
              styleClass="w-full"
              (onChange)="onFilterChange()"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium text-zinc-700">年級</label>
            <p-select
              [(ngModel)]="selectedGrade"
              [options]="gradeOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="全部年級"
              styleClass="w-full"
              (onChange)="onFilterChange()"
            />
          </div>
        </div>

        <div class="flex w-full flex-col gap-1.5">
          <label class="text-sm font-medium text-zinc-700"
            >學生 <span class="text-error-600">*</span></label
          >
          <app-student-autocomplete
            [value]="selectedStudent"
            (valueChange)="selectedStudent = $event"
            [suggestions]="studentSuggestions()"
            (queryChange)="searchStudents($event)"
          />
        </div>
      }

      <!-- A6 forms.leave：四個欄各自有標籤，桌機兩兩並排、手機一欄一列 -->
      <!-- ngNoForm：A6 的欄位包在 <form> 裡，但這裡的 ngModel 是 standalone，不要 NgForm -->
      <form
        ngNoForm
        class="grid grid-cols-1 gap-x-3 gap-y-4 wide:grid-cols-2"
        (submit)="$event.preventDefault()"
      >
        @for (f of dateFields; track f.key) {
          <div class="flex min-w-0 flex-col gap-1">
            <label class="text-md font-semibold text-zinc-700" [attr.for]="'leave-' + f.key"
              >{{ f.label }}
              @if (f.required) {
                <span class="text-error-700" aria-hidden="true">*</span>
              }
            </label>
            <p-datepicker
              [inputId]="'leave-' + f.key"
              [ngModel]="this[f.key]"
              (ngModelChange)="this[f.key] = $event"
              [placeholder]="f.label"
              [timeOnly]="f.time"
              [hourFormat]="'24'"
              dateFormat="yy-mm-dd"
              [minDate]="f.key === 'endDate' ? (startDate ?? undefined) : undefined"
              styleClass="w-full"
              [appendTo]="appendTo()"
            />
          </div>
        }
        <div class="flex min-w-0 flex-col gap-1 wide:col-span-2">
          <label class="text-md font-semibold text-zinc-700" for="leave-reason">原因（選填）</label>
          <!-- A6 是單行文字欄 -->
          <input
            id="leave-reason"
            type="text"
            pInputText
            [(ngModel)]="reason"
            placeholder="請假原因"
            autocomplete="off"
            class="w-full"
          />
        </div>
      </form>

      <!--
        A6 form() 的底部：必填沒填時送出鈕不鎖死，旁邊一行寫還差什麼（#723：disabled 會把「為什麼不行」藏起來）；
        處理中寫「送出中…」。送出失敗的訊息也寫在這一行，填的內容不清。
        黏在捲動區底（A6 .fdlg__foot）：表單一長，送出鈕不跟著內容捲走；內容從它後面捲過，底色不透明。
        sticky 會扣掉捲動容器的 padding（容器 pb 16px，動作列就浮在離底 16px，下面露出捲動的內容），
        所以底部留白由外框用 --leave-foot-pb 交給動作列自己撐（家長端含 safe-area）；沒設就是 0。
      -->
      <div
        class="sticky bottom-0 z-[1] flex flex-wrap items-center justify-end gap-2 bg-white pt-2 pb-(--leave-foot-pb)"
      >
        <p
          class="m-0 mr-auto text-md max-wide:basis-full"
          [class.text-error-700]="!!errorMessage()"
          [class.text-zinc-600]="!errorMessage()"
          aria-live="polite"
        >
          {{ errorMessage() ?? missingHint() }}
        </p>
        <button
          type="button"
          class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-zinc-300 bg-white px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 wide:h-9"
          [disabled]="saving()"
          (click)="cancel()"
        >
          取消
        </button>
        <button
          type="button"
          class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-accent-vivid bg-accent-vivid px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 hover:border-accent-vivid-2 hover:bg-accent-vivid-2 aria-disabled:opacity-55 wide:h-9"
          [attr.aria-disabled]="!canSubmit() || saving()"
          (click)="submit()"
        >
          {{ saving() ? (editing ? '儲存中…' : '送出中…') : editing ? '儲存變更' : '送出請假' }}
        </button>
      </div>
    </div>
  `,
})
export class LeaveFormDialogComponent implements OnInit {
  /** 管理端由 DialogService 開（有 ref）；家長端直接嵌在頁面的 `<dialog>` 裡（沒有 ref，靠 `closed`） */
  private readonly dialogRef = inject(DynamicDialogRef, { optional: true });
  private readonly config = inject(DynamicDialogConfig, { optional: true });
  private readonly studentsService = inject(StudentsService);
  private readonly refData = inject(ReferenceDataService);
  private readonly leaveService = inject(LeaveService);
  // 編輯模式：`data.leave` 有值。換學生等於撤掉再開一張（PATCH 沒有 studentId），所以學生唯讀。
  protected readonly editing: LeaveRequest | null = this.config?.data?.leave ?? null;

  /**
   * 嵌入用（家長端，#1695）：學生固定是這一位，不出學生欄；A6 `forms.leave` 的預設
   * 今天 17:00–21:00 也只在這條路帶（管理端的行為不變）
   */
  readonly student = input<{ id: string; name: string } | null>(null);
  /** 嵌入用：送出走哪支 API（家長端是 `/api/me/leaves`）；沒給就是管理端的 `LeaveService.create` */
  readonly create = input<((body: CreateLeaveInput) => Observable<unknown>) | null>(null);
  /** 嵌入在原生 `<dialog>`（top layer）裡時，日期面板要掛在 dialog 上，掛到 body 會被蓋住 */
  readonly appendTo = input<HTMLElement | 'body'>('body');
  /** 嵌入用：送出成功帶回建立的假、取消帶 null（DialogService 開的走 `dialogRef.close`） */
  readonly closed = output<unknown>();

  // 預帶學生（學生檔案的「登記請假」）：`data.student` 有值就跟編輯一樣學生唯讀，不給選
  protected presetStudent(): { id: string; name: string } | null {
    return this.config?.data?.student ?? this.student();
  }

  protected fixedStudentName(): string | null {
    return this.editing?.studentName ?? this.presetStudent()?.name ?? null;
  }

  protected selectedCampusId: string | null = null;
  protected selectedGrade: GradeLevel | null = null;
  protected selectedStudent: Student | string | null = null;
  protected startDate: Date | null = null;
  protected endDate: Date | null = null;
  protected startTime: Date | null = null;
  protected endTime: Date | null = null;
  protected reason = '';

  /** 四個日期時間欄（A6 forms.leave 的欄名）；時間選填（管理端一直是選填，後端也收 null） */
  protected readonly dateFields = [
    { key: 'startDate', label: '開始日期', time: false, required: true },
    { key: 'startTime', label: '開始時間', time: true, required: false },
    { key: 'endDate', label: '結束日期', time: false, required: true },
    { key: 'endTime', label: '結束時間', time: true, required: false },
  ] as const;

  protected readonly saving = signal(false);
  protected readonly studentSuggestions = signal<Student[]>([]);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly campusOptions = computed<SelectOption<string>[]>(() => [
    { label: '全部分校', value: null },
    ...this.refData
      .campuses()
      .filter((campus) => campus.isActive)
      .map((campus) => ({ label: campus.name, value: campus.id })),
  ]);

  protected readonly gradeOptions: SelectOption<GradeLevel>[] = [
    { label: '全部年級', value: null },
    ...GRADE_LEVELS.map((g) => ({ label: GRADE_LEVEL_LABELS[g], value: g })),
  ];

  ngOnInit(): void {
    const leave = this.editing;
    if (leave) {
      this.startDate = parseISO(leave.startDate);
      this.endDate = parseISO(leave.endDate);
      this.startTime = toTimeDate(leave.startTime);
      this.endTime = toTimeDate(leave.endTime);
      this.reason = leave.reason ?? '';
      return;
    }
    if (this.student()) {
      this.startDate = this.endDate = new Date();
      this.startTime = toTimeDate('17:00');
      this.endTime = toTimeDate('21:00');
    }
    if (this.presetStudent()) return;
    this.refData.loadCampuses();
  }

  protected onFilterChange(): void {
    this.selectedStudent = null;
    this.studentSuggestions.set([]);
  }

  protected canSubmit(): boolean {
    return (
      (this.fixedStudentName() !== null || isStudentSelection(this.selectedStudent)) &&
      !!this.startDate &&
      !!this.endDate &&
      this.startDate <= this.endDate
    );
  }

  /** A6「還沒填：…」：必填沒填的欄名 */
  protected missingHint(): string {
    const missing = [
      ...(this.fixedStudentName() === null && !isStudentSelection(this.selectedStudent)
        ? ['學生']
        : []),
      ...(this.startDate ? [] : ['開始日期']),
      ...(this.endDate ? [] : ['結束日期']),
    ];
    return missing.length ? `還沒填：${missing.join('、')}` : '';
  }

  protected searchStudents(query: string): void {
    this.studentsService
      .list({
        search: query,
        searchScope: 'student_name',
        campusId: this.selectedCampusId ?? undefined,
        grade: this.selectedGrade ?? undefined,
        isActive: true,
        pageSize: 30,
      })
      .subscribe({
        next: (res) => this.studentSuggestions.set(res.data),
      });
  }

  protected submit(): void {
    if (this.saving()) return;
    const student = this.selectedStudent;
    if (!this.editing && !this.presetStudent() && !isStudentSelection(student)) {
      this.errorMessage.set('請從建議清單選擇一位學生');
      return;
    }
    if (!this.startDate || !this.endDate) {
      this.errorMessage.set('請完整填寫開始與結束日期');
      return;
    }
    if (this.startDate > this.endDate) {
      this.errorMessage.set('結束日期不可早於開始日期');
      return;
    }
    if (
      format(this.startDate, 'yyyy-MM-dd') === format(this.endDate, 'yyyy-MM-dd') &&
      this.startTime &&
      this.endTime &&
      format(this.startTime, 'HH:mm') > format(this.endTime, 'HH:mm')
    ) {
      this.errorMessage.set('同一天請假的結束時間不可早於開始時間');
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);

    const fields = {
      startDate: format(this.startDate, 'yyyy-MM-dd'),
      endDate: format(this.endDate, 'yyyy-MM-dd'),
      startTime: this.startTime ? format(this.startTime, 'HH:mm') : null,
      endTime: this.endTime ? format(this.endTime, 'HH:mm') : null,
      reason: this.reason || null,
    };
    const create = (body: CreateLeaveInput) =>
      this.create()?.(body) ?? this.leaveService.create(body);
    const request$: Observable<unknown> = this.editing
      ? this.leaveService.update(this.editing.id, fields)
      : create({ studentId: this.presetStudent()?.id ?? (student as Student).id, ...fields });

    request$.subscribe({
      next: (leave) => {
        this.saving.set(false);
        this.close(leave);
      },
      error: (err) => {
        this.saving.set(false);
        // 錯誤留在表單、填的不清（#1695 §5）。家長端回 `{ error, code }`，管理端回 `{ error, message }`
        const msg =
          err?.error?.code === 'NO_SESSIONS'
            ? `這段時間 ${this.fixedStudentName()} 沒有課`
            : (err?.error?.message ?? (err?.error?.code ? err.error.error : undefined));
        this.errorMessage.set(
          msg ?? (this.editing ? '儲存失敗，請稍後再試' : '新增請假失敗，請稍後再試'),
        );
      },
    });
  }

  protected cancel(): void {
    this.close(null);
  }

  private close(result: unknown): void {
    if (this.dialogRef) this.dialogRef.close(result);
    else this.closed.emit(result);
  }
}
