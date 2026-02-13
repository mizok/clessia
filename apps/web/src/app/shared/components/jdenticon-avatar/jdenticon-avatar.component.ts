import { Component, Input, ElementRef, ViewChild, effect, afterNextRender } from '@angular/core';
import * as jdenticon from 'jdenticon';

@Component({
  selector: 'app-jdenticon-avatar',
  standalone: true,
  template: `
    <svg #svgIcon [attr.width]="size" [attr.height]="size" [attr.data-jdenticon-value]="value"></svg>
  `,
  styles: [`
    :host {
      display: inline-flex;
      border-radius: 50%;
      overflow: hidden;
    }
  `]
})
export class JdenticonAvatarComponent {
  @Input() value = 'Clessia';
  @Input() size = 40;

  @ViewChild('svgIcon') svgIcon!: ElementRef<SVGElement>;

  constructor() {
    afterNextRender(() => {
      this.updateAvatar();
    });
    
    effect(() => {
      // Reactively update when inputs change (though here they are standard inputs)
      // Since Inputs are not signals by default in this version (unless using input()), 
      // we rely on ngOnChanges or just recall update in a setter if needed.
      // But standard way with jdenticon is just letting it observe or manual update.
      // Let's use manual update for control.
      if (this.svgIcon) {
        this.updateAvatar();
      }
    });
  }

  ngOnChanges() {
    if (this.svgIcon) {
      this.updateAvatar();
    }
  }

  private updateAvatar() {
    if (this.svgIcon?.nativeElement) {
      jdenticon.update(this.svgIcon.nativeElement, this.value);
    }
  }
}
