import { Component, DestroyRef, OnInit, computed, inject, signal, input } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { DialogService } from 'primeng/dynamicdialog';
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
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '@shared/components/confirm-dialog/confirm-dialog.component';
import { AuthService } from '@core/auth.service';
import {
  GradePromotionsService,
  type GradePromotionRecord,
  type GradePromotionRevertResult,
} from '@core/grade-promotions.service';
import { GradePromotionDialogComponent } from './grade-promotion-dialog/grade-promotion-dialog.component';
import { SystemClockService } from '@core/system-clock.service';
import { SelectFieldComponent } from '@shared/components/select-field/select-field.component';
import { concat, defer, toArray } from 'rxjs';
import {
  PERIOD_TEMPLATES,
  periodsFromTemplate,
  type PeriodTemplateKey,
} from './period-templates.util';

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
    InputTextModule,
    LoadFailedComponent,
    SelectFieldComponent,
    RouterLink,
    DatePipe,
  ],
  templateUrl: './settings.page.html',
  providers: [DialogService],
})
export class SettingsPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly orgSettingsService = inject(OrgSettingsService);
  private readonly messageService = inject(MessageService);
  private readonly billingPeriodsService = inject(BillingPeriodsService);
  private readonly gradePromotions = inject(GradePromotionsService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly clock = inject(SystemClockService);

  /**
   * 學年升級（#1820）。升級日與提醒天數是機構設定（寫入門檻 `manage_org_settings`，同出勤模式）；
   * 預覽／執行／復原要 `manage_students`＋`all_campuses`（設計稿 §5 裁定 E）—— 沒有時只看得到設定欄位
   */
  protected readonly canPromote = computed(
    () => this.auth.hasPermission('manage_students') && this.auth.hasPermission('all_campuses'),
  );
  /** 輸入框顯示 `9/1`；存的是 `09-01` */
  protected gradePromotionDayValue = '9/1';
  protected gradePromotionReminderDaysValue = 7;
  protected readonly savingGradePromotion = signal(false);
  /** 最近一次執行（沒有復原的優先看）。`undefined`＝還沒讀到 */
  protected readonly lastPromotion = signal<GradePromotionRecord | null | undefined>(undefined);
  protected readonly promotionHistoryFailed = signal(false);
  protected readonly reverting = signal(false);
  /** 復原完的結果留在段內 —— 跳過的名單是行政接下來要處理的，不能跟著 toast 消失 */
  protected readonly revertResult = signal<GradePromotionRevertResult | null>(null);
  protected readonly studentPath = (id: string) =>
    RoutesCatalog.ADMIN_STUDENT_DETAIL.absolutePath.replace(':id', id);

  /** 「學年升級」段收起來時的摘要（A6：每年 9/1 · 前 7 天提醒） */
  protected readonly gradePromotionSummary = computed(() => {
    const s = this.settings();
    if (!s) return '';
    const day = this.toDisplayDay(s.gradePromotionMonthDay);
    const days = s.gradePromotionReminderDays;
    return `每年 ${day} · ${days > 0 ? `前 ${days} 天提醒` : '不提醒'}`;
  });

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
  /** 用模板建立（#1100 #35③，A6「用模板建立」）：選了直接建、日期之後到費用方案頁改 */
  protected readonly periodTemplates = PERIOD_TEMPLATES;
  protected readonly periodTemplatePick = signal<PeriodTemplateKey | null>(null);
  protected readonly creatingFromTemplate = signal(false);

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

  /** 兩段出勤設定收起時的摘要（#1882）：寫**存著的**值，不是還沒按儲存的選擇 */
  protected readonly attendanceModeSummary = computed(() => {
    const v = this.settings()?.attendanceMode;
    return this.attendanceModeOptions.find((o) => o.value === v)?.label ?? '';
  });
  protected readonly attendanceResponsibleSummary = computed(() => {
    const v = this.settings()?.attendanceResponsible;
    return this.attendanceResponsibleOptions.find((o) => o.value === v)?.label ?? '';
  });

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
        this.gradePromotionDayValue = this.toDisplayDay(s.gradePromotionMonthDay);
        this.gradePromotionReminderDaysValue = s.gradePromotionReminderDays;
        this.applicationReviewDaysValue = s.applicationReviewDays;
        this.trialFollowupDaysValue = s.trialFollowupDays;
        this.loading.set(false);
        if (this.canPromote()) this.loadPromotionHistory();
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
        // 分段鈕退回存著的值：不然畫面選著沒存成功的那個，摘要卻寫另一個（#1882）
        const saved = this.settings()?.attendanceMode;
        if (saved) this.attendanceModeValue = saved;
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
          const saved = this.settings()?.attendanceResponsible;
          if (saved) this.attendanceResponsibleValue = saved;
          this.savingResponsible.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '錯誤',
            detail: '儲存失敗，請稍後再試',
          });
        },
      });
  }

  /**
   * 報名流程（#1821，A6 kvSec「報名流程」）：申請放太久、試聽後還沒報名的提醒天數。不是財務設定，
   * 寫入門檻同出勤模式（`manage_org_settings`）。0＝關
   */
  protected applicationReviewDaysValue = 3;
  protected trialFollowupDaysValue = 1;
  protected readonly savingApplicationFlow = signal(false);
  protected readonly applicationFlowSummary = computed(() => {
    const s = this.settings();
    if (!s) return '';
    const days = (n: number, label: string) => (n > 0 ? `${label} ${n} 天` : `${label}不提醒`);
    return `${days(s.applicationReviewDays, '審核')} · ${days(s.trialFollowupDays, '試聽跟進')}`;
  });

  protected saveApplicationFlow(): void {
    this.savingApplicationFlow.set(true);
    this.orgSettingsService
      .updateSettings({
        applicationReviewDays: this.applicationReviewDaysValue,
        trialFollowupDays: this.trialFollowupDaysValue,
      })
      .subscribe({
        next: (s) => {
          this.settings.set(s);
          this.applicationReviewDaysValue = s.applicationReviewDays;
          this.trialFollowupDaysValue = s.trialFollowupDays;
          this.savingApplicationFlow.set(false);
          this.messageService.add({
            severity: 'success',
            summary: '已儲存',
            detail: '報名流程設定已更新',
          });
        },
        error: () => {
          this.savingApplicationFlow.set(false);
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

  /**
   * 同名的略過（同 org 不得同名，開帳時行政用名字認期間）；一筆一筆建，中途失敗就停，
   * 說清楚建了幾個 —— 不能讓人以為整組都沒建、再按一次又建一份
   */
  protected createFromTemplate(key: PeriodTemplateKey | null): void {
    this.periodTemplatePick.set(key);
    if (!key || this.creatingFromTemplate()) return;
    const label = PERIOD_TEMPLATES.find((t) => t.value === key)!.label;
    const existing = new Set((this.periods() ?? []).map((p) => p.name));
    const all = periodsFromTemplate(key, this.clock.todayTaipei());
    const todo = all.filter((p) => !existing.has(p.name));
    const skipped = all.length - todo.length;
    const done = () => {
      this.creatingFromTemplate.set(false);
      this.periodTemplatePick.set(null);
      this.loadPeriods();
    };
    if (todo.length === 0) {
      this.messageService.add({ severity: 'info', summary: `「${label}」的週期都已經有了` });
      done();
      return;
    }
    this.creatingFromTemplate.set(true);
    concat(...todo.map((p) => defer(() => this.billingPeriodsService.create(p))))
      .pipe(toArray(), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.messageService.add({
            severity: 'success',
            summary: `已用「${label}」建立 ${rows.length} 個週期，日期可以再改`,
            detail: skipped ? `略過 ${skipped} 個同名的` : undefined,
          });
          done();
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '建立失敗',
            detail: '有一部分可能已經建好了，請看下面的週期清單再決定要不要重試',
          });
          done();
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

  /** `09-01` → `9/1` */
  private toDisplayDay(monthDay: string): string {
    const [m, d] = monthDay.split('-').map(Number);
    return `${m}/${d}`;
  }

  /** `9/1`、`09/01`、`9-1` → `09-01`；不是真的日期（含 2/30）回 null。2/29 算合法（閏年才有，提醒只在那年發） */
  protected pendingGradePromotionDay(): string | null {
    const match = /^\s*(\d{1,2})\s*[/-]\s*(\d{1,2})\s*$/.exec(this.gradePromotionDayValue ?? '');
    if (!match) return null;
    const [m, d] = [Number(match[1]), Number(match[2])];
    // 用閏年驗：2/29 合法、2/30 不合法
    const date = new Date(2024, m - 1, d);
    if (m < 1 || m > 12 || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  protected saveGradePromotion(): void {
    const monthDay = this.pendingGradePromotionDay();
    if (monthDay === null) return;
    this.savingGradePromotion.set(true);
    this.orgSettingsService
      .updateSettings({
        gradePromotionMonthDay: monthDay,
        gradePromotionReminderDays: this.gradePromotionReminderDaysValue,
      })
      .subscribe({
        next: (s) => {
          this.settings.set(s);
          this.gradePromotionDayValue = this.toDisplayDay(s.gradePromotionMonthDay);
          this.gradePromotionReminderDaysValue = s.gradePromotionReminderDays;
          this.savingGradePromotion.set(false);
          this.messageService.add({
            severity: 'success',
            summary: '已儲存',
            detail: '學年升級設定已更新',
          });
        },
        error: () => {
          this.savingGradePromotion.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '錯誤',
            detail: '儲存失敗，請稍後再試',
          });
        },
      });
  }

  protected loadPromotionHistory(): void {
    this.promotionHistoryFailed.set(false);
    this.gradePromotions.history().subscribe({
      // 最新一筆就是要看的：同學年只能有一筆沒復原的，而新的一定排最前
      next: (res) => this.lastPromotion.set(res.data[0] ?? null),
      error: () => {
        this.lastPromotion.set(undefined);
        this.promotionHistoryFailed.set(true);
      },
    });
  }

  protected openGradePromotion(): void {
    this.revertResult.set(null);
    const ref = this.dialogService.open(GradePromotionDialogComponent, {
      width: '560px',
      breakpoints: { '640px': '96%' },
      modal: true,
      showHeader: false,
      appendTo: 'body',
    });
    if (!ref) return;
    ref.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((executed?: boolean) => {
      if (executed) this.loadPromotionHistory();
    });
  }

  protected confirmRevert(record: GradePromotionRecord): void {
    const data: ConfirmDialogData = {
      message: `把 ${record.academicYear} 學年的升級復原：${record.studentCount} 位學生回到升級前的年級，畢業停用的恢復在讀。升級後年級被改過的學生不會動，復原完會列出來。`,
      acceptLabel: '復原',
      acceptSeverity: 'danger',
    };
    const ref = this.dialogService.open(ConfirmDialogComponent, {
      header: '復原學年升級',
      width: '420px',
      breakpoints: { '640px': '96%' },
      modal: true,
      appendTo: 'body',
      data,
    });
    if (!ref) return;
    ref.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((ok) => {
      if (ok) this.revert(record.id);
    });
  }

  private revert(id: string): void {
    this.reverting.set(true);
    this.gradePromotions.revert(id).subscribe({
      next: (r) => {
        this.reverting.set(false);
        this.revertResult.set(r);
        this.loadPromotionHistory();
      },
      error: (e: { error?: { error?: string } }) => {
        this.reverting.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '復原失敗',
          detail: e.error?.error ?? '沒有任何學生被改動，請稍後再試',
        });
      },
    });
  }
}
