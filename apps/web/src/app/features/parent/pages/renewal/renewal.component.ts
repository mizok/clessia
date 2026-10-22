import { Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentRenewalService,
  type ParentRenewalItem,
  type ParentRenewalPreview,
} from '@core/parent-renewal.service';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { ChildScopeGateComponent } from '../../shared/child-scope-gate/child-scope-gate.component';
import { ChildSwitcherComponent } from '../../shared/child-switcher/child-switcher.component';

/**
 * 家長端續課資訊（A6 p-renewal，計畫席 10-22 裁定範圍；規格 specs/parent/renewal.md）。
 *
 * - 一次看一個孩子（共用切換器），列下期會續的**期繳**課（API #1121）
 * - **不畫**稿上沒有行為的部分：自動開單日、申請異動與「異動處理中」（#1122），偏離登記在 R5
 * - 任一列金額待確認 → 合計不給數字，免得家長把少算的數字當總額
 */

type State =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; preview: ParentRenewalPreview };

const WEEKDAY = ['', '一', '二', '三', '四', '五', '六', '日'];

@Component({
  selector: 'app-renewal',
  standalone: true,
  imports: [PageOpenComponent, ChildSwitcherComponent, ChildScopeGateComponent, RouterLink],
  templateUrl: './renewal.component.html',
})
export class RenewalComponent {
  readonly page = input.required<RouteObj>();

  private readonly api = inject(ParentRenewalService);
  private readonly childScope = inject(ChildScopeService);

  protected readonly childName = computed(() => this.childScope.activeChild()?.name ?? null);

  constructor() {
    this.childScope.load();
  }

  protected readonly state = toSignal(
    toObservable(this.childScope.activeChildId).pipe(
      switchMap((id) =>
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

  /** `2027-02-01` → `2/1` */
  protected md(iso: string): string {
    const [, m, d] = iso.split('-').map(Number);
    return `${m}/${d}`;
  }

  protected money(n: number): string {
    return n.toLocaleString('zh-TW');
  }
}
