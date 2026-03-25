import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { finalize } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import {
  EnrollmentsService,
  type BatchCreateInput,
  type BatchMatchCandidate,
  type BatchMatchItem,
  type BatchMatchResultItem,
} from '../../../../../../core/enrollments.service';

@Component({
  selector: 'app-student-excel-import-dialog',
  standalone: true,
  imports: [CommonModule, ButtonModule, TableModule, SelectModule, TagModule, ProgressSpinnerModule],
  templateUrl: './student-excel-import-dialog.component.html',
  styleUrl: './student-excel-import-dialog.component.scss',
})
export class StudentExcelImportDialogComponent {
  protected readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly enrollmentsService = inject(EnrollmentsService);

  protected readonly step = signal<1 | 2 | 3 | 4>(1);
  protected readonly rawItems = signal<BatchMatchItem[]>([]);
  protected readonly matchResults = signal<BatchMatchResultItem[]>([]);
  protected readonly resolvedIds = signal<Map<number, string>>(new Map());
  protected readonly loading = signal<boolean>(false);
  protected readonly submitResult = signal<{ success: number; skipped: number } | null>(null);
  protected readonly overQuota = signal<boolean>(false);
  protected readonly submitFailed = signal<boolean>(false);
  protected readonly dragging = signal<boolean>(false);

  protected readonly classId = computed(() => this.config.data?.classId as string);
  protected readonly remainingSlots = computed(() => (this.config.data?.remainingSlots ?? 9999) as number);

  protected readonly resolvedStudentIds = computed(() => {
    const results = this.matchResults();
    const resolved = this.resolvedIds();

    const ids = results
      .map((r) => {
        if (r.status === 'matched') {
          return r.studentId;
        }

        if (r.status === 'ambiguous') {
          return resolved.get(r.index);
        }

        return undefined;
      })
      .filter((id): id is string => typeof id === 'string');

    return Array.from(new Set(ids));
  });

  protected readonly resolvedCount = computed(() => this.resolvedStudentIds().length);

  protected readonly canSubmit = computed(
    () => this.resolvedCount() > 0 && this.resolvedCount() <= this.remainingSlots(),
  );

  protected onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    this.processFile(file);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    this.processFile(file);
  }

  private processFile(file: File): void {
    const isCsv = file.name.toLowerCase().endsWith('.csv');
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const data = reader.result;
        if (!data) return;

        const workbook = isCsv
          ? XLSX.read(data as string, { type: 'string' })
          : XLSX.read(data as ArrayBuffer, { type: 'array' });

        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) return;

        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

        const items: BatchMatchItem[] = rows
          .slice(1)
          .map((row) => ({
            name: String(row[0] ?? '').trim(),
            school: String(row[1] ?? '').trim(),
          }))
          .filter((item) => item.name !== '' && item.school !== '');

        this.rawItems.set(items);
        this.matchResults.set([]);
        this.resolvedIds.set(new Map());
        this.overQuota.set(false);
        this.submitFailed.set(false);
        this.submitResult.set(null);
        this.loading.set(true);

        this.enrollmentsService.batchMatch(this.classId(), items).subscribe({
          next: (res) => {
            this.matchResults.set(res.results);
            this.loading.set(false);
            this.step.set(2);
          },
          error: () => {
            this.loading.set(false);
          },
        });
      } catch {
        this.loading.set(false);
      }
    };

    if (isCsv) {
      reader.readAsText(file, 'UTF-8');
    } else {
      reader.readAsArrayBuffer(file);
    }
  }

  protected resolveAmbiguous(index: number, studentId: string): void {
    const m = new Map(this.resolvedIds());
    m.set(index, studentId);
    this.resolvedIds.set(m);
  }

  protected onSubmit(): void {
    const studentIds = this.resolvedStudentIds();

    const input: BatchCreateInput = {
      classId: this.classId(),
      studentIds,
    };

    this.loading.set(true);
    this.overQuota.set(false);
    this.submitFailed.set(false);
    this.submitResult.set(null);
    this.step.set(3);

    this.enrollmentsService
      .batchCreate(input)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          const success = res.results.filter((r) => r.status === 'enrolled').length;
          const skipped = res.results.length - success;

          this.submitResult.set({ success, skipped });
          this.step.set(4);
        },
        error: (err: { error?: { code?: string } }) => {
          if (err?.error?.code === 'OVER_QUOTA') {
            this.overQuota.set(true);
          } else {
            this.submitFailed.set(true);
          }

          this.submitResult.set({ success: 0, skipped: 0 });
          this.step.set(4);
        },
      });
  }

  protected onClose(): void {
    this.ref.close();
  }

  protected onDone(): void {
    const success = this.submitResult()?.success ?? 0;
    this.ref.close(success > 0 && !this.overQuota() && !this.submitFailed() ? 'imported' : undefined);
  }

  protected candidateOptions(candidates?: BatchMatchCandidate[]): { label: string; value: string }[] {
    return (candidates ?? []).map((c) => ({
      label: this.buildCandidateLabel(c),
      value: c.id,
    }));
  }

  private buildCandidateLabel(c: BatchMatchCandidate): string {
    const parts: string[] = [c.name];
    const details: string[] = [];
    if (c.grade) details.push(c.grade);
    if (c.school) details.push(c.school);
    if (c.birthday) details.push(c.birthday);
    if (details.length > 0) parts.push(`（${details.join('・')}）`);
    return parts.join('');
  }
}
