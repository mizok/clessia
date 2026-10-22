import { Component, OnInit, computed, inject, signal, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { MessageService } from 'primeng/api';
import { RouteObj, RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { BillingPeriodsService, type BillingPeriodListItem } from '@core/billing-periods.service';
import {
  OrgSettingsService,
  type AttendanceMode,
  type AttendanceResponsible,
  type OrgSettings,
  type UpdateOrgSettingsInput,
} from '@core/org-settings.service';
import { LoadFailedComponent } from '@shared/components/load-failed/load-failed.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    FormsModule,
    SelectButtonModule,
    ButtonModule,
    SkeletonModule,
    TextareaModule,
    InputNumberModule,
    LoadFailedComponent,
    RouterLink,
  ],
  templateUrl: './settings.page.html',
})
export class SettingsPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly orgSettingsService = inject(OrgSettingsService);
  private readonly messageService = inject(MessageService);
  private readonly billingPeriodsService = inject(BillingPeriodsService);

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

  /**
   * 預設繳費期限（開帳時 due_date 的預設天數，`invoice_due_days`）。#1314 SE2a 之前**沒有畫面能改**，
   * A6「繳費」段的第一欄。財務設定，同帳戶資訊
   */
  protected invoiceDueDaysValue = 14;

  /**
   * 學期與繳費週期（#1314 SE2a，A6「學期與繳費週期」段）。這裡**只列**，增刪改在費用方案頁 ——
   * 那裡已經有表單與刪除規則（被帳單明細引用的不能刪），不在兩個地方各做一份。
   * `null`＝還沒讀到；讀失敗另外記，不能讓「沒有週期」的空態冒出來
   */
  protected readonly periods = signal<BillingPeriodListItem[] | null>(null);
  protected readonly periodsFailed = signal(false);
  protected readonly feeTemplatesPath = RoutesCatalog.ADMIN_FEE_TEMPLATES.absolutePath;

  /**
   * 有財務權限 —— API 只把財務欄位回給有 `manage_finance` 的人（沒有時是 key 不存在，不是 0）。
   * 「繳費」與「週期」兩段都跟著它
   */
  protected readonly hasFinance = computed(() => {
    const s = this.settings();
    return (
      !!s &&
      [
        s.invoiceDueDays,
        s.billingReminderDays,
        s.leaveWaiverDays,
        s.invoiceReminderOffsets,
        s.paymentInfo,
      ].some((v) => v !== undefined)
    );
  });

  /** 「繳費」段收起來時的摘要（A6 `.coll__m`）：期限＋家長提醒時間點 */
  protected readonly financeSummary = computed(() => {
    const due = this.settings()?.invoiceDueDays;
    const offsets = this.settings()?.invoiceReminderOffsets ?? [];
    // A6 的語序是「到期前 3 天提醒」；這裡時間點可以有好幾個，用頓號接
    const remind = offsets.length
      ? `${offsets.map((o) => this.reminderLabel(o)).join('、')}提醒`
      : '不推播提醒';
    return due === undefined ? remind : `期限 ${due} 天 · ${remind}`;
  });

  /** #1732：連續請假可不收費的門檻。財務設定，同上 */
  protected leaveWaiverDaysValue = 3;

  /**
   * #1660：家長繳費提醒時間點（負＝到期前、0＝當天、正＝逾期第 N 天）。同帳戶資訊：只在回應帶了這個 key
   * （有財務權限）時畫。範圍跟 API／DB 的限制同一組：最多 6 個、到期前 0–30 天、逾期 1–60 天
   */
  protected readonly reminderOffsets = signal<number[]>([]);
  protected readonly savingReminderOffsets = signal(false);
  protected newReminderDirection: 'before' | 'after' = 'before';
  protected newReminderDays = 3;
  protected readonly reminderMaxCount = 6;
  protected readonly reminderDirectionOptions = [
    { label: '到期前', value: 'before' },
    { label: '逾期', value: 'after' },
  ];

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
        this.leaveWaiverDaysValue = s.leaveWaiverDays ?? 3;
        this.reminderOffsets.set(s.invoiceReminderOffsets ?? []);
        this.invoiceDueDaysValue = s.invoiceDueDays ?? 14;
        this.loading.set(false);
        // 週期是財務資料（API 要 manage_finance）：回應帶了財務欄位才讀，否則整段不畫
        if (this.hasFinance()) this.loadPeriods();
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

  /** 「繳費」段的數字欄位（A6 kv）共用一顆儲存 */
  protected readonly savingFinanceBasics = signal(false);

  /**
   * 「繳費」段 kv 的三欄一起存（A6 一段一顆儲存）。**只送回應裡有的 key** —— 畫面沒畫的欄位
   * 不能拿預設值寫回去（同 #805 的理由）
   */
  protected saveFinanceBasics(): void {
    const s = this.settings();
    const input: UpdateOrgSettingsInput = {};
    if (s?.invoiceDueDays !== undefined) input.invoiceDueDays = this.invoiceDueDaysValue;
    if (s?.billingReminderDays !== undefined)
      input.billingReminderDays = this.billingReminderDaysValue;
    if (s?.leaveWaiverDays !== undefined) input.leaveWaiverDays = this.leaveWaiverDaysValue;
    this.savingFinanceBasics.set(true);
    this.orgSettingsService.updateSettings(input).subscribe({
      next: (saved) => {
        this.settings.set(saved);
        this.invoiceDueDaysValue = saved.invoiceDueDays ?? 14;
        this.billingReminderDaysValue = saved.billingReminderDays ?? 14;
        this.leaveWaiverDaysValue = saved.leaveWaiverDays ?? 3;
        this.savingFinanceBasics.set(false);
        this.messageService.add({
          severity: 'success',
          summary: '已儲存',
          detail: '繳費設定已更新',
        });
      },
      error: () => {
        this.savingFinanceBasics.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '錯誤',
          detail: '儲存失敗，請稍後再試',
        });
      },
    });
  }

  protected loadPeriods(): void {
    this.periodsFailed.set(false);
    this.billingPeriodsService.list().subscribe({
      next: (res) =>
        this.periods.set([...res.data].sort((a, b) => b.startDate.localeCompare(a.startDate))),
      error: () => {
        this.periods.set(null);
        this.periodsFailed.set(true);
      },
    });
  }

  protected reminderLabel(offset: number): string {
    if (offset < 0) return `到期前 ${-offset} 天`;
    if (offset === 0) return '到期當天';
    return `逾期第 ${offset} 天`;
  }

  /** 表單上「到期前／逾期 N 天」換成存的值；不合法（範圍外、重複、已滿）回 null */
  protected pendingReminderOffset(): number | null {
    const days = Math.trunc(this.newReminderDays ?? NaN);
    const before = this.newReminderDirection === 'before';
    if (!Number.isFinite(days) || days < (before ? 0 : 1) || days > (before ? 30 : 60)) return null;
    const offset = before ? -days : days;
    const current = this.reminderOffsets();
    if (current.length >= this.reminderMaxCount || current.includes(offset)) return null;
    return offset;
  }

  protected addReminderOffset(): void {
    const offset = this.pendingReminderOffset();
    if (offset === null) return;
    this.reminderOffsets.update((xs) => [...xs, offset].sort((a, b) => a - b));
  }

  protected removeReminderOffset(offset: number): void {
    this.reminderOffsets.update((xs) => xs.filter((x) => x !== offset));
  }

  protected saveReminderOffsets(): void {
    this.savingReminderOffsets.set(true);
    this.orgSettingsService
      .updateSettings({ invoiceReminderOffsets: this.reminderOffsets() })
      .subscribe({
        next: (s) => {
          this.settings.set(s);
          this.reminderOffsets.set(s.invoiceReminderOffsets ?? []);
          this.savingReminderOffsets.set(false);
          this.messageService.add({
            severity: 'success',
            summary: '已儲存',
            detail: '提醒時間點已更新',
          });
        },
        error: () => {
          this.savingReminderOffsets.set(false);
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
