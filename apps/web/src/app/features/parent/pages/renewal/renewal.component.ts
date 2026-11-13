import { Component, computed, inject, input, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';

import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentRenewalService,
  type ParentRenewalItem,
  type ParentRenewalPreview,
} from '@core/parent-renewal.service';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '@shared/components/confirm-dialog/confirm-dialog.component';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { ChildScopeGateComponent } from '../../shared/child-scope-gate/child-scope-gate.component';
import { ChildSwitcherComponent } from '../../shared/child-switcher/child-switcher.component';
import {
  RENEWAL_KIND_LABELS,
  RenewalRequestDialogComponent,
} from './renewal-request-dialog.component';

/**
 * 家長端續課資訊（A6 p-renewal，計畫席 10-22 裁定範圍；規格 specs/parent/renewal.md）。
 *
 * - 一次看一個孩子（共用切換器），列下期會續的**期繳**課（API #1121）
 * - **不畫**自動開單日（系統沒有自動開單，#1121），偏離登記在 R5
 * - 申請異動與「異動處理中」照稿（#1122）；處理中多一顆「撤回申請」（gate Q2 (b)，稿沒畫，R5）
 * - 任一列金額待確認 → 合計不給數字，免得家長把少算的數字當總額
 */

type State =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; preview: ParentRenewalPreview };

const WEEKDAY = ['', '一', '二', '三', '四', '五', '六', '日'];

@Component({
  selector: 'app-renewal',
  standalone: true,
  imports: [
    PageOpenComponent,
    ChildSwitcherComponent,
    ChildScopeGateComponent,
    RouterLink,
    RenewalRequestDialogComponent,
  ],
  providers: [DialogService],
  templateUrl: './renewal.component.html',
})
export class RenewalComponent {
  readonly page = input.required<RouteObj>();

  private readonly api = inject(ParentRenewalService);
  private readonly childScope = inject(ChildScopeService);
  private readonly dialogs = inject(DialogService);
  private readonly messages = inject(MessageService);
  private readonly requestDialog = viewChild.required(RenewalRequestDialogComponent);
  /** 送出或撤回之後重抓 */
  private readonly reload = new BehaviorSubject<void>(undefined);
  protected readonly kindLabels = RENEWAL_KIND_LABELS;

  protected readonly childName = computed(() => this.childScope.activeChild()?.name ?? null);

  constructor() {
    this.childScope.load();
  }

  protected readonly state = toSignal(
    combineLatest([toObservable(this.childScope.activeChildId), this.reload]).pipe(
      switchMap(([id]) =>
        id
          ? this.api.preview(id).pipe(
              map((res): State => ({ kind: 'ready', preview: res.data })),
              catchError(() => of<State>({ kind: 'failed' })),
              startWith<State>({ kind: 'loading' }),
            )
          : of<State>({ kind: 'loading' }),
      ),
    ),
    { initialValue: { kind: 'loading' } as State },
  );

  protected readonly preview = computed(() => {
    const s = this.state();
    return s.kind === 'ready' ? s.preview : null;
  });
  protected readonly items = computed(() => this.preview()?.items ?? []);
  protected readonly pending = computed(() => this.preview()?.pendingRequest ?? null);
  /** 處理中那筆的班名（狀態條的小字） */
  protected readonly pendingClass = computed(() => {
    const p = this.pending();
    return p
      ? (this.items().find((i) => i.enrollmentId === p.enrollmentId)?.nextClassName ?? '')
      : '';
  });

  protected openRequest(): void {
    const child = this.childScope.activeChild();
    const period = this.preview()?.nextPeriod;
    if (!child || !period) return;
    this.requestDialog().open({ id: child.id, name: child.name }, this.items(), period.startDate);
  }

  protected onRequestClosed(saved: boolean): void {
    if (saved) this.reload.next();
  }

  protected withdraw(): void {
    const p = this.pending();
    if (!p) return;
    const data: ConfirmDialogData = {
      message: '撤回之後，下期會照常開單。要再調整可以重新申請。',
      acceptLabel: '撤回申請',
      rejectLabel: '不撤回',
    };
    this.dialogs
      .open(ConfirmDialogComponent, {
        header: '撤回異動申請？',
        width: 'var(--dlg-w-md)',
        modal: true,
        showHeader: false,
        data,
      })
      ?.onClose.subscribe((ok) => {
        if (!ok) return;
        this.api.withdrawRequest(p.id).subscribe({
          next: () => {
            this.messages.add({ severity: 'success', summary: '已撤回異動申請' });
            this.reload.next();
          },
          error: (err) =>
            this.messages.add({
              severity: 'error',
              summary: '撤回失敗',
              detail: err?.error?.error ?? '',
            }),
        });
      });
  }

  /** 任一列待確認 → null（合計改寫「部分金額待補習班確認」） */
  protected readonly total = computed(() => {
    const amounts = this.items().map((i) => i.estimatedAmount);
    return amounts.some((a) => a === null)
      ? null
      : amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0);
  });

  protected slots(item: ParentRenewalItem): string {
    return item.schedules
      .map((s) => `每週${WEEKDAY[s.weekday] ?? ''} ${s.startTime}–${s.endTime}`)
      .join('、');
  }

  protected meta(item: ParentRenewalItem): string {
    const teachers = item.teacherNames.length ? `${item.teacherNames.join('、')} 老師` : '';
    return [this.slots(item), teachers].filter(Boolean).join(' · ');
  }

  /** 送出時間（timestamptz）→ 台北的 `11/13`；直接切字串會拿到 UTC 那天 */
  protected sentOn(iso: string): string {
    return this.md(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(iso)),
    );
  }

  /** `2027-02-01` → `2/1` */
  protected md(iso: string): string {
    const [, m, d] = iso.split('-').map(Number);
    return `${m}/${d}`;
  }

  protected money(n: number): string {
    return n.toLocaleString('zh-TW');
  }
}
