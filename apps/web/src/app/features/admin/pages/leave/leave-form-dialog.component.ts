import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
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
import { ReferenceDataService } from '@core/reference-data.service';
import { LeaveService, type CreateLeaveInput } from '@core/leave.service';
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

      <div class="leave-form__field leave-form__field--full">
        <label class="leave-form__label">學生 <span class="leave-form__required">*</span></label>
        <app-student-autocomplete
          [value]="selectedStudent"
          (valueChange)="selectedStudent = $event"
          [suggestions]="studentSuggestions()"
          (queryChange)="searchStudents($event)"
        />
      </div>

      <div class="leave-form__range-grid">
        <div class="leave-form__range-group">
          <label class="leave-form__label">開始日期時間 <span class="leave-form__required">*</span></label>
          <div class="leave-form__date-time-row">
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
        <div class="leave-form__range-group">
          <label class="leave-form__label">結束日期時間 <span class="leave-form__required">*</span></label>
          <div class="leave-form__date-time-row">
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
        &__field--full {
          width: 100%;
        }
        &__range-grid {
          display: grid;
          gap: 0.75rem;
        }
        &__range-group {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        &__date-time-row {
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
  private readonly refData = inject(ReferenceDataService);
  private readonly leaveService = inject(LeaveService);

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
    this.refData.loadCampuses();
  }

  protected onFilterChange(): void {
    this.selectedStudent = null;
    this.studentSuggestions.set([]);
  }

  protected canSubmit(): boolean {
    return (
      isStudentSelection(this.selectedStudent) &&
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
    if (!isStudentSelection(this.selectedStudent)) {
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

    const input: CreateLeaveInput = {
      studentId: this.selectedStudent.id,
      startDate: format(this.startDate, 'yyyy-MM-dd'),
      endDate: format(this.endDate, 'yyyy-MM-dd'),
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
