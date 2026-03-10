import { Directive, ElementRef, OnDestroy, OnInit, inject } from '@angular/core';
import { OverlayContainerService } from '@core/overlay-container.service';

/**
 * 標記用 Directive，用於在 Template 中標識 Overlay 容器元件。
 * 提供 `nativeHTMLElement` 外，現在也將其註冊到全域的 `OverlayContainerService`
 * 供其他對話框與自訂元件在無法順利拿到本 directive 時可以從 service 中讀取。
 */
@Directive({
  selector: '[appOverlayContainer]',
  standalone: true,
})
export class OverlayContainerDirective implements OnInit, OnDestroy {
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly overlayContainerService = inject(OverlayContainerService);

  get nativeHTMLElement(): HTMLElement {
    return this.el.nativeElement;
  }

  ngOnInit(): void {
    this.overlayContainerService.registerContainer(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.overlayContainerService.clearContainer();
  }
}
