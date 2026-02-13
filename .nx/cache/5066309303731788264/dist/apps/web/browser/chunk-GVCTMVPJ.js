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
import "./chunk-WSLHL2JA.js";
import {
  Router
} from "./chunk-NFVC465N.js";
import {
  Component,
  inject,
  setClassMetadata,
  signal,
  ɵsetClassDebugInfo,
  ɵɵadvance,
  ɵɵconditional,
  ɵɵconditionalCreate,
  ɵɵdefineComponent,
  ɵɵelement,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵgetCurrentView,
  ɵɵlistener,
  ɵɵnextContext,
  ɵɵproperty,
  ɵɵreference,
  ɵɵresetView,
  ɵɵrestoreView,
  ɵɵtext,
  ɵɵtextInterpolate,
  ɵɵtwoWayBindingSet,
  ɵɵtwoWayListener,
  ɵɵtwoWayProperty
} from "./chunk-YGF3CXFR.js";

// apps/web/src/app/features/public/pages/change-password/change-password.component.ts
function ChangePasswordComponent_Conditional_9_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 9);
    \u0275\u0275element(1, "i", 11);
    \u0275\u0275elementStart(2, "span");
    \u0275\u0275text(3, "\u5BC6\u78BC\u4FEE\u6539\u6210\u529F\uFF01\u5373\u5C07\u8DF3\u56DE\u9996\u9801...");
    \u0275\u0275elementEnd()();
  }
}
function ChangePasswordComponent_Conditional_10_Conditional_2_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 13);
    \u0275\u0275element(1, "i", 22);
    \u0275\u0275elementStart(2, "span");
    \u0275\u0275text(3);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r1 = \u0275\u0275nextContext(2);
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate(ctx_r1.error());
  }
}
function ChangePasswordComponent_Conditional_10_Conditional_17_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275element(0, "i", 23);
    \u0275\u0275text(1, " \u8655\u7406\u4E2D... ");
  }
}
function ChangePasswordComponent_Conditional_10_Conditional_18_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275text(0, " \u78BA\u8A8D\u4FEE\u6539 ");
  }
}
function ChangePasswordComponent_Conditional_10_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "form", 12, 0);
    \u0275\u0275listener("ngSubmit", function ChangePasswordComponent_Conditional_10_Template_form_ngSubmit_0_listener() {
      \u0275\u0275restoreView(_r1);
      const ctx_r1 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r1.onSubmit());
    });
    \u0275\u0275conditionalCreate(2, ChangePasswordComponent_Conditional_10_Conditional_2_Template, 4, 1, "div", 13);
    \u0275\u0275elementStart(3, "div", 14)(4, "label", 15);
    \u0275\u0275text(5, "\u65B0\u5BC6\u78BC");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(6, "input", 16, 1);
    \u0275\u0275twoWayListener("ngModelChange", function ChangePasswordComponent_Conditional_10_Template_input_ngModelChange_6_listener($event) {
      \u0275\u0275restoreView(_r1);
      const ctx_r1 = \u0275\u0275nextContext();
      \u0275\u0275twoWayBindingSet(ctx_r1.newPassword, $event) || (ctx_r1.newPassword = $event);
      return \u0275\u0275resetView($event);
    });
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(8, "div", 14)(9, "label", 17);
    \u0275\u0275text(10, "\u78BA\u8A8D\u65B0\u5BC6\u78BC");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(11, "input", 18, 2);
    \u0275\u0275twoWayListener("ngModelChange", function ChangePasswordComponent_Conditional_10_Template_input_ngModelChange_11_listener($event) {
      \u0275\u0275restoreView(_r1);
      const ctx_r1 = \u0275\u0275nextContext();
      \u0275\u0275twoWayBindingSet(ctx_r1.confirmPassword, $event) || (ctx_r1.confirmPassword = $event);
      return \u0275\u0275resetView($event);
    });
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(13, "div", 19)(14, "button", 20);
    \u0275\u0275listener("click", function ChangePasswordComponent_Conditional_10_Template_button_click_14_listener() {
      \u0275\u0275restoreView(_r1);
      const ctx_r1 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r1.goBack());
    });
    \u0275\u0275text(15, " \u53D6\u6D88 ");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(16, "button", 21);
    \u0275\u0275conditionalCreate(17, ChangePasswordComponent_Conditional_10_Conditional_17_Template, 2, 0)(18, ChangePasswordComponent_Conditional_10_Conditional_18_Template, 1, 0);
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const passwordForm_r3 = \u0275\u0275reference(1);
    const ctx_r1 = \u0275\u0275nextContext();
    \u0275\u0275advance(2);
    \u0275\u0275conditional(ctx_r1.error() ? 2 : -1);
    \u0275\u0275advance(4);
    \u0275\u0275twoWayProperty("ngModel", ctx_r1.newPassword);
    \u0275\u0275advance(5);
    \u0275\u0275twoWayProperty("ngModel", ctx_r1.confirmPassword);
    \u0275\u0275advance(3);
    \u0275\u0275property("disabled", ctx_r1.submitting());
    \u0275\u0275advance(2);
    \u0275\u0275property("disabled", ctx_r1.submitting() || !passwordForm_r3.valid);
    \u0275\u0275advance();
    \u0275\u0275conditional(ctx_r1.submitting() ? 17 : 18);
  }
}
var ChangePasswordComponent = class _ChangePasswordComponent {
  auth = inject(AuthService);
  router = inject(Router);
  newPassword = "";
  confirmPassword = "";
  submitting = signal(false, ...ngDevMode ? [{ debugName: "submitting" }] : []);
  error = signal(null, ...ngDevMode ? [{ debugName: "error" }] : []);
  success = signal(false, ...ngDevMode ? [{ debugName: "success" }] : []);
  async onSubmit() {
    if (!this.newPassword) {
      this.error.set("\u8ACB\u8F38\u5165\u65B0\u5BC6\u78BC");
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.error.set("\u5169\u6B21\u8F38\u5165\u7684\u5BC6\u78BC\u4E0D\u4E00\u81F4");
      return;
    }
    if (this.newPassword.length < 6) {
      this.error.set("\u5BC6\u78BC\u9577\u5EA6\u81F3\u5C11\u9700\u8981 6 \u4F4D\u5143\u7D44");
      return;
    }
    this.error.set(null);
    this.submitting.set(true);
    try {
      const errorMsg = await this.auth.updatePassword(this.newPassword);
      if (errorMsg) {
        this.error.set(errorMsg);
      } else {
        this.success.set(true);
        setTimeout(() => {
          this.goBack();
        }, 2e3);
      }
    } catch (e) {
      this.error.set("\u767C\u751F\u672A\u77E5\u932F\u8AA4\uFF0C\u8ACB\u91CD\u8A66");
    } finally {
      this.submitting.set(false);
    }
  }
  goBack() {
    const role = this.auth.activeRole();
    if (role) {
      this.router.navigate([`/${role}`]);
    } else {
      this.router.navigate(["/select-role"]);
    }
  }
  static \u0275fac = function ChangePasswordComponent_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _ChangePasswordComponent)();
  };
  static \u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _ChangePasswordComponent, selectors: [["app-change-password"]], hostAttrs: [1, "u-centered-flex"], decls: 11, vars: 1, consts: [["passwordForm", "ngForm"], ["newPassModel", "ngModel"], ["confirmPassModel", "ngModel"], [1, "change-password", "change-password-page"], [1, "auth-content"], [1, "auth-content__header"], [1, "auth-content__badge"], [1, "auth-content__title"], [1, "auth-content__subtitle"], [1, "message", "message--success"], [1, "form"], [1, "pi", "pi-check-circle"], [1, "form", 3, "ngSubmit"], [1, "message", "message--error"], [1, "form__field"], ["for", "newPassword", 1, "form__label"], ["type", "password", "id", "newPassword", "name", "newPassword", "placeholder", "\u81F3\u5C11 6 \u4F4D\u5143\u7D44", "required", "", 1, "form__input", 3, "ngModelChange", "ngModel"], ["for", "confirmPassword", 1, "form__label"], ["type", "password", "id", "confirmPassword", "name", "confirmPassword", "placeholder", "\u8ACB\u518D\u6B21\u8F38\u5165\u65B0\u5BC6\u78BC", "required", "", 1, "form__input", 3, "ngModelChange", "ngModel"], [1, "form__row", 2, "justify-content", "flex-end", "gap", "var(--space-3)"], ["type", "button", 1, "form__submit", 2, "background", "var(--zinc-200)", "color", "var(--zinc-700)", "width", "auto", "padding", "var(--space-2) var(--space-6)", 3, "click", "disabled"], ["type", "submit", 1, "form__submit", 2, "width", "auto", "padding", "var(--space-2) var(--space-8)", 3, "disabled"], [1, "pi", "pi-exclamation-circle"], [1, "pi", "pi-spin", "pi-spinner"]], template: function ChangePasswordComponent_Template(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275elementStart(0, "div", 3)(1, "div", 4)(2, "header", 5)(3, "p", 6);
      \u0275\u0275text(4, "\u5E33\u865F\u5B89\u5168");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(5, "h1", 7);
      \u0275\u0275text(6, "\u4FEE\u6539\u5BC6\u78BC");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(7, "p", 8);
      \u0275\u0275text(8, "\u8ACB\u8F38\u5165\u60A8\u7684\u65B0\u5BC6\u78BC\uFF0C\u78BA\u4FDD\u5E33\u865F\u5B89\u5168\u3002");
      \u0275\u0275elementEnd()();
      \u0275\u0275conditionalCreate(9, ChangePasswordComponent_Conditional_9_Template, 4, 0, "div", 9)(10, ChangePasswordComponent_Conditional_10_Template, 19, 6, "form", 10);
      \u0275\u0275elementEnd()();
    }
    if (rf & 2) {
      \u0275\u0275advance(9);
      \u0275\u0275conditional(ctx.success() ? 9 : 10);
    }
  }, dependencies: [FormsModule, \u0275NgNoValidate, DefaultValueAccessor, NgControlStatus, NgControlStatusGroup, RequiredValidator, NgModel, NgForm], styles: ["\n\n.form[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-4);\n}\n.form__field[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-1);\n}\n.form__label[_ngcontent-%COMP%] {\n  font-size: var(--text-sm);\n  font-weight: var(--font-medium);\n  color: var(--zinc-700);\n}\n.form__input[_ngcontent-%COMP%] {\n  width: 100%;\n  height: 44px;\n  padding: 0 var(--space-3);\n  font-size: var(--text-md);\n  color: var(--zinc-900);\n  background: #fff;\n  border: 1px solid var(--zinc-300);\n  border-radius: var(--radius-md);\n  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);\n}\n.form__input[_ngcontent-%COMP%]:focus {\n  outline: none;\n  border-color: var(--accent-500);\n  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);\n}\n.form__input[_ngcontent-%COMP%]::placeholder {\n  color: var(--zinc-400);\n}\n.form__submit[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: var(--space-2);\n  width: 100%;\n  height: 44px;\n  margin-top: var(--space-2);\n  padding: 0 var(--space-4);\n  font-size: var(--text-md);\n  font-weight: var(--font-semibold);\n  color: #fff;\n  background: var(--zinc-800);\n  border: none;\n  border-radius: var(--radius-md);\n  cursor: pointer;\n  transition: background var(--transition-fast);\n}\n.form__submit[_ngcontent-%COMP%]:hover {\n  background: var(--zinc-700);\n}\n.form__submit[_ngcontent-%COMP%]:disabled {\n  opacity: 0.6;\n  cursor: not-allowed;\n}\n.form__row[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.form__checkbox[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: var(--space-2);\n  font-size: var(--text-sm);\n  color: var(--zinc-600);\n  cursor: pointer;\n}\n.form__checkbox[_ngcontent-%COMP%]   input[type=checkbox][_ngcontent-%COMP%] {\n  width: 16px;\n  height: 16px;\n  accent-color: var(--zinc-800);\n  cursor: pointer;\n}\n.form__link[_ngcontent-%COMP%] {\n  font-size: var(--text-sm);\n  color: var(--zinc-500);\n  text-decoration: none;\n  transition: color var(--transition-fast);\n}\n.form__link[_ngcontent-%COMP%]:hover {\n  color: var(--zinc-800);\n}\n.form__link--back[_ngcontent-%COMP%] {\n  display: inline-flex;\n  align-items: center;\n  gap: var(--space-2);\n  margin-bottom: var(--space-6);\n}\n.form__link--spaced[_ngcontent-%COMP%] {\n  margin-top: var(--space-4);\n  margin-bottom: 0;\n}\n.message[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  padding: var(--space-3) var(--space-4);\n  border-radius: var(--radius-lg);\n  font-size: var(--text-sm);\n}\n.message--success[_ngcontent-%COMP%] {\n  background: var(--success-100);\n  color: var(--success-600);\n}\n.message--error[_ngcontent-%COMP%] {\n  background: var(--error-100);\n  color: var(--error-600);\n}\n.message--info[_ngcontent-%COMP%] {\n  background: var(--zinc-100);\n  color: var(--zinc-600);\n}\n.auth-content[_ngcontent-%COMP%] {\n  width: 100%;\n  max-width: 480px;\n  margin: auto;\n  padding: var(--space-4) 0;\n}\n.auth-content__header[_ngcontent-%COMP%] {\n  margin-bottom: var(--space-6);\n}\n.auth-content__badge[_ngcontent-%COMP%] {\n  display: inline-block;\n  margin: 0 0 var(--space-3) 0;\n  padding: var(--space-1) var(--space-3);\n  font-size: var(--text-xs);\n  font-weight: var(--font-semibold);\n  text-transform: uppercase;\n  letter-spacing: 0.08em;\n  color: var(--accent-600);\n  background: rgba(14, 165, 233, 0.1);\n  border-radius: var(--radius-full);\n}\n.auth-content__title[_ngcontent-%COMP%] {\n  margin: 0 0 var(--space-2) 0;\n  font-size: var(--text-2xl);\n  font-weight: var(--font-bold);\n  line-height: var(--leading-tight);\n  color: var(--zinc-900);\n}\n.auth-content__subtitle[_ngcontent-%COMP%] {\n  margin: 0;\n  font-size: var(--text-md);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-500);\n}\n.auth-content__hint[_ngcontent-%COMP%] {\n  margin: var(--space-4) 0 0;\n  padding-top: var(--space-4);\n  font-size: var(--text-sm);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-400);\n  border-top: 1px solid var(--zinc-200);\n}\n/*# sourceMappingURL=change-password.component.css.map */"] });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(ChangePasswordComponent, [{
    type: Component,
    args: [{ selector: "app-change-password", standalone: true, imports: [FormsModule], host: { class: "u-centered-flex" }, template: '<div class="change-password change-password-page">\n  <div class="auth-content">\n    <header class="auth-content__header">\n      <p class="auth-content__badge">\u5E33\u865F\u5B89\u5168</p>\n      <h1 class="auth-content__title">\u4FEE\u6539\u5BC6\u78BC</h1>\n      <p class="auth-content__subtitle">\u8ACB\u8F38\u5165\u60A8\u7684\u65B0\u5BC6\u78BC\uFF0C\u78BA\u4FDD\u5E33\u865F\u5B89\u5168\u3002</p>\n    </header>\n\n    @if (success()) {\n      <div class="message message--success">\n        <i class="pi pi-check-circle"></i>\n        <span>\u5BC6\u78BC\u4FEE\u6539\u6210\u529F\uFF01\u5373\u5C07\u8DF3\u56DE\u9996\u9801...</span>\n      </div>\n    } @else {\n      <form (ngSubmit)="onSubmit()" #passwordForm="ngForm" class="form">\n        @if (error()) {\n          <div class="message message--error">\n            <i class="pi pi-exclamation-circle"></i>\n            <span>{{ error() }}</span>\n          </div>\n        }\n\n        <div class="form__field">\n          <label class="form__label" for="newPassword">\u65B0\u5BC6\u78BC</label>\n          <input\n            type="password"\n            id="newPassword"\n            class="form__input"\n            name="newPassword"\n            [(ngModel)]="newPassword"\n            placeholder="\u81F3\u5C11 6 \u4F4D\u5143\u7D44"\n            required\n            #newPassModel="ngModel"\n          />\n        </div>\n\n        <div class="form__field">\n          <label class="form__label" for="confirmPassword">\u78BA\u8A8D\u65B0\u5BC6\u78BC</label>\n          <input\n            type="password"\n            id="confirmPassword"\n            class="form__input"\n            name="confirmPassword"\n            [(ngModel)]="confirmPassword"\n            placeholder="\u8ACB\u518D\u6B21\u8F38\u5165\u65B0\u5BC6\u78BC"\n            required\n            #confirmPassModel="ngModel"\n          />\n        </div>\n\n        <div class="form__row" style="justify-content: flex-end; gap: var(--space-3);">\n          <button\n            type="button"\n            class="form__submit"\n            style="background: var(--zinc-200); color: var(--zinc-700); width: auto; padding: var(--space-2) var(--space-6);"\n            (click)="goBack()"\n            [disabled]="submitting()"\n          >\n            \u53D6\u6D88\n          </button>\n          <button\n            type="submit"\n            class="form__submit"\n            style="width: auto; padding: var(--space-2) var(--space-8);"\n            [disabled]="submitting() || !passwordForm.valid"\n          >\n            @if (submitting()) {\n              <i class="pi pi-spin pi-spinner"></i>\n              \u8655\u7406\u4E2D...\n            } @else {\n              \u78BA\u8A8D\u4FEE\u6539\n            }\n          </button>\n        </div>\n      </form>\n    }\n  </div>\n</div>\n', styles: ["/* apps/web/src/app/features/public/pages/change-password/change-password.component.scss */\n.form {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-4);\n}\n.form__field {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-1);\n}\n.form__label {\n  font-size: var(--text-sm);\n  font-weight: var(--font-medium);\n  color: var(--zinc-700);\n}\n.form__input {\n  width: 100%;\n  height: 44px;\n  padding: 0 var(--space-3);\n  font-size: var(--text-md);\n  color: var(--zinc-900);\n  background: #fff;\n  border: 1px solid var(--zinc-300);\n  border-radius: var(--radius-md);\n  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);\n}\n.form__input:focus {\n  outline: none;\n  border-color: var(--accent-500);\n  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);\n}\n.form__input::placeholder {\n  color: var(--zinc-400);\n}\n.form__submit {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: var(--space-2);\n  width: 100%;\n  height: 44px;\n  margin-top: var(--space-2);\n  padding: 0 var(--space-4);\n  font-size: var(--text-md);\n  font-weight: var(--font-semibold);\n  color: #fff;\n  background: var(--zinc-800);\n  border: none;\n  border-radius: var(--radius-md);\n  cursor: pointer;\n  transition: background var(--transition-fast);\n}\n.form__submit:hover {\n  background: var(--zinc-700);\n}\n.form__submit:disabled {\n  opacity: 0.6;\n  cursor: not-allowed;\n}\n.form__row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.form__checkbox {\n  display: flex;\n  align-items: center;\n  gap: var(--space-2);\n  font-size: var(--text-sm);\n  color: var(--zinc-600);\n  cursor: pointer;\n}\n.form__checkbox input[type=checkbox] {\n  width: 16px;\n  height: 16px;\n  accent-color: var(--zinc-800);\n  cursor: pointer;\n}\n.form__link {\n  font-size: var(--text-sm);\n  color: var(--zinc-500);\n  text-decoration: none;\n  transition: color var(--transition-fast);\n}\n.form__link:hover {\n  color: var(--zinc-800);\n}\n.form__link--back {\n  display: inline-flex;\n  align-items: center;\n  gap: var(--space-2);\n  margin-bottom: var(--space-6);\n}\n.form__link--spaced {\n  margin-top: var(--space-4);\n  margin-bottom: 0;\n}\n.message {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  padding: var(--space-3) var(--space-4);\n  border-radius: var(--radius-lg);\n  font-size: var(--text-sm);\n}\n.message--success {\n  background: var(--success-100);\n  color: var(--success-600);\n}\n.message--error {\n  background: var(--error-100);\n  color: var(--error-600);\n}\n.message--info {\n  background: var(--zinc-100);\n  color: var(--zinc-600);\n}\n.auth-content {\n  width: 100%;\n  max-width: 480px;\n  margin: auto;\n  padding: var(--space-4) 0;\n}\n.auth-content__header {\n  margin-bottom: var(--space-6);\n}\n.auth-content__badge {\n  display: inline-block;\n  margin: 0 0 var(--space-3) 0;\n  padding: var(--space-1) var(--space-3);\n  font-size: var(--text-xs);\n  font-weight: var(--font-semibold);\n  text-transform: uppercase;\n  letter-spacing: 0.08em;\n  color: var(--accent-600);\n  background: rgba(14, 165, 233, 0.1);\n  border-radius: var(--radius-full);\n}\n.auth-content__title {\n  margin: 0 0 var(--space-2) 0;\n  font-size: var(--text-2xl);\n  font-weight: var(--font-bold);\n  line-height: var(--leading-tight);\n  color: var(--zinc-900);\n}\n.auth-content__subtitle {\n  margin: 0;\n  font-size: var(--text-md);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-500);\n}\n.auth-content__hint {\n  margin: var(--space-4) 0 0;\n  padding-top: var(--space-4);\n  font-size: var(--text-sm);\n  line-height: var(--leading-relaxed);\n  color: var(--zinc-400);\n  border-top: 1px solid var(--zinc-200);\n}\n/*# sourceMappingURL=change-password.component.css.map */\n"] }]
  }], null, null);
})();
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(ChangePasswordComponent, { className: "ChangePasswordComponent", filePath: "apps/web/src/app/features/public/pages/change-password/change-password.component.ts", lineNumber: 14 });
})();
export {
  ChangePasswordComponent
};
//# sourceMappingURL=chunk-GVCTMVPJ.js.map
