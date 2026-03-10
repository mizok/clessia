import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig, DialogService } from 'primeng/dynamicdialog';
import {
  ClassesService,
  Class,
  CreateClassInput,
  UpdateClassInput,
  CreateScheduleInput,
  CheckConflictScheduleInput,
  ScheduleConflict,
} from '@core/classes.service';
import { Course } from '@core/courses.service';
import { Staff } from '@core/staff.service';

export interface ScheduleFormEntry {
  id?: string;
  weekday: number | null;
  startTime: string;
  endTime: string;
  teacherId: string | null;
  effectiveTo: string | null;
}

@Component({
  selector: 'app-class-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    ToggleSwitch,
    TooltipModule,
  ],
  templateUrl: './class-form-dialog.component.html',
  styleUrl: './class-form-dialog.component.scss',
})
export class ClassFormDialogComponent {
  private readonly classesService = inject(ClassesService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly loading = signal(false);
  protected readonly cls = signal<Class | null>(this.config.data?.cls ?? null);
  protected readonly course = signal<Course | null>(this.config.data?.course ?? null);
  protected readonly staff = signal<Staff[]>(this.config.data?.staff ?? []);
  protected readonly campuses = signal<any[]>(this.config.data?.campuses ?? []);

  protected readonly isEditing = computed(() => this.cls() !== null);
  protected readonly dialogTitle = computed(() => (this.isEditing() ? '編輯班級' : '新增班級'));

  protected readonly formData = signal({
    name: this.cls()?.name ?? '',
    maxStudents: this.cls()?.maxStudents ?? 20,
    nextClassId: this.cls()?.nextClassId ?? null,
    isActive: this.cls()?.isActive ?? true,
  });

  protected readonly scheduleEntries = signal<ScheduleFormEntry[]>(
    (this.cls()?.schedules ?? []).map((s) => ({
      id: s.id,
      weekday: s.weekday,
      startTime: s.startTime.substring(0, 5),
      endTime: s.endTime.substring(0, 5),
      teacherId: s.teacherId,
      effectiveTo: s.effectiveTo,
    })),
  );

  protected readonly breadcrumb = computed(() => {
    const c = this.course();
    if (!c) return '';
    const campusName = this.campuses().find((cp) => cp.id === c.campusId)?.name ?? '未知分校';
    return `${campusName} › ${c.name}`;
  });

  protected readonly weekdayOptions = [
    { label: '週一', value: 1 },
    { label: '週二', value: 2 },
    { label: '週三', value: 3 },
    { label: '週四', value: 4 },
    { label: '週五', value: 5 },
    { label: '週六', value: 6 },
    { label: '週日', value: 7 },
  ];

  protected readonly filteredStaffOptions = computed(() => {
    const c = this.course();
    if (!c) return [];

    return this.staff()
      .filter((s) => s.campusIds.includes(c.campusId) && s.subjectIds.includes(c.subjectId))
      .map((s) => ({ label: s.displayName, value: s.id }));
  });

  protected readonly pendingConflicts = signal<ScheduleConflict[]>([]);
  protected readonly conflictDialogVisible = signal(false);
  protected readonly formValidationMessage = signal<string | null>(null);

  protected updateForm(field: keyof ReturnType<typeof this.formData>, value: any): void {
    this.formValidationMessage.set(null);
    this.formData.update((f) => ({ ...f, [field]: value }));
  }

  protected addScheduleEntry(): void {
    this.formValidationMessage.set(null);
    this.scheduleEntries.update((list) => [
      ...list,
      {
        weekday: 1,
        startTime: '09:00',
        endTime: '11:00',
        teacherId: null,
        effectiveTo: null,
      },
    ]);
  }

  protected removeScheduleEntry(index: number): void {
    this.formValidationMessage.set(null);
    this.scheduleEntries.update((list) => list.filter((_, i) => i !== index));
  }

  protected updateScheduleEntry(index: number, field: keyof ScheduleFormEntry, value: any): void {
    this.formValidationMessage.set(null);
    this.scheduleEntries.update((list) =>
      list.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  }

  protected save(): void {
    this.formValidationMessage.set(null);
    const form = this.formData();
    if (!form.name.trim()) {
      this.formValidationMessage.set('請填寫班級名稱');
      return;
    }

    const incompleteSchedule = this.scheduleEntries().find((e) => !e.weekday);
    if (incompleteSchedule) {
      this.formValidationMessage.set('時段資料不完整：請確認每個時段都已設定上課星期');
      return;
    }

    const invalidTime = this.scheduleEntries().find(
      (entry) => !entry.startTime || !entry.endTime || entry.startTime >= entry.endTime,
    );
    if (invalidTime) {
      this.formValidationMessage.set('時段資料不合法：請確認每個時段的開始時間早於結束時間');
      return;
    }

    const overlap = this.findLocalScheduleOverlap(this.scheduleEntries());
    if (overlap) {
      this.formValidationMessage.set(
        `時段重疊：第 ${overlap.firstEntryNo} 筆與第 ${overlap.secondEntryNo} 筆在${this.getWeekdayLabel(overlap.weekday)}時段重疊`,
      );
      return;
    }

    // Conflict check for NEW schedules (only when teacherId is set)
    const toCheck: CheckConflictScheduleInput[] = this.scheduleEntries()
      .filter((e) => !e.id && !!e.teacherId && !!e.weekday)
      .map((e) => ({
        weekday: e.weekday!,
        startTime: e.startTime,
        endTime: e.endTime,
        teacherId: e.teacherId!,
        effectiveTo: e.effectiveTo,
      }));

    if (toCheck.length === 0) {
      // No teacher assigned — skip conflict check, go directly to save
      this.doSave();
      return;
    }

    this.loading.set(true);
    this.classesService.checkScheduleConflicts(toCheck, this.cls()?.id).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.conflicts.length > 0) {
          this.pendingConflicts.set(res.conflicts);
          this.conflictDialogVisible.set(true);
        } else {
          this.doSave();
        }
      },
      error: () => {
        this.loading.set(false);
        this.doSave();
      },
    });
  }

  protected proceedSaveDespiteConflicts(): void {
    this.conflictDialogVisible.set(false);
    this.doSave();
  }

  private doSave(): void {
    this.loading.set(true);
    const form = this.formData();

    if (this.isEditing()) {
      const updateInput: UpdateClassInput = {
        name: form.name.trim(),
        maxStudents: form.maxStudents,
        nextClassId: form.nextClassId,
        isActive: form.isActive,
      };
      this.classesService.update(this.cls()!.id, updateInput).subscribe({
        next: () => {
          this.handleScheduleUpdates(this.cls()!.id);
        },
        error: (err) => {
          this.loading.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '更新失敗',
            detail: err.error?.error || '請稍後再試',
          });
        },
      });
    } else {
      const input: CreateClassInput = {
        courseId: this.course()!.id,
        name: form.name.trim(),
        maxStudents: form.maxStudents,
        nextClassId: form.nextClassId,
      };
      this.classesService.create(input).subscribe({
        next: (res) => {
          this.handleScheduleUpdates(res.data.id);
        },
        error: (err) => {
          this.loading.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '新增失敗',
            detail: err.error?.error || '請稍後再試',
          });
        },
      });
    }
  }

  private handleScheduleUpdates(classId: string): void {
    const existingSchedules = this.cls()?.schedules ?? [];
    const updatedEntries = this.scheduleEntries();

    const existingById = new Map(existingSchedules.map((s) => [s.id, s]));
    const keptIds = new Set(updatedEntries.filter((e) => e.id).map((e) => e.id!));
    const toDelete = existingSchedules.map((s) => s.id).filter((id) => !keptIds.has(id));
    const toAdd = updatedEntries.filter((e) => !e.id);
    const toUpdate = updatedEntries.filter((e) => {
      if (!e.id) return false;
      const orig = existingById.get(e.id);
      if (!orig) return false;
      return (
        e.weekday !== orig.weekday ||
        e.startTime !== orig.startTime.substring(0, 5) ||
        e.endTime !== orig.endTime.substring(0, 5) ||
        e.teacherId !== orig.teacherId ||
        e.effectiveTo !== orig.effectiveTo
      );
    });

    const deleteOps = toDelete.map((sid) =>
      this.classesService.deleteSchedule(classId, sid).toPromise(),
    );
    const updateOps = toUpdate.map((e) =>
      this.classesService
        .updateSchedule(classId, e.id!, {
          weekday: e.weekday!,
          startTime: e.startTime,
          endTime: e.endTime,
          teacherId: e.teacherId,
          effectiveTo: e.effectiveTo,
        })
        .toPromise(),
    );

    Promise.all([...deleteOps, ...updateOps])
      .then(() => {
        if (toAdd.length === 0) {
          this.ref.close({ classId });
        } else {
          this.addSchedulesSequentially(classId, toAdd, 0, () => {
            this.ref.close({ classId });
          });
        }
      })
      .catch((err) => {
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '儲存失敗',
          detail: err?.error?.error || '更新時段失敗，請稍後再試',
        });
      });
  }

  private addSchedulesSequentially(
    classId: string,
    entries: ScheduleFormEntry[],
    index: number,
    onComplete: () => void,
  ): void {
    if (index >= entries.length) {
      onComplete();
      return;
    }
    const entry = entries[index];
    const input: CreateScheduleInput = {
      weekday: entry.weekday!,
      startTime: entry.startTime,
      endTime: entry.endTime,
      teacherId: entry.teacherId,
      effectiveTo: entry.effectiveTo,
    };
    this.classesService.addSchedule(classId, input).subscribe({
      next: () => this.addSchedulesSequentially(classId, entries, index + 1, onComplete),
      error: (err) => {
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '儲存失敗',
          detail: err?.error?.error || '新增時段失敗，請確認是否存在重疊時段',
        });
      },
    });
  }

  private findLocalScheduleOverlap(entries: ScheduleFormEntry[]): {
    firstEntryNo: number;
    secondEntryNo: number;
    weekday: number;
  } | null {
    for (let i = 0; i < entries.length; i++) {
      const left = entries[i];
      if (!left.weekday) continue;

      for (let j = i + 1; j < entries.length; j++) {
        const right = entries[j];
        if (!right.weekday || left.weekday !== right.weekday) continue;

        const isOverlap = left.startTime < right.endTime && right.startTime < left.endTime;
        if (isOverlap) {
          return {
            firstEntryNo: i + 1,
            secondEntryNo: j + 1,
            weekday: left.weekday,
          };
        }
      }
    }
    return null;
  }

  protected cancel(): void {
    this.ref.close();
  }

  protected getWeekdayLabel(weekday: number): string {
    return ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'][weekday] ?? '';
  }
}
