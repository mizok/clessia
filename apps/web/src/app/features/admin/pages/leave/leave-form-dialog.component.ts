import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { format } from 'date-fns';
import { StudentsService, type Student } from '@core/students.service';
import { LeaveService, type CreateLeaveInput } from '@core/leave.service';

@Component({
  selector: 'app-leave-form-dialog',
  standalone: true,
  imports: [FormsModule, ButtonModule, AutoCompleteModule, DatePickerModule, TextareaModule],
  template: `
    <div class="leave-form">
      <div class="leave-form__field">
        <label class="leave-form__label">學生 <span class="leave-form__required">*</span></label>
        <p-autocomplete
          [(ngModel)]="selectedStudent"
          [suggestions]="studentSuggestions()"
          (completeMethod)="searchStudents($event)"
          optionLabel="name"
          placeholder="輸入學生姓名搜尋"
          styleClass="w-full"
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
        />
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
    </div>
  `,
  styles: [
    `
      .leave-form {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        padding: 0.5rem 0;

        &__field {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
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
      }
    `,
  ],
})
export class LeaveFormDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly studentsService = inject(StudentsService);
  private readonly leaveService = inject(LeaveService);

  protected selectedStudent: Student | null = null;
  protected dateRange: Date[] | null = null;
  protected reason = '';

  protected readonly saving = signal(false);
  protected readonly studentSuggestions = signal<Student[]>([]);

  protected canSubmit(): boolean {
    return !!this.selectedStudent && !!this.dateRange?.[0] && !!this.dateRange?.[1];
  }

  protected searchStudents(event: { query: string }): void {
    this.studentsService.list({ search: event.query, pageSize: 20 }).subscribe({
      next: (res) => this.studentSuggestions.set(res.data),
    });
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    this.saving.set(true);

    const input: CreateLeaveInput = {
      studentId: this.selectedStudent!.id,
      startDate: format(this.dateRange![0], 'yyyy-MM-dd'),
      endDate: format(this.dateRange![1], 'yyyy-MM-dd'),
      reason: this.reason || null,
    };

    this.leaveService.create(input).subscribe({
      next: (leave) => {
        this.saving.set(false);
        this.dialogRef.close(leave);
      },
      error: () => {
        this.saving.set(false);
      },
    });
  }

  protected cancel(): void {
    this.dialogRef.close(null);
  }
}
