import {
  CaptchaService
} from "./chunk-TBXXZD44.js";
import {
  DefaultValueAccessor,
  FormsModule,
  NgControlStatus,
  NgControlStatusGroup,
  NgForm,
  NgModel,
  RequiredValidator,
  ɵNgNoValidate
} from "./chunk-O45IAEUK.js";
import {
  AuthService
} from "./chunk-IDX5LEWH.js";
import {
  environment
} from "./chunk-WSLHL2JA.js";
import {
  RouterLink
} from "./chunk-NFVC465N.js";
import {
  Component,
  ViewChild,
  setClassMetadata,
  signal,
  ɵsetClassDebugInfo,
  ɵɵadvance,
  ɵɵconditional,
  ɵɵconditionalCreate,
  ɵɵdefineComponent,
  ɵɵdirectiveInject,
  ɵɵelement,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵgetCurrentView,
  ɵɵlistener,
  ɵɵloadQuery,
  ɵɵnextContext,
  ɵɵproperty,
  ɵɵqueryRefresh,
  ɵɵresetView,
  ɵɵrestoreView,
  ɵɵtext,
  ɵɵtextInterpolate1,
  ɵɵtwoWayBindingSet,
  ɵɵtwoWayListener,
  ɵɵtwoWayProperty,
  ɵɵviewQuery
} from "./chunk-YGF3CXFR.js";

// apps/web/src/app/features/public/pages/forgot-password/forgot-password.component.ts
var _c0 = ["turnstileContainer"];
function ForgotPasswordComponent_Conditional_12_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 9);
    \u0275\u0275element(1, "i", 10);
    \u0275\u0275text(2, " \u91CD\u8A2D\u9023\u7D50\u5DF2\u5BC4\u9001\uFF0C\u8ACB\u67E5\u6536\u4FE1\u7BB1 ");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "p", 11);
    \u0275\u0275text(4, "\u82E5\u60A8\u6C92\u6709\u63D0\u4F9B Email\uFF0C\u8ACB\u76F4\u63A5\u806F\u7E6B\u7BA1\u7406\u54E1\u91CD\u8A2D\u5BC6\u78BC\u3002");
    \u0275\u0275elementEnd();
  }
}
function ForgotPasswordComponent_Conditional_13_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 13);
    \u0275\u0275element(1, "i", 19);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r1 = \u0275\u0275nextContext(2);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1(" ", ctx_r1.error(), " ");
  }
}
function ForgotPasswordComponent_Conditional_13_Conditional_9_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275element(0, "i", 20);
    \u0275\u0275text(1, " \u5BC4\u9001\u4E2D... ");
  }
}
function ForgotPasswordComponent_Conditional_13_Conditional_10_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275element(0, "i", 21);
    \u0275\u0275text(1, " \u5BC4\u9001\u91CD\u8A2D\u9023\u7D50 ");
  }
}
function ForgotPasswordComponent_Conditional_13_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "form", 12);
    \u0275\u0275listener("ngSubmit", function ForgotPasswordComponent_Conditional_13_Template_form_ngSubmit_0_listener() {
      \u0275\u0275restoreView(_r1);
      const ctx_r1 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r1.onSubmit());
    });
    \u0275\u0275conditionalCreate(1, ForgotPasswordComponent_Conditional_13_Conditional_1_Template, 3, 1, "div", 13);
    \u0275\u0275elementStart(2, "div", 14)(3, "label", 15);
    \u0275\u0275text(4, "Email");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "input", 16);
    \u0275\u0275twoWayListener("ngModelChange", function ForgotPasswordComponent_Conditional_13_Template_input_ngModelChange_5_listener($event) {
      \u0275\u0275restoreView(_r1);
      const ctx_r1 = \u0275\u0275nextContext();
      \u0275\u0275twoWayBindingSet(ctx_r1.email, $event) || (ctx_r1.email = $event);
      return \u0275\u0275resetView($event);
    });
    \u0275\u0275elementEnd()();
    \u0275\u0275element(6, "div", 17, 0);
    \u0275\u0275elementStart(8, "button", 18);
    \u0275\u0275conditionalCreate(9, ForgotPasswordComponent_Conditional_13_Conditional_9_Template, 2, 0)(10, ForgotPasswordComponent_Conditional_13_Conditional_10_Template, 2, 0);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(11, "p", 11);
    \u0275\u0275text(12, "\u6C92\u6709 Email \u5E33\u865F\uFF1F\u8ACB\u806F\u7E6B\u7BA1\u7406\u54E1\u91CD\u8A2D\u5BC6\u78BC\u3002");
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r1 = \u0275\u0275nextContext();
    \u0275\u0275advance();
    \u0275\u0275conditional(ctx_r1.error() ? 1 : -1);
    \u0275\u0275advance(4);
    \u0275\u0275twoWayProperty("ngModel", ctx_r1.email);
    \u0275\u0275advance(3);
    \u0275\u0275property("disabled", ctx_r1.submitting() || !ctx_r1.email);
    \u0275\u0275advance();
    \u0275\u0275conditional(ctx_r1.submitting() ? 9 : 10);
  }
}
var ForgotPasswordComponent = class _ForgotPasswordComponent {
  auth;
  captcha;
  turnstileContainer;
  email = "";
  submitting = signal(false, ...ngDevMode ? [{ debugName: "submitting" }] : []);
  sent = signal(false, ...ngDevMode ? [{ debugName: "sent" }] : []);
  error = signal(null, ...ngDevMode ? [{ debugName: "error" }] : []);
  captchaToken = signal(null, ...ngDevMode ? [{ debugName: "captchaToken" }] : []);
  constructor(auth, captcha) {
    this.auth = auth;
    this.captcha = captcha;
  }
  ngAfterViewInit() {
    this.captcha.render(this.turnstileContainer.nativeElement, environment.turnstileSiteKey, (token) => {
      this.captchaToken.set(token);
    }, {
      appearance: "always",
      size: "invisible"
    });
  }
  async onSubmit() {
    this.error.set(null);
    this.submitting.set(true);
    if (!this.captchaToken()) {
      this.error.set("\u8ACB\u5B8C\u6210\u6A5F\u5668\u4EBA\u9A57\u8B49");
      this.submitting.set(false);
      return;
    }
    const errorMsg = await this.auth.sendPasswordReset(this.email, this.captchaToken());
    this.submitting.set(false);
    if (errorMsg) {
      this.error.set(errorMsg);
      return;
    }
    this.sent.set(true);
  }
  static \u0275fac = function ForgotPasswordComponent_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _ForgotPasswordComponent)(\u0275\u0275directiveInject(AuthService), \u0275\u0275directiveInject(CaptchaService));
  };
  static \u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _ForgotPasswordComponent, selectors: [["app-forgot-password"]], viewQuery: function ForgotPasswordComponent_Query(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275viewQuery(_c0, 5);
    }
    if (rf & 2) {
      let _t;
      \u0275\u0275queryRefresh(_t = \u0275\u0275loadQuery()) && (ctx.turnstileContainer = _t.first);
    }
  }, hostAttrs: [1, "u-centered-flex"], decls: 14, vars: 1, consts: [["turnstileContainer", ""], [1, "forgot-password", "auth-content"], [1, "form"], ["routerLink", "/login", 1, "form__link", "form__link--back"], [1, "pi", "pi-arrow-left"], [1, "auth-content__header"], [1, "auth-content__badge"], [1, "auth-content__title"], [1, "auth-content__subtitle"], [1, "message", "message--success"], [1, "pi", "pi-check-circle"], [1, "auth-content__hint"], [1, "form", 3, "ngSubmit"], [1, "message", "message--error"], [1, "form__field"], ["for", "email", 1, "form__label"], ["id", "email", "type", "email", "placeholder", "\u8F38\u5165\u60A8\u7684 Email", "name", "email", "required", "", "autocomplete", "email", 1, "form__input", 3, "ngModelChange", "ngModel"], [1, "mb-4"], ["type", "submit", 1, "form__submit", 3, "disabled"], [1, "pi", "pi-exclamation-circle"], [1, "pi", "pi-spinner", "pi-spin"], [1, "pi", "pi-send"]], template: function ForgotPasswordComponent_Template(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275elementStart(0, "div", 1)(1, "div", 2)(2, "a", 3);
      \u0275\u0275element(3, "i", 4);
      \u0275\u0275text(4, " \u8FD4\u56DE\u767B\u5165 ");
      \u0275\u0275elementEnd()();
      \u0275\u0275elementStart(5, "header", 5)(6, "p", 6);
      \u0275\u0275text(7, "\u7BA1\u7406\u7CFB\u7D71");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(8, "h1", 7);
      \u0275\u0275text(9, "\u5FD8\u8A18\u5BC6\u78BC");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(10, "p", 8);
      \u0275\u0275text(11, "\u8F38\u5165\u60A8\u7684 Email\uFF0C\u6211\u5011\u5C07\u5BC4\u9001\u91CD\u8A2D\u9023\u7D50");
      \u0275\u0275elementEnd()();
      \u0275\u0275conditionalCreate(12, ForgotPasswordComponent_Conditional_12_Template, 5, 0)(13, ForgotPasswordComponent_Conditional_13_Template, 13, 4);
      \u0275\u0275elementEnd();
    }
    if (rf & 2) {
      \u0275\u0275advance(12);
      \u0275\u0275conditional(ctx.sent() ? 12 : 13);
    }
  }, dependencies: [FormsModule, \u0275NgNoValidate, DefaultValueAccessor, NgControlStatus, NgControlStatusGroup, RequiredValidator, NgModel, NgForm, RouterLink], styles: ["\n\n.form[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-4);\n}\n.form__field[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-1);\n}\n.form__label[_ngcontent-%COMP%] {\n  font-size: var(--text-sm);\n  font-weight: var(--font-medium);\n  color: var(--zinc-700);\n}\n.form__input[_ngcontent-%COMP%] {\n  width: 100%;\n  height: 44px;\n  padding: 0 var(--space-3);\n  font-size: var(--text-md);\n  color: var(--zinc-900);\n  background: #fff;\n  border: 1px solid var(--zinc-300);\n  border-radius: var(--radius-md);\n  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);\n}\n.form__input[_ngcontent-%COMP%]:focus {\n  outline: none;\n  border-color: var(--accent-500);\n  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);\n}\n.form__input[_ngcontent-%COMP%]::placeholder {\n  color: var(--zinc-400);\n}\n.form__submit[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: var(--space-2);\n  width: 100%;\n  height: 44px;\n  margin-top: var(--space-2);\n  padding: 0 var(--space-4);\n  font-size: var(--text-md);\n  font-weight: var(--font-semibold);\n  color: #fff;\n  background: var(--zinc-800);\n  border: none;\n  border-radius: var(--radius-md);\n  cursor: pointer;\n  transition: background var(--transition-fast);\n}\n.form__submit[_ngcontent-%COMP%]:hover {\n  background: var(--zinc-700);\n}\n.form__submit[_ngcontent-%COMP%]:disabled {\n  opacity: 0.6;\n  cursor: not-allowed;\n}\n.form__row[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.form__checkbox[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: var(--space-2);\n  font-size: var(--text-sm);\n  color: var(--zinc-600);\n  cursor: pointer;\n}\n.form__checkbox[_ngcontent-%COMP%]   input[type=checkbox][_ngcontent-%COMP%] {\n  width: 16px;\n  height: 16px;\n  accent-color: var(--zinc-800);\n  cursor: pointer;\n}\n.form__link[_ngcontent-%COMP%] {\n  font-size: var(--text-sm);\n  color: var(--zinc-500);\n  text-decoration: none;\n  transition: color var(--transition-fast);\n}\n.form__link[_ngcontent-%COMP%]:hover {\n  color: var(--zinc-800);\n}\n.form__link--back[_ngcontent-%COMP%] {\n  display: inline-flex;\n  align-items: center;\n  gap: var(--space-2);\n  margin-bottom: var(--space-6);\n}\n.form__link--spaced[_ngcontent-%COMP%] {\n  margin-top: var(--space-4);\n  margin-bottom: 0;\n}\n.message[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  padding: var(--space-3) var(--space-4);\n  border-radius: var(--radius-lg);\n  font-size: var(--text-sm);\n}\n.message--success[_ngcontent-%COMP%] {\n  background: var(--success-100);\n  color: var(--success-600);\n}\n.message--error[_ngcontent-%COMP%] {\n  background: var(--error-100);\n  color: var(--error-600);\n}\n.message--info[_ngcontent-%COMP%] {\n  background: var(--zinc-100);\n  color: var(--zinc-600);\n}\n.auth-content[_ngcontent-%COMP%] {\n  width: 100%;\n  max-width: 480px;\n  margin: auto;\n  padding: var(--space-4) 0;\n}\n.auth-content__header[_ngcontent-%COMP%] {\n  margin-bottom: var(--space-6);\n}\n.auth-content__badge[_ngcontent-%COMP%] {\n  display: inline-block;\n  margin: 0 0 var(--space-3) 0;\n  padding: var(--space-1) var(--space-3);\n  font-size: var(--text-xs);\n  font-weight: var(--font-semibold);\n  text-transform: uppercase;\n  letter-spacing: 0.08em;\n  color: var(--accent-600);\n  background: rgba(14, 165, 233, 0.1);\n  border-radius: var(--radius-full);\n}\n.auth-content__title[_ngcontent-%COMP%] {\n  margin: 0 0 var(--space-2) 0;\n  font-size: var(--text-2xl);\n  font-weight: var(--font-bold);\n  line-height: var(--leading-tight);\n  color: var(--zinc-900);\n}\n.auth-content__subtitle[_ngcontent-%COMP%] {\n  margin: 0;\n  font-size: var(--text-md);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-500);\n}\n.auth-content__hint[_ngcontent-%COMP%] {\n  margin: var(--space-4) 0 0;\n  padding-top: var(--space-4);\n  font-size: var(--text-sm);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-400);\n  border-top: 1px solid var(--zinc-200);\n}\n/*# sourceMappingURL=forgot-password.component.css.map */"] });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(ForgotPasswordComponent, [{
    type: Component,
    args: [{ selector: "app-forgot-password", imports: [FormsModule, RouterLink], host: { class: "u-centered-flex" }, template: '<div class="forgot-password auth-content">\n  <div class="form">\n    <a class="form__link form__link--back" routerLink="/login">\n      <i class="pi pi-arrow-left"></i>\n      \u8FD4\u56DE\u767B\u5165\n    </a>\n  </div>\n\n  <header class="auth-content__header">\n    <p class="auth-content__badge">\u7BA1\u7406\u7CFB\u7D71</p>\n    <h1 class="auth-content__title">\u5FD8\u8A18\u5BC6\u78BC</h1>\n    <p class="auth-content__subtitle">\u8F38\u5165\u60A8\u7684 Email\uFF0C\u6211\u5011\u5C07\u5BC4\u9001\u91CD\u8A2D\u9023\u7D50</p>\n  </header>\n\n  @if (sent()) {\n    <div class="message message--success">\n      <i class="pi pi-check-circle"></i>\n      \u91CD\u8A2D\u9023\u7D50\u5DF2\u5BC4\u9001\uFF0C\u8ACB\u67E5\u6536\u4FE1\u7BB1\n    </div>\n    <p class="auth-content__hint">\u82E5\u60A8\u6C92\u6709\u63D0\u4F9B Email\uFF0C\u8ACB\u76F4\u63A5\u806F\u7E6B\u7BA1\u7406\u54E1\u91CD\u8A2D\u5BC6\u78BC\u3002</p>\n  } @else {\n    <form class="form" (ngSubmit)="onSubmit()">\n      @if (error()) {\n        <div class="message message--error">\n          <i class="pi pi-exclamation-circle"></i>\n          {{ error() }}\n        </div>\n      }\n\n      <div class="form__field">\n        <label class="form__label" for="email">Email</label>\n        <input\n          id="email"\n          type="email"\n          class="form__input"\n          placeholder="\u8F38\u5165\u60A8\u7684 Email"\n          [(ngModel)]="email"\n          name="email"\n          required\n          autocomplete="email"\n        />\n      </div>\n\n\n      <div #turnstileContainer class="mb-4"></div>\n\n      <button type="submit" class="form__submit" [disabled]="submitting() || !email">\n        @if (submitting()) {\n          <i class="pi pi-spinner pi-spin"></i>\n          \u5BC4\u9001\u4E2D...\n        } @else {\n          <i class="pi pi-send"></i>\n          \u5BC4\u9001\u91CD\u8A2D\u9023\u7D50\n        }\n      </button>\n    </form>\n\n    <p class="auth-content__hint">\u6C92\u6709 Email \u5E33\u865F\uFF1F\u8ACB\u806F\u7E6B\u7BA1\u7406\u54E1\u91CD\u8A2D\u5BC6\u78BC\u3002</p>\n  }\n</div>\n', styles: ["/* apps/web/src/app/features/public/pages/forgot-password/forgot-password.component.scss */\n.form {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-4);\n}\n.form__field {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-1);\n}\n.form__label {\n  font-size: var(--text-sm);\n  font-weight: var(--font-medium);\n  color: var(--zinc-700);\n}\n.form__input {\n  width: 100%;\n  height: 44px;\n  padding: 0 var(--space-3);\n  font-size: var(--text-md);\n  color: var(--zinc-900);\n  background: #fff;\n  border: 1px solid var(--zinc-300);\n  border-radius: var(--radius-md);\n  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);\n}\n.form__input:focus {\n  outline: none;\n  border-color: var(--accent-500);\n  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);\n}\n.form__input::placeholder {\n  color: var(--zinc-400);\n}\n.form__submit {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: var(--space-2);\n  width: 100%;\n  height: 44px;\n  margin-top: var(--space-2);\n  padding: 0 var(--space-4);\n  font-size: var(--text-md);\n  font-weight: var(--font-semibold);\n  color: #fff;\n  background: var(--zinc-800);\n  border: none;\n  border-radius: var(--radius-md);\n  cursor: pointer;\n  transition: background var(--transition-fast);\n}\n.form__submit:hover {\n  background: var(--zinc-700);\n}\n.form__submit:disabled {\n  opacity: 0.6;\n  cursor: not-allowed;\n}\n.form__row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.form__checkbox {\n  display: flex;\n  align-items: center;\n  gap: var(--space-2);\n  font-size: var(--text-sm);\n  color: var(--zinc-600);\n  cursor: pointer;\n}\n.form__checkbox input[type=checkbox] {\n  width: 16px;\n  height: 16px;\n  accent-color: var(--zinc-800);\n  cursor: pointer;\n}\n.form__link {\n  font-size: var(--text-sm);\n  color: var(--zinc-500);\n  text-decoration: none;\n  transition: color var(--transition-fast);\n}\n.form__link:hover {\n  color: var(--zinc-800);\n}\n.form__link--back {\n  display: inline-flex;\n  align-items: center;\n  gap: var(--space-2);\n  margin-bottom: var(--space-6);\n}\n.form__link--spaced {\n  margin-top: var(--space-4);\n  margin-bottom: 0;\n}\n.message {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  padding: var(--space-3) var(--space-4);\n  border-radius: var(--radius-lg);\n  font-size: var(--text-sm);\n}\n.message--success {\n  background: var(--success-100);\n  color: var(--success-600);\n}\n.message--error {\n  background: var(--error-100);\n  color: var(--error-600);\n}\n.message--info {\n  background: var(--zinc-100);\n  color: var(--zinc-600);\n}\n.auth-content {\n  width: 100%;\n  max-width: 480px;\n  margin: auto;\n  padding: var(--space-4) 0;\n}\n.auth-content__header {\n  margin-bottom: var(--space-6);\n}\n.auth-content__badge {\n  display: inline-block;\n  margin: 0 0 var(--space-3) 0;\n  padding: var(--space-1) var(--space-3);\n  font-size: var(--text-xs);\n  font-weight: var(--font-semibold);\n  text-transform: uppercase;\n  letter-spacing: 0.08em;\n  color: var(--accent-600);\n  background: rgba(14, 165, 233, 0.1);\n  border-radius: var(--radius-full);\n}\n.auth-content__title {\n  margin: 0 0 var(--space-2) 0;\n  font-size: var(--text-2xl);\n  font-weight: var(--font-bold);\n  line-height: var(--leading-tight);\n  color: var(--zinc-900);\n}\n.auth-content__subtitle {\n  margin: 0;\n  font-size: var(--text-md);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-500);\n}\n.auth-content__hint {\n  margin: var(--space-4) 0 0;\n  padding-top: var(--space-4);\n  font-size: var(--text-sm);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-400);\n  border-top: 1px solid var(--zinc-200);\n}\n/*# sourceMappingURL=forgot-password.component.css.map */\n"] }]
  }], () => [{ type: AuthService }, { type: CaptchaService }], { turnstileContainer: [{
    type: ViewChild,
    args: ["turnstileContainer"]
  }] });
})();
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(ForgotPasswordComponent, { className: "ForgotPasswordComponent", filePath: "apps/web/src/app/features/public/pages/forgot-password/forgot-password.component.ts", lineNumber: 15 });
})();
export {
  ForgotPasswordComponent
};
//# sourceMappingURL=chunk-6UPKMC5Z.js.map
