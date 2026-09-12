import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { ChildScopeService } from '@core/child-scope.service';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

/**
 * 家長端「依賴孩子」那幾頁的入口閘（#749）。
 *
 * **問題不是空白，是正面斷言一件不存在的事。** 一個還沒被綁上任何學生的家長，
 * 在 `/parent/attendance` 看到的是逐日清單、每一天印「今日無課」，
 * 在 `/parent/payments` 看到「目前沒有帳單紀錄」——
 * **家長合理的解讀是「一切正常，最近沒事」**，而實際是「這個帳號還沒綁孩子」。
 * 兩者的下一步完全不同：前者什麼都不用做，後者要打電話給補習班。
 *
 * **為什麼是一支共用元件而不是逐頁改文案**：四頁各自改會長出四種說法，
 * 而這句話是同一件事。規則與措辭都住在這裡。
 *
 * **只給依賴孩子的頁面用** —— `/parent/notifications` 不吃 `childId`
 * （公告是發給全體家長的），沒有孩子照樣該看得到，所以它不包這一層。
 */
@Component({
  selector: 'app-child-scope-gate',
  imports: [EmptyStateComponent],
  template: `
    @if (noChildren()) {
      <app-empty-state
        icon="pi pi-user-plus"
        title="這個帳號還沒有綁定任何學生"
        description="請聯絡補習班櫃檯協助綁定，綁定之後這裡就會出現孩子的紀錄。"
      />
    } @else {
      <ng-content />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChildScopeGateComponent {
  private readonly childScope = inject(ChildScopeService);

  /**
   * **`status === 'ready'` 不能省。**
   *
   * `children()` 在載入完成之前也是空陣列 —— 只看長度的話，
   * **每一次進頁都會先閃一下「你沒有綁定學生」再變回正常**，
   * 那對有孩子的家長也說謊，比原本的缺陷更糟。
   *
   * **`failed` 也不算** —— `ChildScopeService` 的註解明講「讀不到」跟「沒有」
   * 必須分開：讀不到的時候說「你沒有綁定學生」是把不知道講成確定。
   * 那條路已經有自己的紅色徽章（見 `ChildSwitcherComponent`）。
   */
  protected readonly noChildren = computed(
    () => this.childScope.status() === 'ready' && this.childScope.children().length === 0,
  );
}
