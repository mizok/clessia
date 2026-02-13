import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
  providedIn: 'root',
})
export class DeviceService {
  private readonly platformId = inject(PLATFORM_ID);

  private readonly _isTouchDevice = signal<boolean>(false);
  public readonly isTouchDevice = this._isTouchDevice.asReadonly();

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.checkDevice();
    }
  }

  private checkDevice(): void {
    // Standard touch device detection using media query
    const mql = window.matchMedia('(pointer: coarse)');
    this._isTouchDevice.set(mql.matches);

    // Watch for changes (e.g. switching to touch mode in DevTools)
    mql.addEventListener('change', (e) => {
      this._isTouchDevice.set(e.matches);
    });
  }
}
