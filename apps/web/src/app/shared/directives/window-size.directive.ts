import { Directive, ElementRef, inject, OnInit, input, HostListener } from '@angular/core';
import { DOCUMENT } from '@angular/common';

@Directive({
  selector: '[appWindowSize]',
  standalone: true,
})
export class WindowSizeDirective implements OnInit {
  readonly widthVar = input('--window-width');
  readonly heightVar = input('--window-height');

  private readonly elementRef = inject(ElementRef);
  private readonly document = inject(DOCUMENT);

  ngOnInit() {
    this.updateSize();
  }

  @HostListener('window:resize')
  onResize() {
    this.updateSize();
  }

  private updateSize() {
    const window = this.document.defaultView;
    if (!window) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    
    this.elementRef.nativeElement.style.setProperty(this.widthVar(), `${width}px`);
    this.elementRef.nativeElement.style.setProperty(this.heightVar(), `${height}px`);
  }
}
