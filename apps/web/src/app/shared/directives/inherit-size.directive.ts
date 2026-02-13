import { Directive, ElementRef, inject, OnDestroy, OnInit, Renderer2, input } from '@angular/core';

@Directive({
  selector: '[appInheritSize]',
  standalone: true,
})
export class InheritSizeDirective implements OnInit, OnDestroy {
  readonly widthVar = input('--inherited-width');
  readonly heightVar = input('--inherited-height');

  private readonly elementRef = inject(ElementRef);
  private readonly renderer = inject(Renderer2);
  private resizeObserver: ResizeObserver | null = null;

  ngOnInit() {
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.elementRef.nativeElement.style.setProperty(this.widthVar(), `${width}px`);
        this.elementRef.nativeElement.style.setProperty(this.heightVar(), `${height}px`);
      }
    });

    this.resizeObserver.observe(this.elementRef.nativeElement);
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }
}
