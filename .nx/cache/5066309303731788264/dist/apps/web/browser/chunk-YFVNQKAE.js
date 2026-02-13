import {
  RoutesCatalog
} from "./chunk-6PJ7S3AC.js";
import {
  animate,
  query,
  sequence,
  style,
  transition,
  trigger
} from "./chunk-SL6AJBIB.js";
import {
  ChildrenOutletContexts,
  RouterLink,
  RouterLinkActive,
  RouterOutlet
} from "./chunk-NFVC465N.js";
import {
  ANIMATION_MODULE_TYPE,
  Component,
  DOCUMENT,
  Inject,
  Injectable,
  RendererFactory2,
  RuntimeError,
  ViewEncapsulation,
  inject,
  setClassMetadata,
  signal,
  ɵsetClassDebugInfo,
  ɵɵadvance,
  ɵɵclassMap,
  ɵɵclassProp,
  ɵɵdefineComponent,
  ɵɵdefineInjectable,
  ɵɵelement,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵgetCurrentView,
  ɵɵinject,
  ɵɵinterpolate1,
  ɵɵlistener,
  ɵɵnextContext,
  ɵɵproperty,
  ɵɵpureFunction0,
  ɵɵrepeater,
  ɵɵrepeaterCreate,
  ɵɵresetView,
  ɵɵrestoreView,
  ɵɵtext,
  ɵɵtextInterpolate
} from "./chunk-YGF3CXFR.js";

// node_modules/@angular/animations/fesm2022/animations.mjs
var AnimationBuilder = class _AnimationBuilder {
  static \u0275fac = function AnimationBuilder_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _AnimationBuilder)();
  };
  static \u0275prov = /* @__PURE__ */ \u0275\u0275defineInjectable({
    token: _AnimationBuilder,
    factory: () => (() => inject(BrowserAnimationBuilder))(),
    providedIn: "root"
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(AnimationBuilder, [{
    type: Injectable,
    args: [{
      providedIn: "root",
      useFactory: () => inject(BrowserAnimationBuilder)
    }]
  }], null, null);
})();
var AnimationFactory = class {
};
var BrowserAnimationBuilder = class _BrowserAnimationBuilder extends AnimationBuilder {
  animationModuleType = inject(ANIMATION_MODULE_TYPE, {
    optional: true
  });
  _nextAnimationId = 0;
  _renderer;
  constructor(rootRenderer, doc) {
    super();
    const typeData = {
      id: "0",
      encapsulation: ViewEncapsulation.None,
      styles: [],
      data: {
        animation: []
      }
    };
    this._renderer = rootRenderer.createRenderer(doc.body, typeData);
    if (this.animationModuleType === null && !isAnimationRenderer(this._renderer)) {
      throw new RuntimeError(3600, (typeof ngDevMode === "undefined" || ngDevMode) && "Angular detected that the `AnimationBuilder` was injected, but animation support was not enabled. Please make sure that you enable animations in your application by calling `provideAnimations()` or `provideAnimationsAsync()` function.");
    }
  }
  build(animation2) {
    const id = this._nextAnimationId;
    this._nextAnimationId++;
    const entry = Array.isArray(animation2) ? sequence(animation2) : animation2;
    issueAnimationCommand(this._renderer, null, id, "register", [entry]);
    return new BrowserAnimationFactory(id, this._renderer);
  }
  static \u0275fac = function BrowserAnimationBuilder_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _BrowserAnimationBuilder)(\u0275\u0275inject(RendererFactory2), \u0275\u0275inject(DOCUMENT));
  };
  static \u0275prov = /* @__PURE__ */ \u0275\u0275defineInjectable({
    token: _BrowserAnimationBuilder,
    factory: _BrowserAnimationBuilder.\u0275fac,
    providedIn: "root"
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(BrowserAnimationBuilder, [{
    type: Injectable,
    args: [{
      providedIn: "root"
    }]
  }], () => [{
    type: RendererFactory2
  }, {
    type: Document,
    decorators: [{
      type: Inject,
      args: [DOCUMENT]
    }]
  }], null);
})();
var BrowserAnimationFactory = class extends AnimationFactory {
  _id;
  _renderer;
  constructor(_id, _renderer) {
    super();
    this._id = _id;
    this._renderer = _renderer;
  }
  create(element, options) {
    return new RendererAnimationPlayer(this._id, element, options || {}, this._renderer);
  }
};
var RendererAnimationPlayer = class {
  id;
  element;
  _renderer;
  parentPlayer = null;
  _started = false;
  constructor(id, element, options, _renderer) {
    this.id = id;
    this.element = element;
    this._renderer = _renderer;
    this._command("create", options);
  }
  _listen(eventName, callback) {
    return this._renderer.listen(this.element, `@@${this.id}:${eventName}`, callback);
  }
  _command(command, ...args) {
    issueAnimationCommand(this._renderer, this.element, this.id, command, args);
  }
  onDone(fn) {
    this._listen("done", fn);
  }
  onStart(fn) {
    this._listen("start", fn);
  }
  onDestroy(fn) {
    this._listen("destroy", fn);
  }
  init() {
    this._command("init");
  }
  hasStarted() {
    return this._started;
  }
  play() {
    this._command("play");
    this._started = true;
  }
  pause() {
    this._command("pause");
  }
  restart() {
    this._command("restart");
  }
  finish() {
    this._command("finish");
  }
  destroy() {
    this._command("destroy");
  }
  reset() {
    this._command("reset");
    this._started = false;
  }
  setPosition(p) {
    this._command("setPosition", p);
  }
  getPosition() {
    return unwrapAnimationRenderer(this._renderer)?.engine?.players[this.id]?.getPosition() ?? 0;
  }
  totalTime = 0;
};
function issueAnimationCommand(renderer, element, id, command, args) {
  renderer.setProperty(element, `@@${id}:${command}`, args);
}
function unwrapAnimationRenderer(renderer) {
  const type = renderer.\u0275type;
  if (type === 0) {
    return renderer;
  } else if (type === 1) {
    return renderer.animationRenderer;
  }
  return null;
}
function isAnimationRenderer(renderer) {
  const type = renderer.\u0275type;
  return type === 0 || type === 1;
}

// apps/web/src/app/shared/animations.ts
var fadeAnimation = trigger("fadeAnimation", [
  transition("* => *", [
    style({ position: "relative", minHeight: "100%" }),
    query(":enter, :leave", [
      style({
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center"
      })
    ], { optional: true }),
    query(":enter", [style({ opacity: 0 })], { optional: true }),
    query(":leave", [animate("150ms ease-in", style({ opacity: 0 }))], { optional: true }),
    query(":enter", [animate("250ms ease-out", style({ opacity: 1 }))], { optional: true })
  ])
]);

// apps/web/src/app/features/public/public-shell.component.ts
var _c0 = () => ({ exact: true });
var _c1 = () => ({ exact: false });
var _forTrack0 = ($index, $item) => $item.absolutePath;
function PublicShellComponent_For_14_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "a", 9);
    \u0275\u0275element(1, "i");
    \u0275\u0275elementStart(2, "span");
    \u0275\u0275text(3);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const item_r1 = ctx.$implicit;
    \u0275\u0275property("routerLink", item_r1.absolutePath)("routerLinkActiveOptions", item_r1.absolutePath === "/login" ? \u0275\u0275pureFunction0(6, _c0) : \u0275\u0275pureFunction0(7, _c1));
    \u0275\u0275advance();
    \u0275\u0275classMap(\u0275\u0275interpolate1("pi ", item_r1.icon));
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(item_r1.label);
  }
}
function PublicShellComponent_For_31_Template(rf, ctx) {
  if (rf & 1) {
    const _r2 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "a", 23);
    \u0275\u0275listener("click", function PublicShellComponent_For_31_Template_a_click_0_listener() {
      \u0275\u0275restoreView(_r2);
      const ctx_r2 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r2.toggleMenu());
    });
    \u0275\u0275element(1, "i");
    \u0275\u0275elementStart(2, "span");
    \u0275\u0275text(3);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const item_r4 = ctx.$implicit;
    \u0275\u0275property("routerLink", item_r4.absolutePath)("routerLinkActiveOptions", item_r4.absolutePath === "/login" ? \u0275\u0275pureFunction0(6, _c0) : \u0275\u0275pureFunction0(7, _c1));
    \u0275\u0275advance();
    \u0275\u0275classMap(\u0275\u0275interpolate1("pi ", item_r4.icon));
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(item_r4.label);
  }
}
var PublicShellComponent = class _PublicShellComponent {
  contexts = inject(ChildrenOutletContexts);
  menuOpen = signal(false, ...ngDevMode ? [{ debugName: "menuOpen" }] : []);
  publicRoutes = RoutesCatalog.values.filter((r) => !r.role && r.showInMenu);
  getRouteAnimationData() {
    return this.contexts.getContext("primary")?.route?.snapshot?.data?.["animation"];
  }
  toggleMenu() {
    this.menuOpen.update((v) => !v);
  }
  static \u0275fac = function PublicShellComponent_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _PublicShellComponent)();
  };
  static \u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _PublicShellComponent, selectors: [["app-public-shell"]], decls: 35, vars: 9, consts: [[1, "public-shell"], [1, "public-shell__brand"], [1, "public-shell__brand-content"], ["routerLink", "/login", 1, "public-shell__logo"], [1, "public-shell__logo-icon"], [1, "public-shell__logo-text"], [1, "public-shell__tagline"], [1, "public-shell__slogan"], [1, "public-shell__nav"], ["routerLinkActive", "public-shell__nav-link--active", 1, "public-shell__nav-link", 3, "routerLink", "routerLinkActiveOptions"], [1, "public-shell__copyright"], ["type", "button", 1, "hamburger", "hamburger--squeeze", "public-shell__hamburger", 3, "click"], [1, "hamburger-box"], [1, "hamburger-inner"], [1, "public-shell__overlay", 3, "click"], [1, "public-shell__sidebar"], [1, "public-shell__sidebar-header"], ["routerLink", "/login", 1, "public-shell__logo", 3, "click"], [1, "public-shell__sidebar-close", 3, "click"], [1, "pi", "pi-times"], ["routerLinkActive", "public-shell__sidebar-link--active", 1, "public-shell__sidebar-link", 3, "routerLink", "routerLinkActiveOptions"], [1, "public-shell__main"], [1, "shell-route-wrapper", "u-fill-route-child"], ["routerLinkActive", "public-shell__sidebar-link--active", 1, "public-shell__sidebar-link", 3, "click", "routerLink", "routerLinkActiveOptions"]], template: function PublicShellComponent_Template(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275elementStart(0, "section", 0)(1, "aside", 1)(2, "div", 2)(3, "a", 3)(4, "span", 4);
      \u0275\u0275text(5, "C");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(6, "span", 5);
      \u0275\u0275text(7, "Clessia");
      \u0275\u0275elementEnd()();
      \u0275\u0275elementStart(8, "h2", 6);
      \u0275\u0275text(9, "\u5B78\u7A0B\u7BA1\u5BB6");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(10, "p", 7);
      \u0275\u0275text(11, "\u8B93\u5B78\u7FD2\u65C5\u7A0B\u66F4\u8F15\u9B06");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(12, "nav", 8);
      \u0275\u0275repeaterCreate(13, PublicShellComponent_For_14_Template, 4, 8, "a", 9, _forTrack0);
      \u0275\u0275elementEnd()();
      \u0275\u0275elementStart(15, "p", 10);
      \u0275\u0275text(16, "\xA9 2025 Clessia Academy");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(17, "button", 11);
      \u0275\u0275listener("click", function PublicShellComponent_Template_button_click_17_listener() {
        return ctx.toggleMenu();
      });
      \u0275\u0275elementStart(18, "span", 12);
      \u0275\u0275element(19, "span", 13);
      \u0275\u0275elementEnd()()();
      \u0275\u0275elementStart(20, "div", 14);
      \u0275\u0275listener("click", function PublicShellComponent_Template_div_click_20_listener() {
        return ctx.toggleMenu();
      });
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(21, "nav", 15)(22, "div", 16)(23, "a", 17);
      \u0275\u0275listener("click", function PublicShellComponent_Template_a_click_23_listener() {
        return ctx.toggleMenu();
      });
      \u0275\u0275elementStart(24, "span", 4);
      \u0275\u0275text(25, "C");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(26, "span", 5);
      \u0275\u0275text(27, "Clessia");
      \u0275\u0275elementEnd()();
      \u0275\u0275elementStart(28, "button", 18);
      \u0275\u0275listener("click", function PublicShellComponent_Template_button_click_28_listener() {
        return ctx.toggleMenu();
      });
      \u0275\u0275element(29, "i", 19);
      \u0275\u0275elementEnd()();
      \u0275\u0275repeaterCreate(30, PublicShellComponent_For_31_Template, 4, 8, "a", 20, _forTrack0);
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(32, "main", 21)(33, "div", 22);
      \u0275\u0275element(34, "router-outlet");
      \u0275\u0275elementEnd()()();
    }
    if (rf & 2) {
      \u0275\u0275classProp("public-shell--menu-open", ctx.menuOpen());
      \u0275\u0275advance(13);
      \u0275\u0275repeater(ctx.publicRoutes);
      \u0275\u0275advance(4);
      \u0275\u0275classProp("hamburger--active", ctx.menuOpen());
      \u0275\u0275advance(3);
      \u0275\u0275classProp("public-shell__overlay--open", ctx.menuOpen());
      \u0275\u0275advance();
      \u0275\u0275classProp("public-shell__sidebar--open", ctx.menuOpen());
      \u0275\u0275advance(9);
      \u0275\u0275repeater(ctx.publicRoutes);
      \u0275\u0275advance(3);
      \u0275\u0275property("@fadeAnimation", ctx.getRouteAnimationData());
    }
  }, dependencies: [RouterOutlet, RouterLink, RouterLinkActive], styles: ['@charset "UTF-8";\n\n\n\n@keyframes _ngcontent-%COMP%_pub-nav-in {\n  from {\n    opacity: 0;\n    transform: translateX(-6px);\n  }\n  to {\n    opacity: 1;\n    transform: translateX(0);\n  }\n}\n.public-shell[_ngcontent-%COMP%] {\n  display: grid;\n  grid-template-columns: 420px 1fr;\n  height: 100dvh;\n  overflow: hidden;\n}\n.public-shell__brand[_ngcontent-%COMP%] {\n  position: sticky;\n  top: 0;\n  display: flex;\n  flex-direction: column;\n  justify-content: space-between;\n  height: 100dvh;\n  padding: var(--space-8);\n  background:\n    linear-gradient(\n      160deg,\n      var(--zinc-900) 0%,\n      var(--zinc-800) 100%);\n  color: #fff;\n  overflow: hidden;\n}\n.public-shell__brand[_ngcontent-%COMP%]::before, \n.public-shell__brand[_ngcontent-%COMP%]::after {\n  content: "";\n  position: absolute;\n  border-radius: 50%;\n  pointer-events: none;\n}\n.public-shell__brand[_ngcontent-%COMP%]::before {\n  top: -100px;\n  right: -80px;\n  width: 300px;\n  height: 300px;\n  background:\n    radial-gradient(\n      circle,\n      rgba(14, 165, 233, 0.3) 0%,\n      transparent 70%);\n}\n.public-shell__brand[_ngcontent-%COMP%]::after {\n  bottom: -50px;\n  left: -50px;\n  width: 200px;\n  height: 200px;\n  background:\n    radial-gradient(\n      circle,\n      rgba(14, 165, 233, 0.2) 0%,\n      transparent 70%);\n}\n.public-shell__brand-content[_ngcontent-%COMP%] {\n  position: relative;\n  z-index: 1;\n}\n.public-shell__logo[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  margin-bottom: var(--space-8);\n  text-decoration: none;\n  color: inherit;\n}\n.public-shell__logo-icon[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 48px;\n  height: 48px;\n  font-size: var(--text-xl);\n  font-weight: var(--font-bold);\n  color: var(--zinc-900);\n  background:\n    linear-gradient(\n      135deg,\n      #fff 0%,\n      var(--zinc-200) 100%);\n  border-radius: var(--radius-lg);\n  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);\n}\n.public-shell__logo-text[_ngcontent-%COMP%] {\n  font-size: var(--text-2xl);\n  font-weight: var(--font-bold);\n  letter-spacing: -0.02em;\n}\n.public-shell__tagline[_ngcontent-%COMP%] {\n  margin: 0 0 var(--space-2) 0;\n  font-size: var(--text-3xl);\n  font-weight: var(--font-bold);\n  line-height: var(--leading-tight);\n}\n.public-shell__slogan[_ngcontent-%COMP%] {\n  margin: 0 0 var(--space-8) 0;\n  font-size: var(--text-lg);\n  color: var(--zinc-400);\n}\n.public-shell__features[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-4);\n  list-style: none;\n}\n.public-shell__feature[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  font-size: var(--text-md);\n  color: var(--zinc-300);\n}\n.public-shell__feature[_ngcontent-%COMP%]   i[_ngcontent-%COMP%] {\n  color: var(--accent-400);\n  font-size: 18px;\n}\n.public-shell__nav[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-2);\n}\n.public-shell__nav-link[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  padding: var(--space-3) var(--space-4);\n  font-size: var(--text-md);\n  color: var(--zinc-400);\n  text-decoration: none;\n  border-radius: var(--radius-md);\n  animation: _ngcontent-%COMP%_pub-nav-in 0.25s ease both;\n  transition: color var(--transition-fast), background var(--transition-fast);\n}\n.public-shell__nav-link[_ngcontent-%COMP%]:nth-child(1) {\n  animation-delay: 0s;\n}\n.public-shell__nav-link[_ngcontent-%COMP%]:nth-child(2) {\n  animation-delay: 0.07s;\n}\n.public-shell__nav-link[_ngcontent-%COMP%]:nth-child(3) {\n  animation-delay: 0.14s;\n}\n.public-shell__nav-link[_ngcontent-%COMP%]:nth-child(4) {\n  animation-delay: 0.21s;\n}\n.public-shell__nav-link[_ngcontent-%COMP%]   i[_ngcontent-%COMP%] {\n  font-size: 18px;\n  width: 20px;\n  text-align: center;\n}\n.public-shell__nav-link[_ngcontent-%COMP%]:hover {\n  color: #fff;\n  background: rgba(255, 255, 255, 0.08);\n}\n.public-shell__nav-link--active[_ngcontent-%COMP%] {\n  color: #fff;\n  background: rgba(255, 255, 255, 0.1);\n}\n.public-shell__copyright[_ngcontent-%COMP%] {\n  position: relative;\n  z-index: 1;\n  font-size: var(--text-sm);\n  color: var(--zinc-500);\n}\n.public-shell[_ngcontent-%COMP%] {\n}\n.public-shell__hamburger.hamburger[_ngcontent-%COMP%] {\n  display: none;\n}\n.public-shell[_ngcontent-%COMP%] {\n}\n.public-shell__overlay[_ngcontent-%COMP%], \n.public-shell__sidebar[_ngcontent-%COMP%] {\n  display: none;\n}\n.public-shell__main[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  height: 100dvh;\n  padding: var(--space-8);\n  background: var(--zinc-50);\n  overflow-y: auto;\n}\n.public-shell__main[_ngcontent-%COMP%]    > [_ngcontent-%COMP%]:not(router-outlet) {\n  display: contents;\n}\n.shell-route-wrapper[_ngcontent-%COMP%] {\n  position: relative;\n  flex: 1;\n  display: flex !important;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  width: 100%;\n  min-height: 100%;\n}\n@media (max-width: 1024px) {\n  .public-shell[_ngcontent-%COMP%] {\n    grid-template-columns: 1fr;\n    height: auto;\n    min-height: 100dvh;\n    overflow: visible;\n    position: relative;\n    background: var(--zinc-50);\n    transition: transform 0.3s ease;\n  }\n  .public-shell--menu-open[_ngcontent-%COMP%] {\n    transform: translateX(280px);\n  }\n  .public-shell__brand[_ngcontent-%COMP%] {\n    position: sticky;\n    top: 0;\n    z-index: 10;\n    height: auto;\n    padding: var(--space-2) var(--space-4);\n    flex-direction: row;\n    align-items: center;\n    justify-content: space-between;\n    overflow: visible;\n  }\n  .public-shell__brand[_ngcontent-%COMP%]::before, \n   .public-shell__brand[_ngcontent-%COMP%]::after {\n    display: none;\n  }\n  .public-shell__brand-content[_ngcontent-%COMP%] {\n    display: flex;\n    align-items: center;\n    gap: var(--space-3);\n  }\n  .public-shell__logo[_ngcontent-%COMP%] {\n    margin-bottom: 0;\n  }\n  .public-shell__logo-icon[_ngcontent-%COMP%] {\n    width: 28px;\n    height: 28px;\n    font-size: var(--text-sm);\n  }\n  .public-shell__logo-text[_ngcontent-%COMP%] {\n    font-size: var(--text-md);\n  }\n  .public-shell__tagline[_ngcontent-%COMP%], \n   .public-shell__slogan[_ngcontent-%COMP%], \n   .public-shell__features[_ngcontent-%COMP%], \n   .public-shell__nav[_ngcontent-%COMP%], \n   .public-shell__copyright[_ngcontent-%COMP%] {\n    display: none;\n  }\n  .public-shell__hamburger.hamburger[_ngcontent-%COMP%] {\n    display: flex;\n    padding: 0;\n    transform: scale(0.5);\n    z-index: 12;\n  }\n  .public-shell__hamburger.hamburger[_ngcontent-%COMP%]   .hamburger-inner[_ngcontent-%COMP%], \n   .public-shell__hamburger.hamburger[_ngcontent-%COMP%]   .hamburger-inner[_ngcontent-%COMP%]::before, \n   .public-shell__hamburger.hamburger[_ngcontent-%COMP%]   .hamburger-inner[_ngcontent-%COMP%]::after {\n    background-color: var(--zinc-400);\n  }\n  .public-shell__hamburger.hamburger[_ngcontent-%COMP%]:hover   .hamburger-inner[_ngcontent-%COMP%], \n   .public-shell__hamburger.hamburger[_ngcontent-%COMP%]:hover   .hamburger-inner[_ngcontent-%COMP%]::before, \n   .public-shell__hamburger.hamburger[_ngcontent-%COMP%]:hover   .hamburger-inner[_ngcontent-%COMP%]::after {\n    background-color: #fff;\n  }\n  .public-shell__hamburger.hamburger--active[_ngcontent-%COMP%]   .hamburger-inner[_ngcontent-%COMP%], \n   .public-shell__hamburger.hamburger--active[_ngcontent-%COMP%]   .hamburger-inner[_ngcontent-%COMP%]::before, \n   .public-shell__hamburger.hamburger--active[_ngcontent-%COMP%]   .hamburger-inner[_ngcontent-%COMP%]::after {\n    background-color: #fff;\n  }\n  .public-shell[_ngcontent-%COMP%] {\n  }\n  .public-shell__overlay[_ngcontent-%COMP%] {\n    display: block;\n    position: fixed;\n    inset: 0;\n    z-index: 20;\n    background: rgba(0, 0, 0, 0);\n    pointer-events: none;\n    transition: background 0.3s ease;\n  }\n  .public-shell__overlay--open[_ngcontent-%COMP%] {\n    pointer-events: auto;\n    background: rgba(0, 0, 0, 0.3);\n  }\n  .public-shell[_ngcontent-%COMP%] {\n  }\n  .public-shell__sidebar[_ngcontent-%COMP%] {\n    display: flex;\n    flex-direction: column;\n    position: absolute;\n    top: 0;\n    left: -280px;\n    width: 280px;\n    min-height: 100dvh;\n    padding: var(--space-4);\n    color: #fff;\n    background: var(--zinc-900);\n  }\n  .public-shell__sidebar-header[_ngcontent-%COMP%] {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    margin-bottom: var(--space-6);\n  }\n  .public-shell__sidebar-header[_ngcontent-%COMP%]   .public-shell__logo[_ngcontent-%COMP%] {\n    color: #fff;\n    margin-bottom: 0;\n  }\n  .public-shell__sidebar-header[_ngcontent-%COMP%]   .public-shell__logo-icon[_ngcontent-%COMP%] {\n    width: 32px;\n    height: 32px;\n    font-size: var(--text-md);\n  }\n  .public-shell__sidebar-header[_ngcontent-%COMP%]   .public-shell__logo-text[_ngcontent-%COMP%] {\n    font-size: var(--text-lg);\n  }\n  .public-shell__sidebar-close[_ngcontent-%COMP%] {\n    width: 32px;\n    height: 32px;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    color: var(--zinc-400);\n    font-size: 18px;\n    border-radius: var(--radius-md);\n    transition: color 0.2s, background 0.2s;\n  }\n  .public-shell__sidebar-close[_ngcontent-%COMP%]:hover {\n    color: #fff;\n    background: rgba(255, 255, 255, 0.1);\n  }\n  .public-shell__sidebar-link[_ngcontent-%COMP%] {\n    display: flex;\n    align-items: center;\n    gap: var(--space-3);\n    padding: var(--space-3) var(--space-4);\n    font-size: var(--text-md);\n    color: var(--zinc-400);\n    text-decoration: none;\n    border-radius: var(--radius-md);\n    margin-bottom: var(--space-1);\n    transition: color 0.2s, background 0.2s;\n  }\n  .public-shell__sidebar-link[_ngcontent-%COMP%]   i[_ngcontent-%COMP%] {\n    font-size: 18px;\n    width: 20px;\n    text-align: center;\n  }\n  .public-shell__sidebar-link[_ngcontent-%COMP%]:hover {\n    color: #fff;\n    background: rgba(255, 255, 255, 0.08);\n  }\n  .public-shell__sidebar-link--active[_ngcontent-%COMP%] {\n    color: #fff;\n    background: rgba(255, 255, 255, 0.1);\n  }\n}\n/*# sourceMappingURL=public-shell.component.css.map */'], data: { animation: [fadeAnimation] } });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(PublicShellComponent, [{
    type: Component,
    args: [{ selector: "app-public-shell", imports: [RouterOutlet, RouterLink, RouterLinkActive], animations: [fadeAnimation], template: `<section class="public-shell" [class.public-shell--menu-open]="menuOpen()">
  <!-- Brand Panel (Left Side) -->
  <aside class="public-shell__brand">
    <div class="public-shell__brand-content">
      <a class="public-shell__logo" routerLink="/login">
        <span class="public-shell__logo-icon">C</span>
        <span class="public-shell__logo-text">Clessia</span>
      </a>
      <h2 class="public-shell__tagline">\u5B78\u7A0B\u7BA1\u5BB6</h2>
      <p class="public-shell__slogan">\u8B93\u5B78\u7FD2\u65C5\u7A0B\u66F4\u8F15\u9B06</p>

      <nav class="public-shell__nav">
        @for (item of publicRoutes; track item.absolutePath) {
          <a
            class="public-shell__nav-link"
            [routerLink]="item.absolutePath"
            routerLinkActive="public-shell__nav-link--active"
            [routerLinkActiveOptions]="item.absolutePath === '/login' ? { exact: true } : { exact: false }"
          >
            <i class="pi {{ item.icon }}"></i>
            <span>{{ item.label }}</span>
          </a>
        }
      </nav>
    </div>

    <p class="public-shell__copyright">&copy; 2025 Clessia Academy</p>

    <!-- Mobile hamburger -->
    <button
      class="hamburger hamburger--squeeze public-shell__hamburger"
      [class.hamburger--active]="menuOpen()"
      type="button"
      (click)="toggleMenu()"
    >
      <span class="hamburger-box">
        <span class="hamburger-inner"></span>
      </span>
    </button>
  </aside>

  <!-- Mobile sidebar overlay -->
  <div class="public-shell__overlay" [class.public-shell__overlay--open]="menuOpen()" (click)="toggleMenu()"></div>

  <!-- Mobile sidebar -->
  <nav class="public-shell__sidebar" [class.public-shell__sidebar--open]="menuOpen()">
    <div class="public-shell__sidebar-header">
      <a class="public-shell__logo" routerLink="/login" (click)="toggleMenu()">
        <span class="public-shell__logo-icon">C</span>
        <span class="public-shell__logo-text">Clessia</span>
      </a>
      <button class="public-shell__sidebar-close" (click)="toggleMenu()">
        <i class="pi pi-times"></i>
      </button>
    </div>

    @for (item of publicRoutes; track item.absolutePath) {
      <a
        class="public-shell__sidebar-link"
        [routerLink]="item.absolutePath"
        routerLinkActive="public-shell__sidebar-link--active"
        [routerLinkActiveOptions]="item.absolutePath === '/login' ? { exact: true } : { exact: false }"
        (click)="toggleMenu()"
      >
        <i class="pi {{ item.icon }}"></i>
        <span>{{ item.label }}</span>
      </a>
    }
  </nav>

  <!-- Content Panel (Right Side) -->
  <main class="public-shell__main">
    <div [@fadeAnimation]="getRouteAnimationData()" class="shell-route-wrapper u-fill-route-child">
      <router-outlet />
    </div>
  </main>
</section>
`, styles: ['@charset "UTF-8";\n\n/* apps/web/src/app/features/public/public-shell.component.scss */\n@keyframes pub-nav-in {\n  from {\n    opacity: 0;\n    transform: translateX(-6px);\n  }\n  to {\n    opacity: 1;\n    transform: translateX(0);\n  }\n}\n.public-shell {\n  display: grid;\n  grid-template-columns: 420px 1fr;\n  height: 100dvh;\n  overflow: hidden;\n}\n.public-shell__brand {\n  position: sticky;\n  top: 0;\n  display: flex;\n  flex-direction: column;\n  justify-content: space-between;\n  height: 100dvh;\n  padding: var(--space-8);\n  background:\n    linear-gradient(\n      160deg,\n      var(--zinc-900) 0%,\n      var(--zinc-800) 100%);\n  color: #fff;\n  overflow: hidden;\n}\n.public-shell__brand::before,\n.public-shell__brand::after {\n  content: "";\n  position: absolute;\n  border-radius: 50%;\n  pointer-events: none;\n}\n.public-shell__brand::before {\n  top: -100px;\n  right: -80px;\n  width: 300px;\n  height: 300px;\n  background:\n    radial-gradient(\n      circle,\n      rgba(14, 165, 233, 0.3) 0%,\n      transparent 70%);\n}\n.public-shell__brand::after {\n  bottom: -50px;\n  left: -50px;\n  width: 200px;\n  height: 200px;\n  background:\n    radial-gradient(\n      circle,\n      rgba(14, 165, 233, 0.2) 0%,\n      transparent 70%);\n}\n.public-shell__brand-content {\n  position: relative;\n  z-index: 1;\n}\n.public-shell__logo {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  margin-bottom: var(--space-8);\n  text-decoration: none;\n  color: inherit;\n}\n.public-shell__logo-icon {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 48px;\n  height: 48px;\n  font-size: var(--text-xl);\n  font-weight: var(--font-bold);\n  color: var(--zinc-900);\n  background:\n    linear-gradient(\n      135deg,\n      #fff 0%,\n      var(--zinc-200) 100%);\n  border-radius: var(--radius-lg);\n  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);\n}\n.public-shell__logo-text {\n  font-size: var(--text-2xl);\n  font-weight: var(--font-bold);\n  letter-spacing: -0.02em;\n}\n.public-shell__tagline {\n  margin: 0 0 var(--space-2) 0;\n  font-size: var(--text-3xl);\n  font-weight: var(--font-bold);\n  line-height: var(--leading-tight);\n}\n.public-shell__slogan {\n  margin: 0 0 var(--space-8) 0;\n  font-size: var(--text-lg);\n  color: var(--zinc-400);\n}\n.public-shell__features {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-4);\n  list-style: none;\n}\n.public-shell__feature {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  font-size: var(--text-md);\n  color: var(--zinc-300);\n}\n.public-shell__feature i {\n  color: var(--accent-400);\n  font-size: 18px;\n}\n.public-shell__nav {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-2);\n}\n.public-shell__nav-link {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  padding: var(--space-3) var(--space-4);\n  font-size: var(--text-md);\n  color: var(--zinc-400);\n  text-decoration: none;\n  border-radius: var(--radius-md);\n  animation: pub-nav-in 0.25s ease both;\n  transition: color var(--transition-fast), background var(--transition-fast);\n}\n.public-shell__nav-link:nth-child(1) {\n  animation-delay: 0s;\n}\n.public-shell__nav-link:nth-child(2) {\n  animation-delay: 0.07s;\n}\n.public-shell__nav-link:nth-child(3) {\n  animation-delay: 0.14s;\n}\n.public-shell__nav-link:nth-child(4) {\n  animation-delay: 0.21s;\n}\n.public-shell__nav-link i {\n  font-size: 18px;\n  width: 20px;\n  text-align: center;\n}\n.public-shell__nav-link:hover {\n  color: #fff;\n  background: rgba(255, 255, 255, 0.08);\n}\n.public-shell__nav-link--active {\n  color: #fff;\n  background: rgba(255, 255, 255, 0.1);\n}\n.public-shell__copyright {\n  position: relative;\n  z-index: 1;\n  font-size: var(--text-sm);\n  color: var(--zinc-500);\n}\n.public-shell {\n}\n.public-shell__hamburger.hamburger {\n  display: none;\n}\n.public-shell {\n}\n.public-shell__overlay,\n.public-shell__sidebar {\n  display: none;\n}\n.public-shell__main {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  height: 100dvh;\n  padding: var(--space-8);\n  background: var(--zinc-50);\n  overflow-y: auto;\n}\n.public-shell__main > :not(router-outlet) {\n  display: contents;\n}\n.shell-route-wrapper {\n  position: relative;\n  flex: 1;\n  display: flex !important;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  width: 100%;\n  min-height: 100%;\n}\n@media (max-width: 1024px) {\n  .public-shell {\n    grid-template-columns: 1fr;\n    height: auto;\n    min-height: 100dvh;\n    overflow: visible;\n    position: relative;\n    background: var(--zinc-50);\n    transition: transform 0.3s ease;\n  }\n  .public-shell--menu-open {\n    transform: translateX(280px);\n  }\n  .public-shell__brand {\n    position: sticky;\n    top: 0;\n    z-index: 10;\n    height: auto;\n    padding: var(--space-2) var(--space-4);\n    flex-direction: row;\n    align-items: center;\n    justify-content: space-between;\n    overflow: visible;\n  }\n  .public-shell__brand::before,\n  .public-shell__brand::after {\n    display: none;\n  }\n  .public-shell__brand-content {\n    display: flex;\n    align-items: center;\n    gap: var(--space-3);\n  }\n  .public-shell__logo {\n    margin-bottom: 0;\n  }\n  .public-shell__logo-icon {\n    width: 28px;\n    height: 28px;\n    font-size: var(--text-sm);\n  }\n  .public-shell__logo-text {\n    font-size: var(--text-md);\n  }\n  .public-shell__tagline,\n  .public-shell__slogan,\n  .public-shell__features,\n  .public-shell__nav,\n  .public-shell__copyright {\n    display: none;\n  }\n  .public-shell__hamburger.hamburger {\n    display: flex;\n    padding: 0;\n    transform: scale(0.5);\n    z-index: 12;\n  }\n  .public-shell__hamburger.hamburger .hamburger-inner,\n  .public-shell__hamburger.hamburger .hamburger-inner::before,\n  .public-shell__hamburger.hamburger .hamburger-inner::after {\n    background-color: var(--zinc-400);\n  }\n  .public-shell__hamburger.hamburger:hover .hamburger-inner,\n  .public-shell__hamburger.hamburger:hover .hamburger-inner::before,\n  .public-shell__hamburger.hamburger:hover .hamburger-inner::after {\n    background-color: #fff;\n  }\n  .public-shell__hamburger.hamburger--active .hamburger-inner,\n  .public-shell__hamburger.hamburger--active .hamburger-inner::before,\n  .public-shell__hamburger.hamburger--active .hamburger-inner::after {\n    background-color: #fff;\n  }\n  .public-shell {\n  }\n  .public-shell__overlay {\n    display: block;\n    position: fixed;\n    inset: 0;\n    z-index: 20;\n    background: rgba(0, 0, 0, 0);\n    pointer-events: none;\n    transition: background 0.3s ease;\n  }\n  .public-shell__overlay--open {\n    pointer-events: auto;\n    background: rgba(0, 0, 0, 0.3);\n  }\n  .public-shell {\n  }\n  .public-shell__sidebar {\n    display: flex;\n    flex-direction: column;\n    position: absolute;\n    top: 0;\n    left: -280px;\n    width: 280px;\n    min-height: 100dvh;\n    padding: var(--space-4);\n    color: #fff;\n    background: var(--zinc-900);\n  }\n  .public-shell__sidebar-header {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    margin-bottom: var(--space-6);\n  }\n  .public-shell__sidebar-header .public-shell__logo {\n    color: #fff;\n    margin-bottom: 0;\n  }\n  .public-shell__sidebar-header .public-shell__logo-icon {\n    width: 32px;\n    height: 32px;\n    font-size: var(--text-md);\n  }\n  .public-shell__sidebar-header .public-shell__logo-text {\n    font-size: var(--text-lg);\n  }\n  .public-shell__sidebar-close {\n    width: 32px;\n    height: 32px;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    color: var(--zinc-400);\n    font-size: 18px;\n    border-radius: var(--radius-md);\n    transition: color 0.2s, background 0.2s;\n  }\n  .public-shell__sidebar-close:hover {\n    color: #fff;\n    background: rgba(255, 255, 255, 0.1);\n  }\n  .public-shell__sidebar-link {\n    display: flex;\n    align-items: center;\n    gap: var(--space-3);\n    padding: var(--space-3) var(--space-4);\n    font-size: var(--text-md);\n    color: var(--zinc-400);\n    text-decoration: none;\n    border-radius: var(--radius-md);\n    margin-bottom: var(--space-1);\n    transition: color 0.2s, background 0.2s;\n  }\n  .public-shell__sidebar-link i {\n    font-size: 18px;\n    width: 20px;\n    text-align: center;\n  }\n  .public-shell__sidebar-link:hover {\n    color: #fff;\n    background: rgba(255, 255, 255, 0.08);\n  }\n  .public-shell__sidebar-link--active {\n    color: #fff;\n    background: rgba(255, 255, 255, 0.1);\n  }\n}\n/*# sourceMappingURL=public-shell.component.css.map */\n'] }]
  }], null, null);
})();
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(PublicShellComponent, { className: "PublicShellComponent", filePath: "apps/web/src/app/features/public/public-shell.component.ts", lineNumber: 13 });
})();
export {
  PublicShellComponent
};
/*! Bundled license information:

@angular/animations/fesm2022/animations.mjs:
  (**
   * @license Angular v21.1.3
   * (c) 2010-2026 Google LLC. https://angular.dev/
   * License: MIT
   *)
*/
//# sourceMappingURL=chunk-YFVNQKAE.js.map
