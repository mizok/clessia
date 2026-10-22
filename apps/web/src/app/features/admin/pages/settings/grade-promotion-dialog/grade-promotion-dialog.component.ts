import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import type { HttpErrorResponse } from '@angular/common/http';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { GRADE_LEVEL_LABELS, type GradeLevel } from '@core/students.service';
import {
  GradePromotionsService,
  type GradePromotionPreview,
  type GradePromotionResult,
} from '@core/grade-promotions.service';
import { LoadFailedComponent } from '@shared/components/load-failed/load-failed.component';

/**
 * 學年升級的預覽＋執行（#1820 設計稿 §2）。執行完同一個對話框換成完成畫面 ——
 * 「學校要更新」「高三還有在籍報名」兩份名單在完成時**更**要看得到（那是行政接下來的工作），
 * 所以沿用執行前讀到的預覽，不另外讀。關閉時回傳是否有執行，讓設定頁重讀紀錄。
 */
@Component({
  selector: 'app-grade-promotion-dialog',
  imports: [ButtonModule, RouterLink, LoadFailedComponent],
  templateUrl: './grade-promotion-dialog.component.html',
})
export class GradePromotionDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly service = inject(GradePromotionsService);

  protected readonly preview = signal<GradePromotionPreview | null>(null);
  protected readonly loadFailed = signal(false);
  protected readonly executing = signal(false);
  protected readonly result = signal<GradePromotionResult | null>(null);
  /** 執行失敗的訊息（409 已升過、500 整批回滾）—— 留在對話框裡，不用會消失的 toast */
  protected readonly executeError = signal<string | null>(null);

  protected readonly studentPath = (id: string) =>
    RoutesCatalog.ADMIN_STUDENT_DETAIL.absolutePath.replace(':id', id);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loadFailed.set(false);
    this.preview.set(null);
    this.service.preview().subscribe({
      next: (p) => this.preview.set(p),
      error: () => this.loadFailed.set(true),
    });
  }

  protected gradeLabel(grade: GradeLevel | null): string {
    return grade ? GRADE_LEVEL_LABELS[grade] : '畢業';
  }

  /** 確認鈕與完成訊息共用一句後果（設計稿 §2：確認鈕寫死後果） */
  protected consequence(promoted: number, graduated: number): string {
    return [
      promoted > 0 ? `把 ${promoted} 位學生升一個年級` : '',
      graduated > 0 ? `${graduated} 位高三改成停用（畢業）` : '',
    ]
      .filter(Boolean)
      .join('；');
  }

  protected execute(): void {
    this.executing.set(true);
    this.executeError.set(null);
    this.service.execute().subscribe({
      next: (r) => {
        this.result.set(r);
        this.executing.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.executing.set(false);
        this.executeError.set(
          (e.error as { error?: string } | null)?.error ?? '學年升級失敗，沒有任何學生被改動',
        );
      },
    });
  }

  protected close(): void {
    this.ref.close(this.result() !== null);
  }
}
