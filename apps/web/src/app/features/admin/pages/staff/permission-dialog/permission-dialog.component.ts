import { Component, computed, inject, signal } from '@angular/core';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { AuthService } from '@core/auth.service';
import {
  PERMISSIONS,
  StaffService,
  WILDCARD_PERMISSION,
  type HeldPermission,
  type Permission,
  type Staff,
} from '@core/staff.service';
import { DialogFrameComponent } from '@shared/components/dialog-frame/dialog-frame.component';
import { PERMISSION_OPTIONS } from '../staff-form-dialog.component';
import { cannotGrant, permissionLock, type Requester } from '../permission-rules';

export interface PermissionDialogData {
  staff: Staff;
}

/**
 * 「權限設定」（#1314 ST2／ST3／ST8，A6 `staff.html:240-244`）：列上的「權限 N 項」與列尾「⋯ → 權限設定」開這支。
 * 寫入走既有的 `PUT /api/staff/:id`、**只帶 `permissions`**（API「只改權限」那條路，`checkRoleAssignment` 照擋）。
 * 改自己、沒有 `manage_roles` 時整張停用並寫原因、沒有儲存鈕；規則見 `permission-rules.ts`。
 * 外框是共用殼 `app-dialog-frame`（#2290，kb/wiki/architecture/dialog-frame.md）。
 */
@Component({
  selector: 'app-permission-dialog',
  standalone: true,
  imports: [DialogFrameComponent],
  templateUrl: './permission-dialog.component.html',
})
export class PermissionDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly staffService = inject(StaffService);
  private readonly messageService = inject(MessageService);
  private readonly auth = inject(AuthService);
  protected readonly staff = inject(DynamicDialogConfig<PermissionDialogData>).data!.staff;

  private readonly me: Requester = {
    isSelf: this.auth.user()?.id === this.staff.userId,
    has: (p) => this.auth.hasPermission(p),
  };
  protected readonly options = PERMISSION_OPTIONS;
  protected readonly lock = permissionLock(this.me, this.staff.permissions);
  protected readonly selected = signal<HeldPermission[]>([...this.staff.permissions]);
  protected readonly saving = signal(false);
  private readonly all = computed(() => this.selected().includes(WILDCARD_PERMISSION));

  protected checked(p: Permission): boolean {
    return this.all() || this.selected().includes(p);
  }

  /** 不能勾上的原因（已勾的可以取消，所以只在沒勾時算） */
  protected grantBlock(p: Permission): string | null {
    return this.checked(p) ? null : cannotGrant(this.me, p);
  }

  protected toggle(p: Permission, on: boolean): void {
    // 從 `*` 取消一項：展開成逐項清單再拿掉（同編輯表單 #1829）
    const current = this.all() ? [...PERMISSIONS] : this.selected();
    this.selected.set(on ? [...current, p] : current.filter((x) => x !== p));
  }

  protected save(): void {
    if (this.lock || this.saving()) return;
    this.saving.set(true);
    this.staffService.update(this.staff.id, { permissions: this.selected() }).subscribe({
      next: (res) => {
        this.messageService.add({
          severity: 'success',
          summary: `已更新 ${this.staff.displayName} 的權限`,
        });
        this.ref.close(res.data);
      },
      error: (err) => {
        this.messageService.add({
          severity: 'error',
          summary: '權限沒有更新',
          detail: err.error?.error || '請稍後再試',
        });
        this.saving.set(false);
      },
    });
  }

  protected close(): void {
    this.ref.close();
  }
}
