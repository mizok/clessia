import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ClassLogsService, type ClassLog } from '@core/class-logs.service';

/** 開啟這個面板需要的最小資料 —— 課堂卡上都有 */
export interface ClassLogSheetInput {
  readonly classId: string;
  readonly className: string;
  readonly logDate: string;
}

/**
 * 教務日誌撰寫面板（v1a）。設計見 `kb/wiki/architecture/teacher-class-log.md`。
 *
 * **沒有發布按鈕，而且不是 disabled** —— 發布不可逆，而下游（家長端可見、
 * LINE 推播）在 v1b 之前都不存在。灰著的按鈕仍然在承諾功能存在。
 */
@Component({
  selector: 'app-class-log-sheet',
  imports: [FormsModule, ButtonModule],
  templateUrl: './class-log-sheet.component.html',
  styleUrl: './class-log-sheet.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClassLogSheetComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly classLogs = inject(ClassLogsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly input = this.config.data as ClassLogSheetInput;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly loadError = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly teachingRecord = signal('');
  protected readonly homework = signal('');

  /**
   * 這一天**本來就有**日誌 —— 決定畫面說「編輯」還是「新增」。
   *
   * 同一班同一天可能有兩場課（`sessions` 唯一鍵含 `start_time`，
   * `class_logs` 不含），兩張卡會開到同一篇。第二場的老師必須知道
   * 自己在編輯既有內容，否則存檔就是覆蓋。
   */
  protected readonly existing = signal<ClassLog | null>(null);

  /** 兩欄都空、而且本來也沒有日誌 —— 沒有東西可存 */
  protected readonly nothingToSave = computed(
    () => !this.existing() && !this.teachingRecord().trim() && !this.homework().trim(),
  );

  constructor() {
    this.load();
  }

  private load(): void {
    this.classLogs
      .list({ classId: this.input.classId, from: this.input.logDate, to: this.input.logDate })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          // 一班一天一篇，所以最多一筆
          const log = res.data[0] ?? null;
          this.existing.set(log);
          this.teachingRecord.set(log?.teachingRecord ?? '');
          this.homework.set(log?.homework ?? '');
          this.loading.set(false);
        },
        error: () => {
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  protected save(): void {
    if (this.saving() || this.nothingToSave()) return;
    this.saving.set(true);
    this.saveError.set(null);

    this.classLogs
      .upsert({
        classId: this.input.classId,
        logDate: this.input.logDate,
        teachingRecord: this.teachingRecord(),
        homework: this.homework(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.ref.close(true),
        error: () => {
          this.saving.set(false);
          this.saveError.set('存檔失敗，請稍後再試。');
        },
      });
  }

  protected close(): void {
    this.ref.close(false);
  }
}
