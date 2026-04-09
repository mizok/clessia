import { type ConnectedPosition, Overlay, type OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import {
  ChangeDetectionStrategy,
  Component,
  type OnDestroy,
  type TemplateRef,
  ViewContainerRef,
  ViewEncapsulation,
  inject,
  input,
  viewChild,
} from '@angular/core';
import type { MenuItem } from 'primeng/api';

/**
 * 取代 PrimeNG p-menu[popup=true] 的替代方案。
 * 使用 Angular CDK Overlay 的 FlexibleConnectedPositionStrategy，
 * 內建 auto-flip：當預設位置（trigger 下方右對齊）空間不足時，
 * 會依序嘗試下列候選位置，挑第一個能完整顯示的：
 *   1. 下方右對齊（預設）
 *   2. 上方右對齊
 *   3. 下方左對齊
 *   4. 上方左對齊
 *
 * API 與 p-menu popup 一致：外部呼叫 toggle(event) 即可，不需要改 call site。
 */
const MENU_POSITIONS: ConnectedPosition[] = [
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
  { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
];

@Component({
  selector: 'app-popup-menu',
  standalone: true,
  templateUrl: './popup-menu.component.html',
  styleUrl: './popup-menu.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PopupMenuComponent implements OnDestroy {
  readonly model = input<readonly MenuItem[]>([]);

  protected readonly menuTemplate = viewChild.required<TemplateRef<unknown>>('menuTemplate');

  private readonly overlay = inject(Overlay);
  private readonly vcr = inject(ViewContainerRef);

  private overlayRef: OverlayRef | null = null;

  toggle(event: Event): void {
    if (this.overlayRef?.hasAttached()) {
      this.hide();
      return;
    }
    this.show(event);
  }

  show(event: Event): void {
    const trigger = (event.currentTarget ?? event.target) as HTMLElement | null;
    if (!trigger) {
      return;
    }

    this.hide();

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(trigger)
      .withPositions(MENU_POSITIONS)
      .withPush(true)
      .withViewportMargin(8);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
      panelClass: 'popup-menu__panel',
    });

    const portal = new TemplatePortal(this.menuTemplate(), this.vcr);
    this.overlayRef.attach(portal);

    // 點 backdrop 或按 Escape 關閉；overlayRef dispose 時訂閱會自動結束
    this.overlayRef.backdropClick().subscribe(() => this.hide());
    this.overlayRef.keydownEvents().subscribe((keyEvent) => {
      if (keyEvent.key === 'Escape') {
        this.hide();
      }
    });

    // 避免 click 冒泡到 document 導致剛開就被 backdrop 關掉
    event.stopPropagation?.();
  }

  hide(): void {
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
    }
  }

  protected itemClass(item: MenuItem): string {
    const classes = ['popup-menu__item'];
    if (item.disabled) {
      classes.push('popup-menu__item--disabled');
    }
    const extraClass = (item['itemClass'] ?? item.styleClass) as string | undefined;
    if (extraClass) {
      classes.push(extraClass);
    }
    return classes.join(' ');
  }

  protected handleItemClick(item: MenuItem, event: Event): void {
    if (item.disabled) {
      return;
    }
    this.hide();
    item.command?.({ originalEvent: event, item } as never);
  }

  ngOnDestroy(): void {
    this.hide();
  }
}
