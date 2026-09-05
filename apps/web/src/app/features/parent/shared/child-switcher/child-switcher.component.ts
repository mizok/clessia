import { Component, computed, inject } from '@angular/core';
import { Popover } from 'primeng/popover';
import { ChildScopeService } from '@core/child-scope.service';

/**
 * 「目前在看哪個孩子」的切換器 —— 照抄 `shell-layout` 角色徽章＋popover 的互動形狀
 * （同一種問題：現在的 scope 是誰）。只有一個孩子時不渲染切換互動，直接顯示姓名。
 *
 * 這是家長端授權模型的第一個前端消費端，後面每一支家長頁的 scope 顯示都照它抄。
 */
@Component({
  selector: 'app-child-switcher',
  standalone: true,
  imports: [Popover],
  templateUrl: './child-switcher.component.html',
  styleUrl: './child-switcher.component.scss',
})
export class ChildSwitcherComponent {
  protected readonly childScope = inject(ChildScopeService);

  /** 徽章上點得到的選項 —— 目前這個孩子不列，點自己沒有意義 */
  protected readonly otherChildren = computed(() =>
    this.childScope.children().filter((c) => c.id !== this.childScope.activeChildId()),
  );

  protected select(id: string): void {
    this.childScope.setActiveChild(id);
  }
}
