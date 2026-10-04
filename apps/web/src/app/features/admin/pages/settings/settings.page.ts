import { Component, OnInit, inject, signal, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { SkeletonModule } from 'primeng/skeleton';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { MessageService } from 'primeng/api';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import {
  OrgSettingsService,
  type AttendanceMode,
  type AttendanceResponsible,
  type OrgSettings,
} from '@core/org-settings.service';
import { LoadFailedComponent } from '@shared/components/load-failed/load-failed.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    FormsModule,
    SelectButtonModule,
    ButtonModule,
    ToastModule,
    SkeletonModule,
    TextareaModule,
    InputNumberModule,
    LoadFailedComponent,
  ],
  providers: [MessageService],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly orgSettingsService = inject(OrgSettingsService);
  private readonly messageService = inject(MessageService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly settings = signal<OrgSettings | null>(null);
  protected readonly loadFailed = signal(false);
  /**
   * ngModel 需要一個初始值，而這個值**只在取數回來之前存在** ——
   * 模板的失敗態不渲染表單，所以它不再有機會被當成「讀到的值」存回去（#805）。
   */
  protected attendanceModeValue: AttendanceMode = 'per_session';

  /** 同 attendanceModeValue：只在取數回來之前存在，失敗態不渲染表單（#805） */
  protected attendanceResponsibleValue: AttendanceResponsible = 'admin';
  protected readonly savingResponsible = signal(false);

  /** #1073：帳戶資訊。只在回應帶了這個 key（有財務權限）時畫，見模板 */
  protected paymentInfoValue = '';
  protected readonly savingPaymentInfo = signal(false);

  /** #1305：待開單提醒天數。同帳戶資訊：只在回應帶了這個 key（有財務權限）時畫 */
  protected billingReminderDaysValue = 14;
  protected readonly savingBillingReminder = signal(false);

  protected readonly attendanceResponsibleOptions = [
    { label: '行政負責', value: 'admin' },
    { label: '老師負責', value: 'teacher' },
  ];

  protected readonly attendanceModeOptions = [
    { label: '隨堂點名', value: 'per_session' },
    { label: '日到班', value: 'daily_checkin' },
  ];

  ngOnInit(): void {
    this.loadSettings();
  }

  protected loadSettings(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.orgSettingsService.getSettings().subscribe({
      next: (s) => {
        this.settings.set(s);
        this.attendanceModeValue = s.attendanceMode;
        this.attendanceResponsibleValue = s.attendanceResponsible;
        this.paymentInfoValue = s.paymentInfo ?? '';
        this.billingReminderDaysValue = s.billingReminderDays ?? 14;
        this.loading.set(false);
      },
      // **不發 toast** —— 主體現在有常駐的失敗狀態；會消失的 toast + 留著的錯誤畫面
      // 是兩個互相矛盾的訊號（#788 的裁定，照 /admin/parents 的形狀）。
      error: () => {
        this.loadFailed.set(true);
        this.loading.set(false);
      },
    });
  }

  protected saveAttendanceMode(): void {
    this.saving.set(true);
    this.orgSettingsService.updateSettings({ attendanceMode: this.attendanceModeValue }).subscribe({
      next: (s) => {
        this.settings.set(s);
        this.saving.set(false);
        this.messageService.add({
          severity: 'success',
          summary: '已儲存',
          detail: '出勤模式已更新',
        });
      },
      error: () => {
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '錯誤',
          detail: '儲存失敗，請稍後再試',
        });
      },
    });
  }

  /** #920：點名責任歸屬。API 早就收這個欄位（`PATCH /api/org/settings`），之前只缺 UI */
  protected saveAttendanceResponsible(): void {
    this.savingResponsible.set(true);
    this.orgSettingsService
      .updateSettings({ attendanceResponsible: this.attendanceResponsibleValue })
      .subscribe({
        next: (s) => {
          this.settings.set(s);
          this.savingResponsible.set(false);
          this.messageService.add({
            severity: 'success',
            summary: '已儲存',
            detail: '點名責任歸屬已更新',
          });
        },
        error: () => {
          this.savingResponsible.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '錯誤',
            detail: '儲存失敗，請稍後再試',
          });
        },
      });
  }

  /** #1305：期的開始日前這麼多天，儀表板「待開單」就會出現（1–90） */
  protected saveBillingReminderDays(): void {
    this.savingBillingReminder.set(true);
    this.orgSettingsService
      .updateSettings({ billingReminderDays: this.billingReminderDaysValue })
      .subscribe({
        next: (s) => {
          this.settings.set(s);
          this.billingReminderDaysValue = s.billingReminderDays ?? 14;
          this.savingBillingReminder.set(false);
          this.messageService.add({
            severity: 'success',
            summary: '已儲存',
            detail: '提醒天數已更新',
          });
        },
        error: () => {
          this.savingBillingReminder.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '錯誤',
            detail: '儲存失敗，請稍後再試',
          });
        },
      });
  }

  /** #1073：家長待付款頁看到的帳戶資訊（機構預設；分校可在分校設定覆寫）。清空＝未設定 */
  protected savePaymentInfo(): void {
    this.savingPaymentInfo.set(true);
    this.orgSettingsService.updateSettings({ paymentInfo: this.paymentInfoValue }).subscribe({
      next: (s) => {
        this.settings.set(s);
        this.paymentInfoValue = s.paymentInfo ?? '';
        this.savingPaymentInfo.set(false);
        this.messageService.add({
          severity: 'success',
          summary: '已儲存',
          detail: '帳戶資訊已更新',
        });
      },
      error: () => {
        this.savingPaymentInfo.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '錯誤',
          detail: '儲存失敗，請稍後再試',
        });
      },
    });
  }
}
