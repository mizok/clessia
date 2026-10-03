import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';

import type { Campus } from '@core/campuses.service';
import { StaffService, type Staff } from '@core/staff.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

export interface KioskFormDialogData {
  campuses: Campus[];
  /** 有值＝編輯；只改得了名稱與分校（後端擋其他欄位，#1127） */
  staff?: Staff;
}

/** 關閉時交出去的：建立會帶 loginUrl（平板要掃它登入），編輯不帶 */
export interface KioskFormDialogResult {
  data: Staff;
  loginUrl?: string | null;
}

/**
 * 新增／編輯掃碼機台（#1127）。機台不是人：沒有 email、權限、科目，**只綁一個分校**
 * （綁兩個的機台打卡時會被 403，所以這裡就是單選）。
 */
@Component({
  selector: 'app-kiosk-form-dialog',
  imports: [FormsModule, ButtonModule, InputTextModule, SelectModule, InlineNoticeComponent],
  templateUrl: './kiosk-form-dialog.component.html',
})
export class KioskFormDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject<DynamicDialogConfig<KioskFormDialogData>>(DynamicDialogConfig);
  private readonly staffService = inject(StaffService);

  private readonly existing = this.config.data?.staff ?? null;
  protected readonly isEditing = !!this.existing;
  protected readonly campusOptions = (this.config.data?.campuses ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }));

  protected readonly name = signal(this.existing?.displayName ?? '');
  protected readonly campusId = signal<string | null>(this.existing?.campusIds[0] ?? null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly canSave = computed(
    () => !!this.name().trim() && !!this.campusId() && !this.loading(),
  );

  protected save(): void {
    const displayName = this.name().trim();
    const campusId = this.campusId();
    if (!displayName || !campusId) return;

    this.loading.set(true);
    this.error.set(null);
    const done = (result: KioskFormDialogResult) => this.ref.close(result);
    const fail = (err: { error?: { error?: string } }) => {
      this.error.set(err.error?.error || '儲存失敗，請稍後再試');
      this.loading.set(false);
    };

    if (this.existing) {
      this.staffService
        .update(this.existing.id, { displayName, campusIds: [campusId] })
        .subscribe({ next: (res) => done({ data: res.data }), error: fail });
    } else {
      this.staffService
        .create({ displayName, campusIds: [campusId], roles: ['kiosk'] })
        .subscribe({
          next: (res) => done({ data: res.data, loginUrl: res.loginUrl }),
          error: fail,
        });
    }
  }

  protected cancel(): void {
    this.ref.close();
  }
}
