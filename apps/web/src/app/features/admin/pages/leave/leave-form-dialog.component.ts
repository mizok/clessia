import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
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
    ButtonModule,
    DatePickerModule,
    TextareaModule,
    SelectModule,
    StudentAutocompleteComponent,
  ],
  template: `
    <div class="flex flex-col gap-5 py-2">
      @if (fixedStudentName(); as fixedName) {
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

      <div class="grid gap-3">
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-zinc-700"
            >開始日期時間 <span class="text-error-600">*</span></label
          >
          <div class="grid grid-cols-2 gap-3">
            <p-datepicker
              [(ngModel)]="startDate"
              placeholder="開始日期"
              dateFormat="yy-mm-dd"
              styleClass="w-full"
              appendTo="body"
            />
            <p-datepicker
              [(ngModel)]="startTime"
              [timeOnly]="true"
              hourFormat="24"
              placeholder="開始時間"
              styleClass="w-full"
              appendTo="body"
            />
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-zinc-700"
            >結束日期時間 <span class="text-error-600">*</span></label
          >
          <div class="grid grid-cols-2 gap-3">
            <p-datepicker
              [(ngModel)]="endDate"
              placeholder="結束日期"
              dateFormat="yy-mm-dd"
              [minDate]="startDate ?? undefined"
              styleClass="w-full"
              appendTo="body"
            />
            <p-datepicker
              [(ngModel)]="endTime"
              [timeOnly]="true"
              hourFormat="24"
              placeholder="結束時間"
              styleClass="w-full"
              appendTo="body"
            />
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium text-zinc-700">原因（選填）</label>
        <textarea
          pTextarea
          [(ngModel)]="reason"
          placeholder="請假原因"
          rows="3"
          style="width:100%"
        ></textarea>
      </div>

      <div class="flex justify-end gap-3 pt-2">
        <p-button label="取消" severity="secondary" (onClick)="cancel()" [disabled]="saving()" />
        <p-button
          [label]="editing ? '儲存變更' : '送出請假'"
          icon="pi pi-check"
          [loading]="saving()"
          (onClick)="submit()"
          [disabled]="!canSubmit()"
        />
      </div>
      @if (errorMessage()) {
        <p class="-mt-2 text-right text-sm text-error-600">{{ errorMessage() }}</p>
      }
    </div>
  `,
})
export class LeaveFormDialogComponent implements OnInit {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly studentsService = inject(StudentsService);
  private readonly refData = inject(ReferenceDataService);
  private readonly leaveService = inject(LeaveService);
  // 編輯模式：`data.leave` 有值。換學生等於撤掉再開一張（PATCH 沒有 studentId），所以學生唯讀。
  protected readonly editing: LeaveRequest | null =
    inject(DynamicDialogConfig, { optional: true })?.data?.leave ?? null;

  // 預帶學生（學生檔案的「登記請假」）：`data.student` 有值就跟編輯一樣學生唯讀，不給選
  protected readonly presetStudent: { id: string; name: string } | null =
    inject(DynamicDialogConfig, { optional: true })?.data?.student ?? null;

  protected fixedStudentName(): string | null {
    return this.editing?.studentName ?? this.presetStudent?.name ?? null;
  }

  protected selectedCampusId: string | null = null;
  protected selectedGrade: GradeLevel | null = null;
  protected selectedStudent: Student | string | null = null;
  protected startDate: Date | null = null;
  protected endDate: Date | null = null;
  protected startTime: Date | null = null;
  protected endTime: Date | null = null;
  protected reason = '';

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
    if (this.presetStudent) return;
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
    const student = this.selectedStudent;
    if (!this.editing && !this.presetStudent && !isStudentSelection(student)) {
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
    const request$ = this.editing
      ? this.leaveService.update(this.editing.id, fields)
      : this.leaveService.create({
          studentId: this.presetStudent?.id ?? (student as Student).id,
          ...fields,
        } satisfies CreateLeaveInput);

    request$.subscribe({
      next: (leave) => {
        this.saving.set(false);
        this.dialogRef.close(leave);
      },
      error: (err) => {
        this.saving.set(false);
        const msg = err?.error?.message;
        this.errorMessage.set(
          msg ?? (this.editing ? '儲存失敗，請稍後再試' : '新增請假失敗，請稍後再試'),
        );
      },
    });
  }

  protected cancel(): void {
    this.dialogRef.close(null);
  }
}
