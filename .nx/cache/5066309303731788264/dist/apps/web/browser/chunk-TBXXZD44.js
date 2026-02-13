import {
  Injectable,
  __spreadValues,
  setClassMetadata,
  signal,
  ɵɵdefineInjectable
} from "./chunk-YGF3CXFR.js";

// apps/web/src/app/core/captcha.service.ts
var CaptchaService = class _CaptchaService {
  scriptLoaded = signal(false, ...ngDevMode ? [{ debugName: "scriptLoaded" }] : []);
  constructor() {
    this.loadScript();
  }
  loadScript() {
    if (this.scriptLoaded())
      return;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.onload = () => this.scriptLoaded.set(true);
    document.head.appendChild(script);
  }
  render(container, siteKey, callback, options = {}) {
    if (!this.scriptLoaded()) {
      const interval = setInterval(() => {
        if (this.scriptLoaded()) {
          clearInterval(interval);
          this.render(container, siteKey, callback, options);
        }
      }, 100);
      return;
    }
    return window.turnstile?.render(container, __spreadValues({
      sitekey: siteKey,
      callback
    }, options));
  }
  reset(widgetId) {
    window.turnstile?.reset(widgetId);
  }
  static \u0275fac = function CaptchaService_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _CaptchaService)();
  };
  static \u0275prov = /* @__PURE__ */ \u0275\u0275defineInjectable({ token: _CaptchaService, factory: _CaptchaService.\u0275fac, providedIn: "root" });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(CaptchaService, [{
    type: Injectable,
    args: [{ providedIn: "root" }]
  }], () => [], null);
})();

export {
  CaptchaService
};
//# sourceMappingURL=chunk-TBXXZD44.js.map
