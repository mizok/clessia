import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { MessageService } from 'primeng/api';
import { focusScoreRow, scoreKeyStep } from '../score-keyboard.util';

import {
  AcademyExamsService,
  type AcademyExamDetail,
  type AcademyScore,
  type AcademyScoreStatus,
  type SaveAcademyScoresInput,
} from '@core/academy-exams.service';

export interface ScoreRow {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  score: number | null;
  status: AcademyScoreStatus;
  notes: string;
  /** 這名學生在本場考試中所屬的班級，可能多於一個（跨班報名） */
  classIds: string[];
  /** 原始快照，用於 dirty check */
  original: {
    score: number | null;
    status: AcademyScoreStatus;
    notes: string;
  };
}

const STATUS_OPTIONS: Array<{ label: string; value: AcademyScoreStatus }> = [
  { label: '正常', value: 'scored' },
  { label: '缺考', value: 'absent' },
  { label: '補考', value: 'makeup' },
];

@Component({
  selector: 'app-academy-score-editor',
  standalone: true,
  imports: [
    FormsModule,
    InputNumberModule,
    InputTextModule,
    SelectModule,
    ButtonModule,
    DrawerModule,
  ],
  templateUrl: './academy-score-editor.component.html',
  styleUrl: './academy-score-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcademyScoreEditorComponent implements OnInit {
  private static readonly GRADE_LABELS: Record<string, string> = {
    P1: '小一',
    P2: '小二',
    P3: '小三',
    P4: '小四',
    P5: '小五',
    P6: '小六',
    J1: '國一',
    J2: '國二',
    J3: '國三',
    S1: '高一',
    S2: '高二',
    S3: '高三',
  };

  readonly exam = input.required<AcademyExamDetail>();
  readonly examId = input.required<string>();
  readonly disabled = input(false);

  readonly dirtyChange = output<boolean>();
  readonly savingChange = output<boolean>();
  readonly saved = output<void>();

  private readonly academyExamsService = inject(AcademyExamsService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly loading = signal(true);
  protected readonly rows = signal<ScoreRow[]>([]);
  protected readonly classFilter = signal<string | null>(null);

  // Bottom sheet state
  protected sheetVisible = false;
  protected readonly sheetRow = signal<ScoreRow | null>(null);

  protected readonly classOptions = computed(() => {
    const exam = this.exam();
    if (!exam || exam.classes.length <= 1) return [];
    return [
      { label: '全部班級', value: null as string | null },
      ...exam.classes.map((c) => ({ label: c.className, value: c.classId as string | null })),
    ];
  });

  protected readonly filteredRows = computed(() => {
    const filter = this.classFilter();
    const all = this.rows();
    if (!filter) return all;
    // 學生可能跨班，所以用 includes 而不是相等比較 —— 否則跨班學生會在篩選時消失
    return all.filter((row) => row.classIds.includes(filter));
  });

  protected readonly isDirty = computed(() => {
    return this.rows().some((r) => this.isRowDirty(r));
  });

  /** 有幾筆還沒存。急迫性屬於整批，不屬於單一格 */
  protected readonly dirtyCount = computed(
    () => this.rows().filter((r) => this.isRowDirty(r)).length,
  );

  ngOnInit(): void {
    this.loadScores();
  }

  private loadScores(): void {
    this.loading.set(true);
    this.academyExamsService
      .getScores(this.examId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.rows.set(this.toScoreRows(data));
          this.loading.set(false);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入學生成績名單',
          });
          this.loading.set(false);
        },
      });
  }

  private toScoreRows(scores: AcademyScore[]): ScoreRow[] {
    return scores.map((s) => ({
      studentId: s.studentId,
      studentName: s.studentName,
      studentGrade: s.studentGrade,
      score: s.score,
      status: s.status,
      notes: s.notes ?? '',
      classIds: s.classIds,
      original: {
        score: s.score,
        status: s.status,
        notes: s.notes ?? '',
      },
    }));
  }

  protected onScoreChange(row: ScoreRow, value: number | null): void {
    row.score = value;
    this.notifyRowsChanged();
  }

  /**
   * 這張表長得像試算表，使用者也會這樣用它 —— 所以 `↑` `↓` `Enter` **一律是換列**。
   *
   * PrimeNG 的 `p-inputnumber` 預設拿 `↑` `↓` 加減數值。實走 demo 時我按 `↓` 想跳到
   * 下一列，它把分數從 90 改成 89，**沒有任何提示** —— 使用者以為自己在導覽，
   * 實際在編輯（charter 坑 11）。要加減有右側的 spinner 鈕，那是明確的手勢。
   *
   * 順帶解掉的：原本要按 **3 次 Tab**（分數 → 狀態 → 備註 → 下一列分數）才換一列，
   * 20 人的班就是 60 次。現在 1 次。
   */
  protected onScoreKeydown(event: KeyboardEvent, index: number): void {
    const step = scoreKeyStep(event);
    if (step === 0) return;
    // 一定要 preventDefault：不擋的話 PrimeNG 會在我們換完焦點之後**還是**改掉原本那格
    event.preventDefault();
    focusScoreRow(
      this.host.nativeElement as HTMLElement,
      index + step,
      step,
      this.filteredRows().length,
    );
  }

  protected onStatusChange(row: ScoreRow, value: AcademyScoreStatus): void {
    row.status = value;
    if (value === 'absent') {
      row.score = null;
    }
    this.notifyRowsChanged();
  }

  protected onNotesChange(row: ScoreRow, value: string): void {
    row.notes = value;
    this.notifyRowsChanged();
  }

  /** Force signal re-evaluation by creating a new array ref */
  private notifyRowsChanged(): void {
    this.rows.set([...this.rows()]);
    this.emitDirty();
  }

  protected openSheet(row: ScoreRow): void {
    this.sheetRow.set(row);
    this.sheetVisible = true;
  }

  protected isAbsent(row: ScoreRow): boolean {
    return row.status === 'absent';
  }

  protected formatGrade(grade: string | null): string {
    if (!grade) return '—';
    return AcademyScoreEditorComponent.GRADE_LABELS[grade] ?? grade;
  }

  save(): void {
    const dirtyRows = this.rows().filter(
      (r) => this.isRowDirty(r) && (r.score !== null || r.status !== 'scored'),
    );
    if (dirtyRows.length === 0) return;

    const input: SaveAcademyScoresInput[] = dirtyRows.map((r) => ({
      studentId: r.studentId,
      score: r.score,
      status: r.status,
      notes: r.notes.trim() || null,
    }));

    this.savingChange.emit(true);
    this.academyExamsService
      .saveScores(this.examId(), input)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ affected }) => {
          this.messageService.add({
            severity: 'success',
            summary: '儲存成功',
            detail: `已更新 ${affected} 筆成績`,
          });
          // 更新 original 快照。**改完一定要 set 一個新陣列** ——
          // `dirtyCount()` 是 computed，只認 signal 的參照；原地改 `r.original`
          // 不會讓它重算，結果就是存檔成功後「N 筆未儲存」還掛在標題上，
          // 而列首的 dirty 邊框（template 裡的方法呼叫，每輪 CD 都跑）卻清掉了 ——
          // 兩個訊號互相矛盾。實走 demo 抓到的。
          for (const r of this.rows()) {
            r.original = { score: r.score, status: r.status, notes: r.notes };
          }
          this.rows.set([...this.rows()]);
          this.savingChange.emit(false);
          this.emitDirty();
          this.saved.emit();
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '儲存失敗',
            detail: '無法儲存成績，請稍後再試',
          });
          this.savingChange.emit(false);
        },
      });
  }

  protected isRowDirty(row: ScoreRow): boolean {
    return (
      row.score !== row.original.score ||
      row.status !== row.original.status ||
      row.notes !== row.original.notes
    );
  }

  private emitDirty(): void {
    this.dirtyChange.emit(this.isDirty());
  }
}
