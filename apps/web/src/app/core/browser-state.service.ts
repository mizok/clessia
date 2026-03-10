import { isPlatformBrowser } from '@angular/common';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Injectable, PLATFORM_ID, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

export interface BrowserStateSnapshot {
  readonly isMobile: boolean;
  readonly isIOS: boolean;
  readonly isAndroid: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class BrowserStateService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly destroyRef = inject(DestroyRef);

  private readonly mobileSignal = signal(false);
  private readonly iosSignal = signal(false);
  private readonly androidSignal = signal(false);

  readonly isMobile = computed(() => this.mobileSignal());
  readonly isIOS = computed(() => this.iosSignal());
  readonly isAndroid = computed(() => this.androidSignal());
  readonly snapshot = computed<BrowserStateSnapshot>(() => ({
    isMobile: this.isMobile(),
    isIOS: this.isIOS(),
    isAndroid: this.isAndroid(),
  }));

  constructor() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const userAgent = globalThis.navigator.userAgent ?? '';
    const platform = globalThis.navigator.platform ?? '';
    const maxTouchPoints = globalThis.navigator.maxTouchPoints ?? 0;
    const isIOSDevice =
      /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);

    this.iosSignal.set(isIOSDevice);
    this.androidSignal.set(/Android/i.test(userAgent));

    this.breakpointObserver
      .observe([Breakpoints.Handset])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        this.mobileSignal.set(result.matches);
      });
  }
}
