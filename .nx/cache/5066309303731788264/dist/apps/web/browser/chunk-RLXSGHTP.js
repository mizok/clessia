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
  SupabaseService
} from "./chunk-WSLHL2JA.js";
import {
  Router,
  RouterLink
} from "./chunk-NFVC465N.js";
import {
  Component,
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
  ɵɵnextContext,
  ɵɵproperty,
  ɵɵresetView,
  ɵɵrestoreView,
  ɵɵtext,
  ɵɵtextInterpolate1,
  ɵɵtwoWayBindingSet,
  ɵɵtwoWayListener,
  ɵɵtwoWayProperty
} from "./chunk-YGF3CXFR.js";

// apps/web/src/app/features/public/pages/reset-password/reset-password.component.ts
function ResetPasswordComponent_Conditional_8_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 5);
    \u0275\u0275element(1, "i", 8);
    \u0275\u0275text(2, " \u5BC6\u78BC\u5DF2\u91CD\u8A2D\uFF0C\u5373\u5C07\u8FD4\u56DE\u767B\u5165\u9801... ");
    \u0275\u0275elementEnd();
  }
}
function ResetPasswordComponent_Conditional_9_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 9);
    \u0275\u0275element(1, "i", 10);
    \u0275\u0275text(2, " \u9023\u7D50\u5DF2\u5931\u6548\u6216\u904E\u671F\uFF0C\u8ACB\u91CD\u65B0\u7533\u8ACB ");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 7)(4, "a", 11);
    \u0275\u0275element(5, "i", 12);
    \u0275\u0275text(6, " \u91CD\u65B0\u7533\u8ACB ");
    \u0275\u0275elementEnd()();
  }
}
function ResetPasswordComponent_Conditional_10_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 6);
    \u0275\u0275element(1, "i", 13);
    \u0275\u0275text(2, " \u9A57\u8B49\u9023\u7D50\u4E2D... ");
    \u0275\u0275elementEnd();
  }
}
function ResetPasswordComponent_Conditional_11_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 9);
    \u0275\u0275element(1, "i", 10);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r1 = \u0275\u0275nextContext(2);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1(" ", ctx_r1.error(), " ");
  }
}
function ResetPasswordComponent_Conditional_11_Conditional_11_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275element(0, "i", 13);
    \u0275\u0275text(1, " \u66F4\u65B0\u4E2D... ");
  }
}
function ResetPasswordComponent_Conditional_11_Conditional_12_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275element(0, "i", 21);
    \u0275\u0275text(1, " \u78BA\u8A8D\u91CD\u8A2D ");
  }
}
function ResetPasswordComponent_Conditional_11_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "form", 14);
    \u0275\u0275listener("ngSubmit", function ResetPasswordComponent_Conditional_11_Template_form_ngSubmit_0_listener() {
      \u0275\u0275restoreView(_r1);
      const ctx_r1 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r1.onSubmit());
    });
    \u0275\u0275conditionalCreate(1, ResetPasswordComponent_Conditional_11_Conditional_1_Template, 3, 1, "div", 9);
    \u0275\u0275elementStart(2, "div", 15)(3, "label", 16);
    \u0275\u0275text(4, "\u65B0\u5BC6\u78BC");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "input", 17);
    \u0275\u0275twoWayListener("ngModelChange", function ResetPasswordComponent_Conditional_11_Template_input_ngModelChange_5_listener($event) {
      \u0275\u0275restoreView(_r1);
      const ctx_r1 = \u0275\u0275nextContext();
      \u0275\u0275twoWayBindingSet(ctx_r1.newPassword, $event) || (ctx_r1.newPassword = $event);
      return \u0275\u0275resetView($event);
    });
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(6, "div", 15)(7, "label", 18);
    \u0275\u0275text(8, "\u78BA\u8A8D\u5BC6\u78BC");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(9, "input", 19);
    \u0275\u0275twoWayListener("ngModelChange", function ResetPasswordComponent_Conditional_11_Template_input_ngModelChange_9_listener($event) {
      \u0275\u0275restoreView(_r1);
      const ctx_r1 = \u0275\u0275nextContext();
      \u0275\u0275twoWayBindingSet(ctx_r1.confirmPassword, $event) || (ctx_r1.confirmPassword = $event);
      return \u0275\u0275resetView($event);
    });
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(10, "button", 20);
    \u0275\u0275conditionalCreate(11, ResetPasswordComponent_Conditional_11_Conditional_11_Template, 2, 0)(12, ResetPasswordComponent_Conditional_11_Conditional_12_Template, 2, 0);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r1 = \u0275\u0275nextContext();
    \u0275\u0275advance();
    \u0275\u0275conditional(ctx_r1.error() ? 1 : -1);
    \u0275\u0275advance(4);
    \u0275\u0275twoWayProperty("ngModel", ctx_r1.newPassword);
    \u0275\u0275advance(4);
    \u0275\u0275twoWayProperty("ngModel", ctx_r1.confirmPassword);
    \u0275\u0275advance();
    \u0275\u0275property("disabled", ctx_r1.submitting() || !ctx_r1.newPassword || !ctx_r1.confirmPassword);
    \u0275\u0275advance();
    \u0275\u0275conditional(ctx_r1.submitting() ? 11 : 12);
  }
}
var ResetPasswordComponent = class _ResetPasswordComponent {
  supabase;
  router;
  newPassword = "";
  confirmPassword = "";
  submitting = signal(false, ...ngDevMode ? [{ debugName: "submitting" }] : []);
  done = signal(false, ...ngDevMode ? [{ debugName: "done" }] : []);
  error = signal(null, ...ngDevMode ? [{ debugName: "error" }] : []);
  invalidLink = signal(false, ...ngDevMode ? [{ debugName: "invalidLink" }] : []);
  sessionReady = signal(false, ...ngDevMode ? [{ debugName: "sessionReady" }] : []);
  authSubscription;
  constructor(supabase, router) {
    this.supabase = supabase;
    this.router = router;
  }
  ngOnInit() {
    const { data } = this.supabase.client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        this.sessionReady.set(true);
        this.invalidLink.set(false);
        history.replaceState(null, "", window.location.pathname);
      }
    });
    this.authSubscription = data.subscription;
    setTimeout(async () => {
      if (this.sessionReady())
        return;
      const hasRecoveryHash = window.location.hash.includes("access_token") || window.location.hash.includes("type=recovery");
      const hasRecoveryCode = new URLSearchParams(window.location.search).has("code");
      const { data: sessionData } = await this.supabase.client.auth.getSession();
      if (!sessionData.session) {
        this.invalidLink.set(true);
      } else if (hasRecoveryHash || hasRecoveryCode) {
        this.sessionReady.set(true);
        history.replaceState(null, "", window.location.pathname);
      } else {
        await this.supabase.client.auth.signOut();
        this.invalidLink.set(true);
      }
    }, 3e3);
  }
  ngOnDestroy() {
    this.authSubscription?.unsubscribe();
  }
  async onSubmit() {
    if (this.newPassword !== this.confirmPassword) {
      this.error.set("\u5169\u6B21\u8F38\u5165\u7684\u5BC6\u78BC\u4E0D\u4E00\u81F4");
      return;
    }
    this.error.set(null);
    this.submitting.set(true);
    try {
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("\u8ACB\u6C42\u903E\u6642\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u5F8C\u518D\u8A66")), 15e3));
      const { error } = await Promise.race([
        this.supabase.client.auth.updateUser({ password: this.newPassword }),
        timeoutPromise
      ]);
      if (error) {
        this.error.set(error.message);
      } else {
        this.done.set(true);
        await this.supabase.client.auth.signOut();
        setTimeout(() => this.router.navigate(["/login"]), 2e3);
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : "\u767C\u751F\u672A\u77E5\u932F\u8AA4\uFF0C\u8ACB\u91CD\u8A66");
    } finally {
      this.submitting.set(false);
    }
  }
  static \u0275fac = function ResetPasswordComponent_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _ResetPasswordComponent)(\u0275\u0275directiveInject(SupabaseService), \u0275\u0275directiveInject(Router));
  };
  static \u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _ResetPasswordComponent, selectors: [["app-reset-password"]], hostAttrs: [1, "u-centered-flex"], decls: 12, vars: 1, consts: [[1, "reset-password", "auth-content"], [1, "auth-content__header"], [1, "auth-content__badge"], [1, "auth-content__title"], [1, "auth-content__subtitle"], [1, "message", "message--success"], [1, "message", "message--info"], [1, "form"], [1, "pi", "pi-check-circle"], [1, "message", "message--error"], [1, "pi", "pi-exclamation-circle"], ["routerLink", "/forgot-password", 1, "form__link", "form__link--back", "form__link--spaced"], [1, "pi", "pi-arrow-left"], [1, "pi", "pi-spinner", "pi-spin"], [1, "form", 3, "ngSubmit"], [1, "form__field"], ["for", "newPassword", 1, "form__label"], ["id", "newPassword", "type", "password", "placeholder", "\u8F38\u5165\u65B0\u5BC6\u78BC", "name", "newPassword", "required", "", "autocomplete", "new-password", 1, "form__input", 3, "ngModelChange", "ngModel"], ["for", "confirmPassword", 1, "form__label"], ["id", "confirmPassword", "type", "password", "placeholder", "\u518D\u6B21\u8F38\u5165\u65B0\u5BC6\u78BC", "name", "confirmPassword", "required", "", "autocomplete", "new-password", 1, "form__input", 3, "ngModelChange", "ngModel"], ["type", "submit", 1, "form__submit", 3, "disabled"], [1, "pi", "pi-lock"]], template: function ResetPasswordComponent_Template(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275elementStart(0, "div", 0)(1, "header", 1)(2, "p", 2);
      \u0275\u0275text(3, "\u7BA1\u7406\u7CFB\u7D71");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(4, "h1", 3);
      \u0275\u0275text(5, "\u91CD\u8A2D\u5BC6\u78BC");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(6, "p", 4);
      \u0275\u0275text(7, "\u8ACB\u8F38\u5165\u60A8\u7684\u65B0\u5BC6\u78BC");
      \u0275\u0275elementEnd()();
      \u0275\u0275conditionalCreate(8, ResetPasswordComponent_Conditional_8_Template, 3, 0, "div", 5)(9, ResetPasswordComponent_Conditional_9_Template, 7, 0)(10, ResetPasswordComponent_Conditional_10_Template, 3, 0, "div", 6)(11, ResetPasswordComponent_Conditional_11_Template, 13, 5, "form", 7);
      \u0275\u0275elementEnd();
    }
    if (rf & 2) {
      \u0275\u0275advance(8);
      \u0275\u0275conditional(ctx.done() ? 8 : ctx.invalidLink() ? 9 : !ctx.sessionReady() ? 10 : 11);
    }
  }, dependencies: [FormsModule, \u0275NgNoValidate, DefaultValueAccessor, NgControlStatus, NgControlStatusGroup, RequiredValidator, NgModel, NgForm, RouterLink], styles: ["\n\n.form[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-4);\n}\n.form__field[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-1);\n}\n.form__label[_ngcontent-%COMP%] {\n  font-size: var(--text-sm);\n  font-weight: var(--font-medium);\n  color: var(--zinc-700);\n}\n.form__input[_ngcontent-%COMP%] {\n  width: 100%;\n  height: 44px;\n  padding: 0 var(--space-3);\n  font-size: var(--text-md);\n  color: var(--zinc-900);\n  background: #fff;\n  border: 1px solid var(--zinc-300);\n  border-radius: var(--radius-md);\n  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);\n}\n.form__input[_ngcontent-%COMP%]:focus {\n  outline: none;\n  border-color: var(--accent-500);\n  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);\n}\n.form__input[_ngcontent-%COMP%]::placeholder {\n  color: var(--zinc-400);\n}\n.form__submit[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: var(--space-2);\n  width: 100%;\n  height: 44px;\n  margin-top: var(--space-2);\n  padding: 0 var(--space-4);\n  font-size: var(--text-md);\n  font-weight: var(--font-semibold);\n  color: #fff;\n  background: var(--zinc-800);\n  border: none;\n  border-radius: var(--radius-md);\n  cursor: pointer;\n  transition: background var(--transition-fast);\n}\n.form__submit[_ngcontent-%COMP%]:hover {\n  background: var(--zinc-700);\n}\n.form__submit[_ngcontent-%COMP%]:disabled {\n  opacity: 0.6;\n  cursor: not-allowed;\n}\n.form__row[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.form__checkbox[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: var(--space-2);\n  font-size: var(--text-sm);\n  color: var(--zinc-600);\n  cursor: pointer;\n}\n.form__checkbox[_ngcontent-%COMP%]   input[type=checkbox][_ngcontent-%COMP%] {\n  width: 16px;\n  height: 16px;\n  accent-color: var(--zinc-800);\n  cursor: pointer;\n}\n.form__link[_ngcontent-%COMP%] {\n  font-size: var(--text-sm);\n  color: var(--zinc-500);\n  text-decoration: none;\n  transition: color var(--transition-fast);\n}\n.form__link[_ngcontent-%COMP%]:hover {\n  color: var(--zinc-800);\n}\n.form__link--back[_ngcontent-%COMP%] {\n  display: inline-flex;\n  align-items: center;\n  gap: var(--space-2);\n  margin-bottom: var(--space-6);\n}\n.form__link--spaced[_ngcontent-%COMP%] {\n  margin-top: var(--space-4);\n  margin-bottom: 0;\n}\n.message[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  padding: var(--space-3) var(--space-4);\n  border-radius: var(--radius-lg);\n  font-size: var(--text-sm);\n}\n.message--success[_ngcontent-%COMP%] {\n  background: var(--success-100);\n  color: var(--success-600);\n}\n.message--error[_ngcontent-%COMP%] {\n  background: var(--error-100);\n  color: var(--error-600);\n}\n.message--info[_ngcontent-%COMP%] {\n  background: var(--zinc-100);\n  color: var(--zinc-600);\n}\n.auth-content[_ngcontent-%COMP%] {\n  width: 100%;\n  max-width: 480px;\n  margin: auto;\n  padding: var(--space-4) 0;\n}\n.auth-content__header[_ngcontent-%COMP%] {\n  margin-bottom: var(--space-6);\n}\n.auth-content__badge[_ngcontent-%COMP%] {\n  display: inline-block;\n  margin: 0 0 var(--space-3) 0;\n  padding: var(--space-1) var(--space-3);\n  font-size: var(--text-xs);\n  font-weight: var(--font-semibold);\n  text-transform: uppercase;\n  letter-spacing: 0.08em;\n  color: var(--accent-600);\n  background: rgba(14, 165, 233, 0.1);\n  border-radius: var(--radius-full);\n}\n.auth-content__title[_ngcontent-%COMP%] {\n  margin: 0 0 var(--space-2) 0;\n  font-size: var(--text-2xl);\n  font-weight: var(--font-bold);\n  line-height: var(--leading-tight);\n  color: var(--zinc-900);\n}\n.auth-content__subtitle[_ngcontent-%COMP%] {\n  margin: 0;\n  font-size: var(--text-md);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-500);\n}\n.auth-content__hint[_ngcontent-%COMP%] {\n  margin: var(--space-4) 0 0;\n  padding-top: var(--space-4);\n  font-size: var(--text-sm);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-400);\n  border-top: 1px solid var(--zinc-200);\n}\n/*# sourceMappingURL=reset-password.component.css.map */"] });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(ResetPasswordComponent, [{
    type: Component,
    args: [{ selector: "app-reset-password", imports: [FormsModule, RouterLink], host: { class: "u-centered-flex" }, template: '<div class="reset-password auth-content">\n  <header class="auth-content__header">\n    <p class="auth-content__badge">\u7BA1\u7406\u7CFB\u7D71</p>\n    <h1 class="auth-content__title">\u91CD\u8A2D\u5BC6\u78BC</h1>\n    <p class="auth-content__subtitle">\u8ACB\u8F38\u5165\u60A8\u7684\u65B0\u5BC6\u78BC</p>\n  </header>\n\n  @if (done()) {\n    <div class="message message--success">\n      <i class="pi pi-check-circle"></i>\n      \u5BC6\u78BC\u5DF2\u91CD\u8A2D\uFF0C\u5373\u5C07\u8FD4\u56DE\u767B\u5165\u9801...\n    </div>\n  } @else if (invalidLink()) {\n    <div class="message message--error">\n      <i class="pi pi-exclamation-circle"></i>\n      \u9023\u7D50\u5DF2\u5931\u6548\u6216\u904E\u671F\uFF0C\u8ACB\u91CD\u65B0\u7533\u8ACB\n    </div>\n<div class="form">\n      <a class="form__link form__link--back form__link--spaced" routerLink="/forgot-password">\n        <i class="pi pi-arrow-left"></i>\n        \u91CD\u65B0\u7533\u8ACB\n      </a>\n    </div>\n  } @else if (!sessionReady()) {\n    <div class="message message--info">\n      <i class="pi pi-spinner pi-spin"></i>\n      \u9A57\u8B49\u9023\u7D50\u4E2D...\n    </div>\n  } @else {\n    <form class="form" (ngSubmit)="onSubmit()">\n      @if (error()) {\n        <div class="message message--error">\n          <i class="pi pi-exclamation-circle"></i>\n          {{ error() }}\n        </div>\n      }\n\n      <div class="form__field">\n        <label class="form__label" for="newPassword">\u65B0\u5BC6\u78BC</label>\n        <input\n          id="newPassword"\n          type="password"\n          class="form__input"\n          placeholder="\u8F38\u5165\u65B0\u5BC6\u78BC"\n          [(ngModel)]="newPassword"\n          name="newPassword"\n          required\n          autocomplete="new-password"\n        />\n      </div>\n\n      <div class="form__field">\n        <label class="form__label" for="confirmPassword">\u78BA\u8A8D\u5BC6\u78BC</label>\n        <input\n          id="confirmPassword"\n          type="password"\n          class="form__input"\n          placeholder="\u518D\u6B21\u8F38\u5165\u65B0\u5BC6\u78BC"\n          [(ngModel)]="confirmPassword"\n          name="confirmPassword"\n          required\n          autocomplete="new-password"\n        />\n      </div>\n\n      <button\n        type="submit"\n        class="form__submit"\n        [disabled]="submitting() || !newPassword || !confirmPassword"\n      >\n        @if (submitting()) {\n          <i class="pi pi-spinner pi-spin"></i>\n          \u66F4\u65B0\u4E2D...\n        } @else {\n          <i class="pi pi-lock"></i>\n          \u78BA\u8A8D\u91CD\u8A2D\n        }\n      </button>\n    </form>\n  }\n</div>\n', styles: ["/* apps/web/src/app/features/public/pages/reset-password/reset-password.component.scss */\n.form {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-4);\n}\n.form__field {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-1);\n}\n.form__label {\n  font-size: var(--text-sm);\n  font-weight: var(--font-medium);\n  color: var(--zinc-700);\n}\n.form__input {\n  width: 100%;\n  height: 44px;\n  padding: 0 var(--space-3);\n  font-size: var(--text-md);\n  color: var(--zinc-900);\n  background: #fff;\n  border: 1px solid var(--zinc-300);\n  border-radius: var(--radius-md);\n  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);\n}\n.form__input:focus {\n  outline: none;\n  border-color: var(--accent-500);\n  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);\n}\n.form__input::placeholder {\n  color: var(--zinc-400);\n}\n.form__submit {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: var(--space-2);\n  width: 100%;\n  height: 44px;\n  margin-top: var(--space-2);\n  padding: 0 var(--space-4);\n  font-size: var(--text-md);\n  font-weight: var(--font-semibold);\n  color: #fff;\n  background: var(--zinc-800);\n  border: none;\n  border-radius: var(--radius-md);\n  cursor: pointer;\n  transition: background var(--transition-fast);\n}\n.form__submit:hover {\n  background: var(--zinc-700);\n}\n.form__submit:disabled {\n  opacity: 0.6;\n  cursor: not-allowed;\n}\n.form__row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.form__checkbox {\n  display: flex;\n  align-items: center;\n  gap: var(--space-2);\n  font-size: var(--text-sm);\n  color: var(--zinc-600);\n  cursor: pointer;\n}\n.form__checkbox input[type=checkbox] {\n  width: 16px;\n  height: 16px;\n  accent-color: var(--zinc-800);\n  cursor: pointer;\n}\n.form__link {\n  font-size: var(--text-sm);\n  color: var(--zinc-500);\n  text-decoration: none;\n  transition: color var(--transition-fast);\n}\n.form__link:hover {\n  color: var(--zinc-800);\n}\n.form__link--back {\n  display: inline-flex;\n  align-items: center;\n  gap: var(--space-2);\n  margin-bottom: var(--space-6);\n}\n.form__link--spaced {\n  margin-top: var(--space-4);\n  margin-bottom: 0;\n}\n.message {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  padding: var(--space-3) var(--space-4);\n  border-radius: var(--radius-lg);\n  font-size: var(--text-sm);\n}\n.message--success {\n  background: var(--success-100);\n  color: var(--success-600);\n}\n.message--error {\n  background: var(--error-100);\n  color: var(--error-600);\n}\n.message--info {\n  background: var(--zinc-100);\n  color: var(--zinc-600);\n}\n.auth-content {\n  width: 100%;\n  max-width: 480px;\n  margin: auto;\n  padding: var(--space-4) 0;\n}\n.auth-content__header {\n  margin-bottom: var(--space-6);\n}\n.auth-content__badge {\n  display: inline-block;\n  margin: 0 0 var(--space-3) 0;\n  padding: var(--space-1) var(--space-3);\n  font-size: var(--text-xs);\n  font-weight: var(--font-semibold);\n  text-transform: uppercase;\n  letter-spacing: 0.08em;\n  color: var(--accent-600);\n  background: rgba(14, 165, 233, 0.1);\n  border-radius: var(--radius-full);\n}\n.auth-content__title {\n  margin: 0 0 var(--space-2) 0;\n  font-size: var(--text-2xl);\n  font-weight: var(--font-bold);\n  line-height: var(--leading-tight);\n  color: var(--zinc-900);\n}\n.auth-content__subtitle {\n  margin: 0;\n  font-size: var(--text-md);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-500);\n}\n.auth-content__hint {\n  margin: var(--space-4) 0 0;\n  padding-top: var(--space-4);\n  font-size: var(--text-sm);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-400);\n  border-top: 1px solid var(--zinc-200);\n}\n/*# sourceMappingURL=reset-password.component.css.map */\n"] }]
  }], () => [{ type: SupabaseService }, { type: Router }], null);
})();
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(ResetPasswordComponent, { className: "ResetPasswordComponent", filePath: "apps/web/src/app/features/public/pages/reset-password/reset-password.component.ts", lineNumber: 14 });
})();
export {
  ResetPasswordComponent
};
//# sourceMappingURL=chunk-RLXSGHTP.js.map
