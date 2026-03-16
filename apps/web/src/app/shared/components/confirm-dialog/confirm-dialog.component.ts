import { Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';

export interface ConfirmDialogData {
  message: string;
  acceptLabel?: string;
  rejectLabel?: string;
  acceptSeverity?: 'danger' | 'warn' | 'success' | 'secondary';
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [ButtonModule],
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
})
export class ConfirmDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  protected readonly config = inject(DynamicDialogConfig<ConfirmDialogData>);

  protected get data(): ConfirmDialogData {
    return this.config.data;
  }

  protected accept(): void {
    this.ref.close(true);
  }

  protected reject(): void {
    this.ref.close(false);
  }
}
