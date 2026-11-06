import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TextareaModule } from 'primeng/textarea';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { DialogFrameComponent } from '@shared/components/dialog-frame/dialog-frame.component';

export interface ConfirmDialogData {
  message: string;
  acceptLabel?: string;
  rejectLabel?: string;
  /** false：只留主鈕（學校「它已經停用了」只是告知，沒有第二個選擇） */
  rejectVisible?: boolean;
  /** 不再影響顏色：A6 的確認主鈕一律是 cta（#2290）。留著讓既有呼叫端不用改 */
  acceptSeverity?: 'danger' | 'warn' | 'success' | 'secondary';
  requireNotes?: boolean;
  notesPlaceholder?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [DialogFrameComponent, FormsModule, TextareaModule],
  templateUrl: './confirm-dialog.component.html',
})
export class ConfirmDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  protected readonly config = inject(DynamicDialogConfig<ConfirmDialogData>);

  protected get data(): ConfirmDialogData {
    return this.config.data;
  }

  protected notes = '';

  protected get canAccept(): boolean {
    if (this.data.requireNotes) return this.notes.trim().length > 0;
    return true;
  }

  protected accept(): void {
    if (!this.canAccept) return;
    this.ref.close(this.data.requireNotes ? { notes: this.notes.trim() } : true);
  }

  /** 按次要鈕回 false；✕／Esc 回 undefined —— 次要鈕是第二個動作時（請假「完全刪除」）分得出來 */
  protected reject(): void {
    this.ref.close(false);
  }

  protected dismiss(): void {
    this.ref.close();
  }
}
