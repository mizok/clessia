import { Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import type { Permission } from '@core/staff.service';
import { PERMISSION_OPTIONS } from '../staff-form-dialog.component';

export interface PermissionListDialogData {
  staffName: string;
  permissions: readonly Permission[];
}

/**
 * 「權限 N 項」點開的**唯讀**清單（#1314 ST2）。只列這個人現有的權限（名稱＋一行說明），
 * 不給任何編輯入口 —— 改權限只走「編輯」表單，那條路徑（`manage_roles` 檢查、不能改自己）不動。
 * 詞彙取表單那一份 `PERMISSION_OPTIONS`，兩處不會各自漂移。
 */
@Component({
  selector: 'app-permission-list-dialog',
  standalone: true,
  imports: [ButtonModule],
  templateUrl: './permission-list-dialog.component.html',
})
export class PermissionListDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly data = inject(DynamicDialogConfig<PermissionListDialogData>).data!;

  protected readonly staffName = this.data.staffName;
  protected readonly items = PERMISSION_OPTIONS.filter((o) =>
    this.data.permissions.includes(o.value),
  );

  protected close(): void {
    this.ref.close();
  }
}
