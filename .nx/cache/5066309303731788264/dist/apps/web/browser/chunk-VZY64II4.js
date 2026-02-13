import {
  NavigationService
} from "./chunk-WNZVBO57.js";
import "./chunk-6PJ7S3AC.js";
import "./chunk-IDX5LEWH.js";
import "./chunk-WSLHL2JA.js";
import {
  NavigationStart,
  Router,
  RouterLink,
  RouterLinkActive
} from "./chunk-NFVC465N.js";
import {
  Component,
  HostListener,
  computed,
  inject,
  setClassMetadata,
  signal,
  ɵsetClassDebugInfo,
  ɵɵadvance,
  ɵɵclassMap,
  ɵɵclassProp,
  ɵɵconditional,
  ɵɵconditionalCreate,
  ɵɵdefineComponent,
  ɵɵelement,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵgetCurrentView,
  ɵɵinterpolate1,
  ɵɵlistener,
  ɵɵnextContext,
  ɵɵproperty,
  ɵɵrepeater,
  ɵɵrepeaterCreate,
  ɵɵresetView,
  ɵɵresolveWindow,
  ɵɵrestoreView,
  ɵɵtext,
  ɵɵtextInterpolate
} from "./chunk-YGF3CXFR.js";

// apps/web/src/app/shared/components/bottom-bar/bottom-bar.component.ts
var _forTrack0 = ($index, $item) => $item.route;
function BottomBarComponent_Conditional_0_For_3_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "a", 2);
    \u0275\u0275element(1, "i");
    \u0275\u0275elementStart(2, "span");
    \u0275\u0275text(3);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const item_r1 = ctx.$implicit;
    \u0275\u0275property("routerLink", item_r1.route);
    \u0275\u0275advance();
    \u0275\u0275classMap(\u0275\u0275interpolate1("pi ", item_r1.icon));
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(item_r1.label);
  }
}
function BottomBarComponent_Conditional_0_Conditional_4_Template(rf, ctx) {
  if (rf & 1) {
    const _r2 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "button", 4);
    \u0275\u0275listener("click", function BottomBarComponent_Conditional_0_Conditional_4_Template_button_click_0_listener() {
      \u0275\u0275restoreView(_r2);
      const ctx_r2 = \u0275\u0275nextContext(2);
      return \u0275\u0275resetView(ctx_r2.toggleMore());
    });
    \u0275\u0275element(1, "i", 5);
    \u0275\u0275elementStart(2, "span");
    \u0275\u0275text(3, "\u66F4\u591A");
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext(2);
    \u0275\u0275classProp("bottom-bar__tab--active", ctx_r2.moreOpen());
  }
}
function BottomBarComponent_Conditional_0_Conditional_5_For_5_Template(rf, ctx) {
  if (rf & 1) {
    const _r5 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "a", 11);
    \u0275\u0275listener("click", function BottomBarComponent_Conditional_0_Conditional_5_For_5_Template_a_click_0_listener() {
      \u0275\u0275restoreView(_r5);
      const ctx_r2 = \u0275\u0275nextContext(3);
      return \u0275\u0275resetView(ctx_r2.closeMore());
    });
    \u0275\u0275element(1, "i");
    \u0275\u0275elementStart(2, "span");
    \u0275\u0275text(3);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const item_r6 = ctx.$implicit;
    \u0275\u0275property("routerLink", item_r6.route);
    \u0275\u0275advance();
    \u0275\u0275classMap(\u0275\u0275interpolate1("pi ", item_r6.icon));
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(item_r6.label);
  }
}
function BottomBarComponent_Conditional_0_Conditional_5_Template(rf, ctx) {
  if (rf & 1) {
    const _r4 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "div", 6);
    \u0275\u0275listener("click", function BottomBarComponent_Conditional_0_Conditional_5_Template_div_click_0_listener() {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext(2);
      return \u0275\u0275resetView(ctx_r2.closeMore());
    });
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(1, "div", 7);
    \u0275\u0275element(2, "div", 8);
    \u0275\u0275elementStart(3, "div", 9);
    \u0275\u0275repeaterCreate(4, BottomBarComponent_Conditional_0_Conditional_5_For_5_Template, 4, 5, "a", 10, _forTrack0);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext(2);
    \u0275\u0275classProp("bottom-bar__overlay--closing", ctx_r2.moreClosing());
    \u0275\u0275advance();
    \u0275\u0275classProp("bottom-bar__sheet--closing", ctx_r2.moreClosing());
    \u0275\u0275advance(3);
    \u0275\u0275repeater(ctx_r2.moreTabs());
  }
}
function BottomBarComponent_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "nav", 0)(1, "div", 1);
    \u0275\u0275repeaterCreate(2, BottomBarComponent_Conditional_0_For_3_Template, 4, 5, "a", 2, _forTrack0);
    \u0275\u0275conditionalCreate(4, BottomBarComponent_Conditional_0_Conditional_4_Template, 4, 2, "button", 3);
    \u0275\u0275elementEnd();
    \u0275\u0275conditionalCreate(5, BottomBarComponent_Conditional_0_Conditional_5_Template, 6, 4);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext();
    \u0275\u0275advance(2);
    \u0275\u0275repeater(ctx_r2.primaryTabs());
    \u0275\u0275advance(2);
    \u0275\u0275conditional(ctx_r2.moreTabs().length > 0 ? 4 : -1);
    \u0275\u0275advance();
    \u0275\u0275conditional(ctx_r2.moreOpen() || ctx_r2.moreClosing() ? 5 : -1);
  }
}
var BottomBarComponent = class _BottomBarComponent {
  router = inject(Router);
  nav = inject(NavigationService);
  navItems = this.nav.navItems;
  moreOpen = signal(false, ...ngDevMode ? [{ debugName: "moreOpen" }] : []);
  moreClosing = signal(false, ...ngDevMode ? [{ debugName: "moreClosing" }] : []);
  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.moreOpen.set(false);
      }
    });
  }
  onResize() {
    this.moreOpen.set(false);
  }
  primaryTabs = computed(() => {
    const items = this.navItems();
    return items.length > 4 ? items.slice(0, 4) : items;
  }, ...ngDevMode ? [{ debugName: "primaryTabs" }] : []);
  moreTabs = computed(() => {
    const items = this.navItems();
    return items.length > 4 ? items.slice(4) : [];
  }, ...ngDevMode ? [{ debugName: "moreTabs" }] : []);
  toggleMore() {
    if (this.moreOpen()) {
      this.closeMore();
    } else {
      this.moreOpen.set(true);
    }
  }
  closeMore() {
    if (this.moreClosing())
      return;
    this.moreClosing.set(true);
    setTimeout(() => {
      this.moreOpen.set(false);
      this.moreClosing.set(false);
    }, 350);
  }
  static \u0275fac = function BottomBarComponent_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _BottomBarComponent)();
  };
  static \u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _BottomBarComponent, selectors: [["app-bottom-bar"]], hostBindings: function BottomBarComponent_HostBindings(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275listener("resize", function BottomBarComponent_resize_HostBindingHandler() {
        return ctx.onResize();
      }, \u0275\u0275resolveWindow);
    }
  }, decls: 1, vars: 1, consts: [[1, "bottom-bar"], [1, "bottom-bar__tabs"], ["routerLinkActive", "bottom-bar__tab--active", 1, "bottom-bar__tab", 3, "routerLink"], [1, "bottom-bar__tab", 3, "bottom-bar__tab--active"], [1, "bottom-bar__tab", 3, "click"], [1, "pi", "pi-ellipsis-h"], [1, "bottom-bar__overlay", 3, "click"], [1, "bottom-bar__sheet"], [1, "bottom-bar__sheet-handle"], [1, "bottom-bar__sheet-grid"], ["routerLinkActive", "bottom-bar__sheet-item--active", 1, "bottom-bar__sheet-item", 3, "routerLink"], ["routerLinkActive", "bottom-bar__sheet-item--active", 1, "bottom-bar__sheet-item", 3, "click", "routerLink"]], template: function BottomBarComponent_Template(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275conditionalCreate(0, BottomBarComponent_Conditional_0_Template, 6, 2, "nav", 0);
    }
    if (rf & 2) {
      \u0275\u0275conditional(ctx.navItems().length > 0 ? 0 : -1);
    }
  }, dependencies: [RouterLink, RouterLinkActive], styles: ["\n\n.bottom-bar[_ngcontent-%COMP%] {\n  display: none;\n}\n.bottom-bar__overlay[_ngcontent-%COMP%] {\n  display: none;\n}\n.bottom-bar__sheet[_ngcontent-%COMP%] {\n  display: none;\n}\n@media (max-width: 640px) {\n  .bottom-bar[_ngcontent-%COMP%] {\n    display: flex;\n    flex-direction: column;\n    justify-content: flex-end;\n    position: fixed;\n    bottom: 0;\n    left: 0;\n    right: 0;\n    z-index: 120;\n    pointer-events: none;\n  }\n  .bottom-bar__tabs[_ngcontent-%COMP%] {\n    display: flex;\n    width: 100%;\n    height: 64px;\n    padding-bottom: env(safe-area-inset-bottom, 0px);\n    background: #fff;\n    border-top: 1px solid var(--zinc-200);\n    position: relative;\n    z-index: 110;\n    pointer-events: auto;\n  }\n  .bottom-bar__tab[_ngcontent-%COMP%] {\n    flex: 1;\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    justify-content: center;\n    gap: 3px;\n    color: var(--zinc-400);\n    text-decoration: none;\n    font-size: 10px;\n    font-weight: var(--font-medium);\n    border: none;\n    background: transparent;\n    cursor: pointer;\n    transition: color var(--transition-fast);\n    padding: 0;\n  }\n  .bottom-bar__tab[_ngcontent-%COMP%]   i[_ngcontent-%COMP%] {\n    font-size: 22px;\n  }\n  .bottom-bar__tab--active[_ngcontent-%COMP%] {\n    color: var(--accent-500);\n  }\n  .bottom-bar__overlay[_ngcontent-%COMP%] {\n    display: block;\n    position: fixed;\n    inset: 0;\n    bottom: 64px;\n    background: rgba(0, 0, 0, 0.4);\n    z-index: 100;\n    animation: _ngcontent-%COMP%_fade-in 0.25s ease-out;\n    pointer-events: auto;\n  }\n  .bottom-bar__overlay--closing[_ngcontent-%COMP%] {\n    animation: _ngcontent-%COMP%_fade-out 0.2s ease-in forwards;\n  }\n  .bottom-bar__sheet[_ngcontent-%COMP%] {\n    display: block;\n    position: fixed;\n    left: 0;\n    right: 0;\n    bottom: 64px;\n    background: #fff;\n    border-radius: var(--radius-xl) var(--radius-xl) 0 0;\n    z-index: 105;\n    padding: var(--space-2) var(--space-4) var(--space-4);\n    animation: _ngcontent-%COMP%_sheet-up 0.32s cubic-bezier(0.4, 0, 0.2, 1);\n    pointer-events: auto;\n  }\n  .bottom-bar__sheet--closing[_ngcontent-%COMP%] {\n    animation: _ngcontent-%COMP%_sheet-down 0.35s ease-out forwards;\n  }\n  .bottom-bar__sheet-handle[_ngcontent-%COMP%] {\n    width: 36px;\n    height: 4px;\n    background: var(--zinc-200);\n    border-radius: var(--radius-full);\n    margin: var(--space-2) auto var(--space-4);\n  }\n  .bottom-bar__sheet-grid[_ngcontent-%COMP%] {\n    display: grid;\n    grid-template-columns: repeat(4, 1fr);\n    gap: var(--space-2);\n  }\n  .bottom-bar__sheet-item[_ngcontent-%COMP%] {\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    justify-content: center;\n    gap: var(--space-2);\n    padding: var(--space-3) var(--space-2);\n    border-radius: var(--radius-lg);\n    color: var(--zinc-600);\n    text-decoration: none;\n    font-size: var(--text-xs);\n    font-weight: var(--font-medium);\n    transition: all var(--transition-fast);\n    text-align: center;\n  }\n  .bottom-bar__sheet-item[_ngcontent-%COMP%]   i[_ngcontent-%COMP%] {\n    font-size: 24px;\n  }\n  .bottom-bar__sheet-item[_ngcontent-%COMP%]:hover, \n   .bottom-bar__sheet-item--active[_ngcontent-%COMP%] {\n    background: var(--accent-50);\n    color: var(--accent-600);\n  }\n}\n@keyframes _ngcontent-%COMP%_sheet-up {\n  from {\n    transform: translateY(100%);\n    opacity: 0;\n  }\n  to {\n    transform: translateY(0);\n    opacity: 1;\n  }\n}\n@keyframes _ngcontent-%COMP%_fade-in {\n  from {\n    opacity: 0;\n  }\n  to {\n    opacity: 1;\n  }\n}\n@keyframes _ngcontent-%COMP%_fade-out {\n  from {\n    opacity: 1;\n  }\n  to {\n    opacity: 0;\n  }\n}\n@keyframes _ngcontent-%COMP%_sheet-down {\n  from {\n    transform: translateY(0);\n    opacity: 1;\n  }\n  to {\n    transform: translateY(100%);\n    opacity: 0;\n  }\n}\n/*# sourceMappingURL=bottom-bar.component.css.map */"] });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(BottomBarComponent, [{
    type: Component,
    args: [{ selector: "app-bottom-bar", standalone: true, imports: [RouterLink, RouterLinkActive], template: '@if (navItems().length > 0) {\n  <nav class="bottom-bar">\n    <div class="bottom-bar__tabs">\n      @for (item of primaryTabs(); track item.route) {\n        <a\n          class="bottom-bar__tab"\n          [routerLink]="item.route"\n          routerLinkActive="bottom-bar__tab--active"\n        >\n          <i class="pi {{ item.icon }}"></i>\n          <span>{{ item.label }}</span>\n        </a>\n      }\n      @if (moreTabs().length > 0) {\n        <button\n          class="bottom-bar__tab"\n          [class.bottom-bar__tab--active]="moreOpen()"\n          (click)="toggleMore()"\n        >\n          <i class="pi pi-ellipsis-h"></i>\n          <span>\u66F4\u591A</span>\n        </button>\n      }\n    </div>\n\n    @if (moreOpen() || moreClosing()) {\n      <div class="bottom-bar__overlay" [class.bottom-bar__overlay--closing]="moreClosing()" (click)="closeMore()"></div>\n      <div class="bottom-bar__sheet" [class.bottom-bar__sheet--closing]="moreClosing()">\n        <div class="bottom-bar__sheet-handle"></div>\n        <div class="bottom-bar__sheet-grid">\n          @for (item of moreTabs(); track item.route) {\n            <a\n              class="bottom-bar__sheet-item"\n              [routerLink]="item.route"\n              routerLinkActive="bottom-bar__sheet-item--active"\n              (click)="closeMore()"\n            >\n              <i class="pi {{ item.icon }}"></i>\n              <span>{{ item.label }}</span>\n            </a>\n          }\n        </div>\n      </div>\n    }\n  </nav>\n}\n', styles: ["/* apps/web/src/app/shared/components/bottom-bar/bottom-bar.component.scss */\n.bottom-bar {\n  display: none;\n}\n.bottom-bar__overlay {\n  display: none;\n}\n.bottom-bar__sheet {\n  display: none;\n}\n@media (max-width: 640px) {\n  .bottom-bar {\n    display: flex;\n    flex-direction: column;\n    justify-content: flex-end;\n    position: fixed;\n    bottom: 0;\n    left: 0;\n    right: 0;\n    z-index: 120;\n    pointer-events: none;\n  }\n  .bottom-bar__tabs {\n    display: flex;\n    width: 100%;\n    height: 64px;\n    padding-bottom: env(safe-area-inset-bottom, 0px);\n    background: #fff;\n    border-top: 1px solid var(--zinc-200);\n    position: relative;\n    z-index: 110;\n    pointer-events: auto;\n  }\n  .bottom-bar__tab {\n    flex: 1;\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    justify-content: center;\n    gap: 3px;\n    color: var(--zinc-400);\n    text-decoration: none;\n    font-size: 10px;\n    font-weight: var(--font-medium);\n    border: none;\n    background: transparent;\n    cursor: pointer;\n    transition: color var(--transition-fast);\n    padding: 0;\n  }\n  .bottom-bar__tab i {\n    font-size: 22px;\n  }\n  .bottom-bar__tab--active {\n    color: var(--accent-500);\n  }\n  .bottom-bar__overlay {\n    display: block;\n    position: fixed;\n    inset: 0;\n    bottom: 64px;\n    background: rgba(0, 0, 0, 0.4);\n    z-index: 100;\n    animation: fade-in 0.25s ease-out;\n    pointer-events: auto;\n  }\n  .bottom-bar__overlay--closing {\n    animation: fade-out 0.2s ease-in forwards;\n  }\n  .bottom-bar__sheet {\n    display: block;\n    position: fixed;\n    left: 0;\n    right: 0;\n    bottom: 64px;\n    background: #fff;\n    border-radius: var(--radius-xl) var(--radius-xl) 0 0;\n    z-index: 105;\n    padding: var(--space-2) var(--space-4) var(--space-4);\n    animation: sheet-up 0.32s cubic-bezier(0.4, 0, 0.2, 1);\n    pointer-events: auto;\n  }\n  .bottom-bar__sheet--closing {\n    animation: sheet-down 0.35s ease-out forwards;\n  }\n  .bottom-bar__sheet-handle {\n    width: 36px;\n    height: 4px;\n    background: var(--zinc-200);\n    border-radius: var(--radius-full);\n    margin: var(--space-2) auto var(--space-4);\n  }\n  .bottom-bar__sheet-grid {\n    display: grid;\n    grid-template-columns: repeat(4, 1fr);\n    gap: var(--space-2);\n  }\n  .bottom-bar__sheet-item {\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    justify-content: center;\n    gap: var(--space-2);\n    padding: var(--space-3) var(--space-2);\n    border-radius: var(--radius-lg);\n    color: var(--zinc-600);\n    text-decoration: none;\n    font-size: var(--text-xs);\n    font-weight: var(--font-medium);\n    transition: all var(--transition-fast);\n    text-align: center;\n  }\n  .bottom-bar__sheet-item i {\n    font-size: 24px;\n  }\n  .bottom-bar__sheet-item:hover,\n  .bottom-bar__sheet-item--active {\n    background: var(--accent-50);\n    color: var(--accent-600);\n  }\n}\n@keyframes sheet-up {\n  from {\n    transform: translateY(100%);\n    opacity: 0;\n  }\n  to {\n    transform: translateY(0);\n    opacity: 1;\n  }\n}\n@keyframes fade-in {\n  from {\n    opacity: 0;\n  }\n  to {\n    opacity: 1;\n  }\n}\n@keyframes fade-out {\n  from {\n    opacity: 1;\n  }\n  to {\n    opacity: 0;\n  }\n}\n@keyframes sheet-down {\n  from {\n    transform: translateY(0);\n    opacity: 1;\n  }\n  to {\n    transform: translateY(100%);\n    opacity: 0;\n  }\n}\n/*# sourceMappingURL=bottom-bar.component.css.map */\n"] }]
  }], () => [], { onResize: [{
    type: HostListener,
    args: ["window:resize"]
  }] });
})();
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(BottomBarComponent, { className: "BottomBarComponent", filePath: "apps/web/src/app/shared/components/bottom-bar/bottom-bar.component.ts", lineNumber: 12 });
})();
export {
  BottomBarComponent
};
//# sourceMappingURL=chunk-VZY64II4.js.map
