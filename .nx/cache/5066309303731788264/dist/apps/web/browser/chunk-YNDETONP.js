import {
  CaptchaService
} from "./chunk-TBXXZD44.js";
import {
  CheckboxControlValueAccessor,
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
  Router,
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

// apps/web/src/app/features/public/pages/login/login.component.ts
var _c0 = ["turnstileContainer"];
function LoginComponent_Conditional_9_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 7);
    \u0275\u0275element(1, "i", 19);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r1 = \u0275\u0275nextContext();
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1(" ", ctx_r1.error(), " ");
  }
}
function LoginComponent_Conditional_28_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275element(0, "i", 20);
    \u0275\u0275text(1, " \u767B\u5165\u4E2D... ");
  }
}
function LoginComponent_Conditional_29_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275element(0, "i", 21);
    \u0275\u0275text(1, " \u767B\u5165 ");
  }
}
var LoginComponent = class _LoginComponent {
  auth;
  router;
  captcha;
  turnstileContainer;
  email = "";
  password = "";
  rememberMe = false;
  error = signal(null, ...ngDevMode ? [{ debugName: "error" }] : []);
  submitting = signal(false, ...ngDevMode ? [{ debugName: "submitting" }] : []);
  captchaToken = signal(null, ...ngDevMode ? [{ debugName: "captchaToken" }] : []);
  constructor(auth, router, captcha) {
    this.auth = auth;
    this.router = router;
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
    this.auth.setRememberMe(this.rememberMe);
    const errorMsg = await this.auth.signIn(this.email, this.password, this.captchaToken() ?? void 0);
    this.submitting.set(false);
    if (errorMsg) {
      this.error.set(errorMsg);
      return;
    }
    const roles = this.auth.roles();
    if (roles.length === 0) {
      this.error.set("\u6B64\u5E33\u865F\u5C1A\u672A\u88AB\u6307\u6D3E\u89D2\u8272\uFF0C\u8ACB\u806F\u7E6B\u7BA1\u7406\u54E1");
      return;
    }
    this.auth.navigateToRoleShell(roles[0]);
  }
  static \u0275fac = function LoginComponent_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _LoginComponent)(\u0275\u0275directiveInject(AuthService), \u0275\u0275directiveInject(Router), \u0275\u0275directiveInject(CaptchaService));
  };
  static \u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _LoginComponent, selectors: [["app-login"]], viewQuery: function LoginComponent_Query(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275viewQuery(_c0, 5);
    }
    if (rf & 2) {
      let _t;
      \u0275\u0275queryRefresh(_t = \u0275\u0275loadQuery()) && (ctx.turnstileContainer = _t.first);
    }
  }, hostAttrs: [1, "u-centered-flex"], decls: 30, vars: 6, consts: [["turnstileContainer", ""], [1, "login", "auth-content"], [1, "auth-content__header"], [1, "auth-content__badge"], [1, "auth-content__title"], [1, "auth-content__subtitle"], [1, "form", 3, "ngSubmit"], [1, "message", "message--error"], [1, "form__field"], ["for", "email", 1, "form__label"], ["id", "email", "type", "email", "placeholder", "\u8F38\u5165 Email", "name", "email", "required", "", "autocomplete", "email", 1, "form__input", 3, "ngModelChange", "ngModel"], ["for", "password", 1, "form__label"], ["id", "password", "type", "password", "placeholder", "\u8F38\u5165\u5BC6\u78BC", "name", "password", "required", "", "autocomplete", "current-password", 1, "form__input", 3, "ngModelChange", "ngModel"], [1, "form__row"], [1, "form__checkbox"], ["type", "checkbox", "name", "rememberMe", 3, "ngModelChange", "ngModel"], ["routerLink", "/forgot-password", 1, "form__link"], [1, "mb-4"], ["type", "submit", 1, "form__submit", 3, "disabled"], [1, "pi", "pi-exclamation-circle"], [1, "pi", "pi-spinner", "pi-spin"], [1, "pi", "pi-sign-in"]], template: function LoginComponent_Template(rf, ctx) {
    if (rf & 1) {
      const _r1 = \u0275\u0275getCurrentView();
      \u0275\u0275elementStart(0, "div", 1)(1, "header", 2)(2, "p", 3);
      \u0275\u0275text(3, "\u7BA1\u7406\u7CFB\u7D71");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(4, "h1", 4);
      \u0275\u0275text(5, "\u767B\u5165");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(6, "p", 5);
      \u0275\u0275text(7, "\u8ACB\u4F7F\u7528\u60A8\u7684\u5E33\u865F\u5BC6\u78BC\u767B\u5165\u7BA1\u7406\u7CFB\u7D71");
      \u0275\u0275elementEnd()();
      \u0275\u0275elementStart(8, "form", 6);
      \u0275\u0275listener("ngSubmit", function LoginComponent_Template_form_ngSubmit_8_listener() {
        \u0275\u0275restoreView(_r1);
        return \u0275\u0275resetView(ctx.onSubmit());
      });
      \u0275\u0275conditionalCreate(9, LoginComponent_Conditional_9_Template, 3, 1, "div", 7);
      \u0275\u0275elementStart(10, "div", 8)(11, "label", 9);
      \u0275\u0275text(12, "Email");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(13, "input", 10);
      \u0275\u0275twoWayListener("ngModelChange", function LoginComponent_Template_input_ngModelChange_13_listener($event) {
        \u0275\u0275restoreView(_r1);
        \u0275\u0275twoWayBindingSet(ctx.email, $event) || (ctx.email = $event);
        return \u0275\u0275resetView($event);
      });
      \u0275\u0275elementEnd()();
      \u0275\u0275elementStart(14, "div", 8)(15, "label", 11);
      \u0275\u0275text(16, "\u5BC6\u78BC");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(17, "input", 12);
      \u0275\u0275twoWayListener("ngModelChange", function LoginComponent_Template_input_ngModelChange_17_listener($event) {
        \u0275\u0275restoreView(_r1);
        \u0275\u0275twoWayBindingSet(ctx.password, $event) || (ctx.password = $event);
        return \u0275\u0275resetView($event);
      });
      \u0275\u0275elementEnd()();
      \u0275\u0275elementStart(18, "div", 13)(19, "label", 14)(20, "input", 15);
      \u0275\u0275twoWayListener("ngModelChange", function LoginComponent_Template_input_ngModelChange_20_listener($event) {
        \u0275\u0275restoreView(_r1);
        \u0275\u0275twoWayBindingSet(ctx.rememberMe, $event) || (ctx.rememberMe = $event);
        return \u0275\u0275resetView($event);
      });
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(21, "span");
      \u0275\u0275text(22, "\u8A18\u4F4F\u6211");
      \u0275\u0275elementEnd()();
      \u0275\u0275elementStart(23, "a", 16);
      \u0275\u0275text(24, "\u5FD8\u8A18\u5BC6\u78BC\uFF1F");
      \u0275\u0275elementEnd()();
      \u0275\u0275element(25, "div", 17, 0);
      \u0275\u0275elementStart(27, "button", 18);
      \u0275\u0275conditionalCreate(28, LoginComponent_Conditional_28_Template, 2, 0)(29, LoginComponent_Conditional_29_Template, 2, 0);
      \u0275\u0275elementEnd()()();
    }
    if (rf & 2) {
      \u0275\u0275advance(9);
      \u0275\u0275conditional(ctx.error() ? 9 : -1);
      \u0275\u0275advance(4);
      \u0275\u0275twoWayProperty("ngModel", ctx.email);
      \u0275\u0275advance(4);
      \u0275\u0275twoWayProperty("ngModel", ctx.password);
      \u0275\u0275advance(3);
      \u0275\u0275twoWayProperty("ngModel", ctx.rememberMe);
      \u0275\u0275advance(7);
      \u0275\u0275property("disabled", ctx.submitting() || !ctx.email || !ctx.password);
      \u0275\u0275advance();
      \u0275\u0275conditional(ctx.submitting() ? 28 : 29);
    }
  }, dependencies: [FormsModule, \u0275NgNoValidate, DefaultValueAccessor, CheckboxControlValueAccessor, NgControlStatus, NgControlStatusGroup, RequiredValidator, NgModel, NgForm, RouterLink], styles: ["\n\n.form[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-4);\n}\n.form__field[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-1);\n}\n.form__label[_ngcontent-%COMP%] {\n  font-size: var(--text-sm);\n  font-weight: var(--font-medium);\n  color: var(--zinc-700);\n}\n.form__input[_ngcontent-%COMP%] {\n  width: 100%;\n  height: 44px;\n  padding: 0 var(--space-3);\n  font-size: var(--text-md);\n  color: var(--zinc-900);\n  background: #fff;\n  border: 1px solid var(--zinc-300);\n  border-radius: var(--radius-md);\n  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);\n}\n.form__input[_ngcontent-%COMP%]:focus {\n  outline: none;\n  border-color: var(--accent-500);\n  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);\n}\n.form__input[_ngcontent-%COMP%]::placeholder {\n  color: var(--zinc-400);\n}\n.form__submit[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: var(--space-2);\n  width: 100%;\n  height: 44px;\n  margin-top: var(--space-2);\n  padding: 0 var(--space-4);\n  font-size: var(--text-md);\n  font-weight: var(--font-semibold);\n  color: #fff;\n  background: var(--zinc-800);\n  border: none;\n  border-radius: var(--radius-md);\n  cursor: pointer;\n  transition: background var(--transition-fast);\n}\n.form__submit[_ngcontent-%COMP%]:hover {\n  background: var(--zinc-700);\n}\n.form__submit[_ngcontent-%COMP%]:disabled {\n  opacity: 0.6;\n  cursor: not-allowed;\n}\n.form__row[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.form__checkbox[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: var(--space-2);\n  font-size: var(--text-sm);\n  color: var(--zinc-600);\n  cursor: pointer;\n}\n.form__checkbox[_ngcontent-%COMP%]   input[type=checkbox][_ngcontent-%COMP%] {\n  width: 16px;\n  height: 16px;\n  accent-color: var(--zinc-800);\n  cursor: pointer;\n}\n.form__link[_ngcontent-%COMP%] {\n  font-size: var(--text-sm);\n  color: var(--zinc-500);\n  text-decoration: none;\n  transition: color var(--transition-fast);\n}\n.form__link[_ngcontent-%COMP%]:hover {\n  color: var(--zinc-800);\n}\n.form__link--back[_ngcontent-%COMP%] {\n  display: inline-flex;\n  align-items: center;\n  gap: var(--space-2);\n  margin-bottom: var(--space-6);\n}\n.form__link--spaced[_ngcontent-%COMP%] {\n  margin-top: var(--space-4);\n  margin-bottom: 0;\n}\n.message[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  padding: var(--space-3) var(--space-4);\n  border-radius: var(--radius-lg);\n  font-size: var(--text-sm);\n}\n.message--success[_ngcontent-%COMP%] {\n  background: var(--success-100);\n  color: var(--success-600);\n}\n.message--error[_ngcontent-%COMP%] {\n  background: var(--error-100);\n  color: var(--error-600);\n}\n.message--info[_ngcontent-%COMP%] {\n  background: var(--zinc-100);\n  color: var(--zinc-600);\n}\n.auth-content[_ngcontent-%COMP%] {\n  width: 100%;\n  max-width: 480px;\n  margin: auto;\n  padding: var(--space-4) 0;\n}\n.auth-content__header[_ngcontent-%COMP%] {\n  margin-bottom: var(--space-6);\n}\n.auth-content__badge[_ngcontent-%COMP%] {\n  display: inline-block;\n  margin: 0 0 var(--space-3) 0;\n  padding: var(--space-1) var(--space-3);\n  font-size: var(--text-xs);\n  font-weight: var(--font-semibold);\n  text-transform: uppercase;\n  letter-spacing: 0.08em;\n  color: var(--accent-600);\n  background: rgba(14, 165, 233, 0.1);\n  border-radius: var(--radius-full);\n}\n.auth-content__title[_ngcontent-%COMP%] {\n  margin: 0 0 var(--space-2) 0;\n  font-size: var(--text-2xl);\n  font-weight: var(--font-bold);\n  line-height: var(--leading-tight);\n  color: var(--zinc-900);\n}\n.auth-content__subtitle[_ngcontent-%COMP%] {\n  margin: 0;\n  font-size: var(--text-md);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-500);\n}\n.auth-content__hint[_ngcontent-%COMP%] {\n  margin: var(--space-4) 0 0;\n  padding-top: var(--space-4);\n  font-size: var(--text-sm);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-400);\n  border-top: 1px solid var(--zinc-200);\n}\n/*# sourceMappingURL=login.component.css.map */"] });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(LoginComponent, [{
    type: Component,
    args: [{ selector: "app-login", imports: [FormsModule, RouterLink], host: { class: "u-centered-flex" }, template: '<div class="login auth-content">\n  <header class="auth-content__header">\n    <p class="auth-content__badge">\u7BA1\u7406\u7CFB\u7D71</p>\n    <h1 class="auth-content__title">\u767B\u5165</h1>\n    <p class="auth-content__subtitle">\u8ACB\u4F7F\u7528\u60A8\u7684\u5E33\u865F\u5BC6\u78BC\u767B\u5165\u7BA1\u7406\u7CFB\u7D71</p>\n  </header>\n\n  <form class="form" (ngSubmit)="onSubmit()">\n    @if (error()) {\n      <div class="message message--error">\n        <i class="pi pi-exclamation-circle"></i>\n        {{ error() }}\n      </div>\n    }\n\n    <div class="form__field">\n      <label class="form__label" for="email">Email</label>\n      <input\n        id="email"\n        type="email"\n        class="form__input"\n        placeholder="\u8F38\u5165 Email"\n        [(ngModel)]="email"\n        name="email"\n        required\n        autocomplete="email"\n      />\n    </div>\n\n    <div class="form__field">\n      <label class="form__label" for="password">\u5BC6\u78BC</label>\n      <input\n        id="password"\n        type="password"\n        class="form__input"\n        placeholder="\u8F38\u5165\u5BC6\u78BC"\n        [(ngModel)]="password"\n        name="password"\n        required\n        autocomplete="current-password"\n      />\n    </div>\n\n    <div class="form__row">\n      <label class="form__checkbox">\n        <input type="checkbox" [(ngModel)]="rememberMe" name="rememberMe" />\n        <span>\u8A18\u4F4F\u6211</span>\n      </label>\n      <a class="form__link" routerLink="/forgot-password">\u5FD8\u8A18\u5BC6\u78BC\uFF1F</a>\n    </div>\n\n\n    <div #turnstileContainer class="mb-4"></div>\n\n    <button\n      type="submit"\n      class="form__submit"\n      [disabled]="submitting() || !email || !password"\n    >\n      @if (submitting()) {\n        <i class="pi pi-spinner pi-spin"></i>\n        \u767B\u5165\u4E2D...\n      } @else {\n        <i class="pi pi-sign-in"></i>\n        \u767B\u5165\n      }\n    </button>\n  </form>\n</div>\n', styles: ["/* apps/web/src/app/features/public/pages/login/login.component.scss */\n.form {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-4);\n}\n.form__field {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-1);\n}\n.form__label {\n  font-size: var(--text-sm);\n  font-weight: var(--font-medium);\n  color: var(--zinc-700);\n}\n.form__input {\n  width: 100%;\n  height: 44px;\n  padding: 0 var(--space-3);\n  font-size: var(--text-md);\n  color: var(--zinc-900);\n  background: #fff;\n  border: 1px solid var(--zinc-300);\n  border-radius: var(--radius-md);\n  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);\n}\n.form__input:focus {\n  outline: none;\n  border-color: var(--accent-500);\n  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);\n}\n.form__input::placeholder {\n  color: var(--zinc-400);\n}\n.form__submit {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: var(--space-2);\n  width: 100%;\n  height: 44px;\n  margin-top: var(--space-2);\n  padding: 0 var(--space-4);\n  font-size: var(--text-md);\n  font-weight: var(--font-semibold);\n  color: #fff;\n  background: var(--zinc-800);\n  border: none;\n  border-radius: var(--radius-md);\n  cursor: pointer;\n  transition: background var(--transition-fast);\n}\n.form__submit:hover {\n  background: var(--zinc-700);\n}\n.form__submit:disabled {\n  opacity: 0.6;\n  cursor: not-allowed;\n}\n.form__row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.form__checkbox {\n  display: flex;\n  align-items: center;\n  gap: var(--space-2);\n  font-size: var(--text-sm);\n  color: var(--zinc-600);\n  cursor: pointer;\n}\n.form__checkbox input[type=checkbox] {\n  width: 16px;\n  height: 16px;\n  accent-color: var(--zinc-800);\n  cursor: pointer;\n}\n.form__link {\n  font-size: var(--text-sm);\n  color: var(--zinc-500);\n  text-decoration: none;\n  transition: color var(--transition-fast);\n}\n.form__link:hover {\n  color: var(--zinc-800);\n}\n.form__link--back {\n  display: inline-flex;\n  align-items: center;\n  gap: var(--space-2);\n  margin-bottom: var(--space-6);\n}\n.form__link--spaced {\n  margin-top: var(--space-4);\n  margin-bottom: 0;\n}\n.message {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  padding: var(--space-3) var(--space-4);\n  border-radius: var(--radius-lg);\n  font-size: var(--text-sm);\n}\n.message--success {\n  background: var(--success-100);\n  color: var(--success-600);\n}\n.message--error {\n  background: var(--error-100);\n  color: var(--error-600);\n}\n.message--info {\n  background: var(--zinc-100);\n  color: var(--zinc-600);\n}\n.auth-content {\n  width: 100%;\n  max-width: 480px;\n  margin: auto;\n  padding: var(--space-4) 0;\n}\n.auth-content__header {\n  margin-bottom: var(--space-6);\n}\n.auth-content__badge {\n  display: inline-block;\n  margin: 0 0 var(--space-3) 0;\n  padding: var(--space-1) var(--space-3);\n  font-size: var(--text-xs);\n  font-weight: var(--font-semibold);\n  text-transform: uppercase;\n  letter-spacing: 0.08em;\n  color: var(--accent-600);\n  background: rgba(14, 165, 233, 0.1);\n  border-radius: var(--radius-full);\n}\n.auth-content__title {\n  margin: 0 0 var(--space-2) 0;\n  font-size: var(--text-2xl);\n  font-weight: var(--font-bold);\n  line-height: var(--leading-tight);\n  color: var(--zinc-900);\n}\n.auth-content__subtitle {\n  margin: 0;\n  font-size: var(--text-md);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-500);\n}\n.auth-content__hint {\n  margin: var(--space-4) 0 0;\n  padding-top: var(--space-4);\n  font-size: var(--text-sm);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-400);\n  border-top: 1px solid var(--zinc-200);\n}\n/*# sourceMappingURL=login.component.css.map */\n"] }]
  }], () => [{ type: AuthService }, { type: Router }, { type: CaptchaService }], { turnstileContainer: [{
    type: ViewChild,
    args: ["turnstileContainer"]
  }] });
})();
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(LoginComponent, { className: "LoginComponent", filePath: "apps/web/src/app/features/public/pages/login/login.component.ts", lineNumber: 15 });
})();
export {
  LoginComponent
};
//# sourceMappingURL=chunk-YNDETONP.js.map
