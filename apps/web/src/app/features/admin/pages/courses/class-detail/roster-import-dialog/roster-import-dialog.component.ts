import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { format } from 'date-fns';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
/**
 * **`xlsx` 只在真的要解析檔案時才載入。** 靜態 import 的話，`class-detail.page.ts`
 * 靜態引用這個 dialog → 打開任何一個班級詳情就會下載 SheetJS 的 **337 kB
 * （傳輸 96 kB）**，而多數人進來只是看名單。
 */
type XLSXModule = typeof import('xlsx');

import {
  EnrollmentsService,
  type BatchMatchResultItem,
  type ScheduleConflictWarning,
} from '@core/enrollments.service';
import { SchoolsService } from '@core/schools.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

import {
  MAX_ROSTER_ROWS,
  matchSchoolNames,
  parseRosterSheet,
  type RosterRow,
  type SchoolMatch,
  type SchoolOption,
} from './roster-import.util';

type Step = 'upload' | 'schools' | 'review' | 'done';

interface ReviewRow {
  readonly row: RosterRow;
  readonly result: BatchMatchResultItem | null;
}

@Component({
  selector: 'app-roster-import-dialog',
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    DatePickerModule,
    SelectModule,
    TagModule,
    InlineNoticeComponent,
  ],
  templateUrl: './roster-import-dialog.component.html',
  styleUrl: './roster-import-dialog.component.scss',
})
export class RosterImportDialogComponent {
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly schoolsService = inject(SchoolsService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);

  private readonly classId: string = this.config.data?.classId ?? '';

  protected readonly maxRows = MAX_ROSTER_ROWS;
  protected readonly step = signal<Step>('upload');
  protected readonly dragging = signal(false);
  protected readonly busy = signal(false);

  protected readonly parseError = signal<string | null>(null);
  protected readonly submitError = signal<string | null>(null);
  protected readonly rows = signal<RosterRow[]>([]);

  protected readonly schoolMatches = signal<SchoolMatch[]>([]);
  /** 名單上的寫法 → 使用者選定的學校 id */
  protected readonly schoolChoice = signal<Record<string, string | null>>({});

  protected readonly matchResults = signal<BatchMatchResultItem[]>([]);
  /** 同名同校時使用者選定的學生 id，key 是列的 index */
  protected readonly ambiguousChoice = signal<Record<number, string>>({});

  protected readonly effectiveFrom = signal<Date>(new Date());
  protected readonly conflicts = signal<ScheduleConflictWarning[]>([]);
  protected readonly enrolledCount = signal(0);
  protected readonly skippedCount = signal(0);

  private schools: SchoolOption[] = [];

  protected readonly unresolvedSchools = computed(() =>
    this.schoolMatches().filter((match) => !this.schoolChoice()[match.input]),
  );

  protected readonly reviewRows = computed<ReviewRow[]>(() => {
    const results = this.matchResults();
    return this.rows().map((row, i) => ({ row, result: results[i] ?? null }));
  });

  /** 送得出去的學生：比對成功的，加上同名同校但已經選定的 */
  protected readonly selectedStudentIds = computed(() => {
    const chosen = this.ambiguousChoice();
    const ids: string[] = [];
    for (const { row, result } of this.reviewRows()) {
      if (!result) continue;
      if (result.status === 'matched' && result.studentId) ids.push(result.studentId);
      else if (result.status === 'ambiguous' && chosen[row.index]) ids.push(chosen[row.index]);
    }
    return ids;
  });

  protected readonly blockedCount = computed(
    () =>
      this.reviewRows().filter(
        ({ result }) => result?.status === 'not_found' || result?.status === 'already_enrolled',
      ).length,
  );

  // ── 步驟一：讀檔 ──────────────────────────────────────────────────────
  protected onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.readFile(file);
    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.readFile(file);
  }

  private async readFile(file: File): Promise<void> {
    this.parseError.set(null);
    this.busy.set(true);

    try {
      const sheetRows = await this.parseWorkbook(file);
      const parsed = parseRosterSheet(sheetRows);

      if (parsed.error) {
        this.parseError.set(parsed.error);
        return;
      }
      if (parsed.rows.length === 0) {
        this.parseError.set('這份檔案沒有讀到任何資料，請確認是否用了下載的範本');
        return;
      }

      this.rows.set(parsed.rows);
      this.loadSchools();
    } catch {
      this.parseError.set('檔案讀取失敗，請確認是 .xlsx 或 .csv');
    } finally {
      this.busy.set(false);
    }
  }

  private async parseWorkbook(file: File): Promise<unknown[][]> {
    const isCsv = file.name.toLowerCase().endsWith('.csv');
    // 使用者已經選了檔案才走到這裡 —— 這時候載入是安全的，也是唯一需要它的時刻
    const XLSX: XLSXModule = await import('xlsx');

    return new Promise<unknown[][]>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read failed'));
      reader.onload = () => {
        try {
          const workbook = isCsv
            ? // `raw: true` 跟家長匯入一致 —— CSV 沒有型別，不擋的話 xlsx 會替你推斷。
              // 目前這裡只讀姓名與學校（都是文字）所以還沒踩到，但同一個形狀
              // 在家長匯入是真的壞過（電話的前導零）
              XLSX.read(reader.result as string, { type: 'string', raw: true })
            : XLSX.read(reader.result as ArrayBuffer, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          resolve(
            sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) : [],
          );
        } catch (error) {
          reject(error);
        }
      };

      if (isCsv) reader.readAsText(file);
      else reader.readAsArrayBuffer(file);
    });
  }

  // ── 步驟二：學校對照 ──────────────────────────────────────────────────
  private loadSchools(): void {
    this.busy.set(true);
    this.schoolsService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.schools = res.data.map((school) => ({
            id: school.id,
            name: school.name,
            shortName: school.shortName,
          }));
          this.prepareSchoolStep();
          this.busy.set(false);
        },
        error: () => {
          this.busy.set(false);
          this.parseError.set('讀取學校清單失敗，請稍後再試');
        },
      });
  }

  private prepareSchoolStep(): void {
    const matches = matchSchoolNames(
      this.rows().map((row) => row.school),
      this.schools,
    );
    this.schoolMatches.set(matches);
    this.schoolChoice.set(
      Object.fromEntries(matches.map((match) => [match.input, match.resolvedId])),
    );

    // 全部都只有唯一解就不必打擾使用者
    if (matches.every((match) => match.resolvedId)) this.runMatch();
    else this.step.set('schools');
  }

  protected schoolOptions(match: SchoolMatch): Array<{ label: string; value: string }> {
    const source = match.candidates.length > 0 ? match.candidates : this.schools;
    return source.map((school) => ({ label: school.name, value: school.id }));
  }

  protected onSchoolChoice(input: string, schoolId: string | null): void {
    this.schoolChoice.set({ ...this.schoolChoice(), [input]: schoolId });
  }

  // ── 步驟三：比對名單 ──────────────────────────────────────────────────
  protected runMatch(): void {
    const nameById = new Map(this.schools.map((school) => [school.id, school.name]));
    const choice = this.schoolChoice();

    const items = this.rows().map((row) => ({
      name: row.name,
      // 送正規化後的全名 —— 後端是拿 schools.name 完全相符去查的
      school: nameById.get(choice[row.school] ?? '') ?? row.school,
    }));

    this.busy.set(true);
    this.submitError.set(null);
    this.enrollmentsService
      .batchMatch(this.classId, items)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.matchResults.set(res.results);
          this.ambiguousChoice.set({});
          this.step.set('review');
          this.busy.set(false);
        },
        error: () => {
          this.busy.set(false);
          this.submitError.set('比對失敗，請稍後再試');
        },
      });
  }

  protected candidateOptions(
    result: BatchMatchResultItem,
  ): Array<{ label: string; value: string }> {
    return (result.candidates ?? []).map((candidate) => ({
      label: `${candidate.name}（${candidate.grade}${candidate.birthday ? `・${candidate.birthday}` : ''}）`,
      value: candidate.id,
    }));
  }

  protected onCandidateChoice(index: number, studentId: string): void {
    this.ambiguousChoice.set({ ...this.ambiguousChoice(), [index]: studentId });
  }

  protected statusLabel(result: BatchMatchResultItem | null): string {
    switch (result?.status) {
      case 'matched':
        return '可匯入';
      case 'ambiguous':
        return '需要指定';
      case 'already_enrolled':
        return '已在班上';
      case 'not_found':
        return '查無此學生';
      default:
        return '—';
    }
  }

  // ── 送出 ──────────────────────────────────────────────────────────────
  protected submit(force = false): void {
    const studentIds = this.selectedStudentIds();
    if (studentIds.length === 0) return;

    this.busy.set(true);
    this.submitError.set(null);
    if (!force) this.conflicts.set([]);

    this.enrollmentsService
      .batchCreate({
        classId: this.classId,
        studentIds,
        skipConflictCheck: force,
        effectiveFrom: format(this.effectiveFrom(), 'yyyy-MM-dd'),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.enrolledCount.set(res.results.filter((r) => r.status === 'enrolled').length);
          this.skippedCount.set(res.results.filter((r) => r.status !== 'enrolled').length);
          this.step.set('done');
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.handleSubmitError(err);
        },
      });
  }

  protected submitForce(): void {
    this.submit(true);
  }

  private handleSubmitError(err: unknown): void {
    const body = (err as { error?: Record<string, unknown> })?.error ?? {};
    const code = body['code'];

    if (code === 'SCHEDULE_CONFLICT') {
      this.conflicts.set((body['warnings'] as ScheduleConflictWarning[]) ?? []);
      return;
    }

    if (code === 'OVER_QUOTA') {
      const quota = body['quota'];
      const current = body['currentActive'];
      const adding = body['adding'];
      this.submitError.set(
        quota === undefined
          ? '超過班級人數上限'
          : `這個班上限 ${quota} 人、目前 ${current} 人，這次要匯入 ${adding} 人。請先到班級設定調高上限，或減少匯入人數`,
      );
      return;
    }

    this.submitError.set('匯入失敗，請稍後再試');
  }

  protected weekdayLabel(weekday: number): string {
    return ['一', '二', '三', '四', '五', '六', '日'][weekday - 1] ?? String(weekday);
  }

  protected studentNameOf(studentId: string): string {
    for (const { row, result } of this.reviewRows()) {
      if (result?.studentId === studentId) return row.name;
      if (result?.status === 'ambiguous' && this.ambiguousChoice()[row.index] === studentId) {
        return row.name;
      }
    }
    return '該學生';
  }

  protected backToUpload(): void {
    this.rows.set([]);
    this.matchResults.set([]);
    this.parseError.set(null);
    this.submitError.set(null);
    this.conflicts.set([]);
    this.step.set('upload');
  }

  protected close(): void {
    this.ref.close(this.enrolledCount() > 0 ? 'imported' : undefined);
  }
}
