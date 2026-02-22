import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CaptchaService {
  private scriptLoaded = signal(false);

  constructor() {
    this.loadScript();
  }

  private loadScript() {
    if (this.scriptLoaded()) return;

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    script.onload = () => this.scriptLoaded.set(true);
    document.head.appendChild(script);
  }

  render(
    container: HTMLElement,
    siteKey: string,
    callback: (token: string) => void,
    options: any = {},
  ): string | undefined {
    if (!this.scriptLoaded()) {
      // Retry after script load
      const interval = setInterval(() => {
        if (this.scriptLoaded()) {
          clearInterval(interval);
          this.render(container, siteKey, callback, options);
        }
      }, 100);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).turnstile?.render(container, {
      sitekey: siteKey,
      callback: callback,
      ...options,
    });
  }

  reset(widgetId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).turnstile?.reset(widgetId);
  }
}
