import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { format } from 'date-fns';
import {
  StudentsService,
  type Student,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
  type GradeLevel,
} from '@core/students.service';
import { CampusesService, type Campus } from '@core/campuses.service';
import { LeaveService, type CreateLeaveInput } from '@core/leave.service';

interface SelectOption<T> {
  label: string;
  value: T | null;
}

@Component({
  selector: 'app-leave-form-dialog',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    AutoCompleteModule,
    DatePickerModule,
    TextareaModule,
    SelectModule,
  ],
  template: `
    <div class="leave-form">
      <div class="leave-form__filters">
        <div class="leave-form__filter-group">
          <label class="leave-form__label">分校</label>
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
        <div class="leave-form__filter-group">
          <label class="leave-form__label">年級</label>
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

      <div class="leave-form__field">
        <label class="leave-form__label">學生 <span class="leave-form__required">*</span></label>
        <p-autocomplete
          [(ngModel)]="selectedStudent"
          [suggestions]="studentSuggestions()"
          (completeMethod)="searchStudents($event)"
          optionLabel="name"
          placeholder="輸入姓名模糊搜尋"
          styleClass="w-full"
          [forceSelection]="true"
        />
      </div>

      <div class="leave-form__field">
        <label class="leave-form__label">請假日期 <span class="leave-form__required">*</span></label>
        <p-datepicker
          [(ngModel)]="dateRange"
          selectionMode="range"
          placeholder="選擇日期區間"
          dateFormat="yy-mm-dd"
          styleClass="w-full"
          appendTo="body"
        />
      </div>

      <div class="leave-form__time-row">
        <div class="leave-form__field">
          <label class="leave-form__label">起始時間（選填）</label>
          <p-datepicker
            [(ngModel)]="startTime"
            [timeOnly]="true"
            hourFormat="24"
            placeholder="--:--"
            styleClass="w-full"
            appendTo="body"
          />
        </div>
        <div class="leave-form__field">
          <label class="leave-form__label">結束時間（選填）</label>
          <p-datepicker
            [(ngModel)]="endTime"
            [timeOnly]="true"
            hourFormat="24"
            placeholder="--:--"
            styleClass="w-full"
            appendTo="body"
          />
        </div>
      </div>

      <div class="leave-form__field">
        <label class="leave-form__label">原因（選填）</label>
        <textarea
          pTextarea
          [(ngModel)]="reason"
          placeholder="請假原因"
          rows="3"
          style="width:100%"
        ></textarea>
      </div>

      <div class="leave-form__actions">
        <p-button
          label="取消"
          severity="secondary"
          (onClick)="cancel()"
          [disabled]="saving()"
        />
        <p-button
          label="送出請假"
          icon="pi pi-check"
          [loading]="saving()"
          (onClick)="submit()"
          [disabled]="!canSubmit()"
        />
      </div>
      @if (errorMessage()) {
        <p class="leave-form__error">{{ errorMessage() }}</p>
      }
    </div>
  `,
  styles: [
    `
      .leave-form {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        padding: 0.5rem 0;

        &__filters {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
        }
        &__filter-group {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        &__field {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        &__time-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
        }
        &__label {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--zinc-700);
        }
        &__required {
          color: var(--red-500);
        }
        &__actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.75rem;
          padding-top: 0.5rem;
        }
        &__error {
          color: var(--red-500);
          font-size: 0.875rem;
          text-align: right;
          margin-top: -0.5rem;
        }
      }
    `,
  ],
})
export class LeaveFormDialogComponent implements OnInit {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly studentsService = inject(StudentsService);
  private readonly campusesService = inject(CampusesService);
  private readonly leaveService = inject(LeaveService);

  protected selectedCampusId: string | null = null;
  protected selectedGrade: GradeLevel | null = null;
  protected selectedStudent: Student | null = null;
  protected dateRange: Date[] | null = null;
  protected startTime: Date | null = null;
  protected endTime: Date | null = null;
  protected reason = '';


  protected readonly saving = signal(false);
  protected readonly studentSuggestions = signal<Student[]>([]);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly campusOptions = signal<SelectOption<string>[]>([
    { label: '全部分校', value: null },
  ]);

  protected readonly gradeOptions: SelectOption<GradeLevel>[] = [
    { label: '全部年級', value: null },
    ...GRADE_LEVELS.map((g) => ({ label: GRADE_LEVEL_LABELS[g], value: g })),
  ];

  ngOnInit(): void {
    this.campusesService.list({ isActive: true, pageSize: 100 }).subscribe({
      next: (res) => {
        this.campusOptions.set([
          { label: '全部分校', value: null },
          ...res.data.map((c: Campus) => ({ label: c.name, value: c.id })),
        ]);
      },
    });
  }

  protected onFilterChange(): void {
    this.selectedStudent = null;
    this.studentSuggestions.set([]);
  }

  protected canSubmit(): boolean {
    return !!this.selectedStudent && !!this.dateRange?.[0] && !!this.dateRange?.[1];
  }

  protected searchStudents(event: { query: string }): void {
    this.studentsService
      .list({
        search: event.query,
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
    if (!this.canSubmit()) return;
    this.saving.set(true);
    this.errorMessage.set(null);

    const input: CreateLeaveInput = {
      studentId: this.selectedStudent!.id,
      startDate: format(this.dateRange![0], 'yyyy-MM-dd'),
      endDate: format(this.dateRange![1], 'yyyy-MM-dd'),
      startTime: this.startTime ? format(this.startTime, 'HH:mm') : null,
      endTime: this.endTime ? format(this.endTime, 'HH:mm') : null,
      reason: this.reason || null,
    };

    this.leaveService.create(input).subscribe({
      next: (leave) => {
        this.saving.set(false);
        this.dialogRef.close(leave);
      },
      error: (err) => {
        this.saving.set(false);
        const msg = err?.error?.message;
        this.errorMessage.set(msg ?? '新增請假失敗，請稍後再試');
      },
    });
  }

  protected cancel(): void {
    this.dialogRef.close(null);
  }
}
