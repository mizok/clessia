import {
  $,
  BaseComponent,
  BaseStyle,
  Bind,
  BindModule,
  C,
  ConnectedOverlayScrollHandler,
  D,
  Gt,
  K,
  MotionDirective,
  MotionModule,
  OverlayService,
  PARENT_INSTANCE,
  PrimeTemplate,
  R,
  SharedModule,
  U,
  Ut,
  W,
  Yt,
  h,
  ht,
  k,
  rr,
  s2 as s,
  ut,
  v,
  z,
  zindexutils
} from "./chunk-S2CLXNRJ.js";
import {
  AuthService
} from "./chunk-IDX5LEWH.js";
import "./chunk-WSLHL2JA.js";
import {
  CommonModule,
  NgStyle,
  NgTemplateOutlet,
  Router,
  RouterOutlet,
  isPlatformBrowser
} from "./chunk-NFVC465N.js";
import {
  ChangeDetectionStrategy,
  Component,
  ContentChild,
  ContentChildren,
  DOCUMENT,
  Directive,
  ElementRef,
  EventEmitter,
  HostListener,
  Injectable,
  InjectionToken,
  Input,
  NgModule,
  NgZone,
  Output,
  PLATFORM_ID,
  Renderer2,
  ViewChild,
  ViewContainerRef,
  ViewEncapsulation,
  __spreadProps,
  __spreadValues,
  afterNextRender,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  setClassMetadata,
  signal,
  ɵsetClassDebugInfo,
  ɵɵHostDirectivesFeature,
  ɵɵInheritDefinitionFeature,
  ɵɵNgOnChangesFeature,
  ɵɵProvidersFeature,
  ɵɵadvance,
  ɵɵattribute,
  ɵɵclassMap,
  ɵɵclassProp,
  ɵɵconditional,
  ɵɵconditionalCreate,
  ɵɵcontentQuery,
  ɵɵdefineComponent,
  ɵɵdefineDirective,
  ɵɵdefineInjectable,
  ɵɵdefineInjector,
  ɵɵdefineNgModule,
  ɵɵdirectiveInject,
  ɵɵdomElement,
  ɵɵelement,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵgetCurrentView,
  ɵɵgetInheritedFactory,
  ɵɵinterpolate1,
  ɵɵlistener,
  ɵɵloadQuery,
  ɵɵnamespaceSVG,
  ɵɵnextContext,
  ɵɵprojection,
  ɵɵprojectionDef,
  ɵɵproperty,
  ɵɵpureFunction1,
  ɵɵqueryRefresh,
  ɵɵreference,
  ɵɵresetView,
  ɵɵresolveDocument,
  ɵɵresolveWindow,
  ɵɵrestoreView,
  ɵɵstyleMap,
  ɵɵtemplate,
  ɵɵtext,
  ɵɵtextInterpolate,
  ɵɵtextInterpolate1,
  ɵɵviewQuery
} from "./chunk-YGF3CXFR.js";

// node_modules/@primeuix/styles/dist/tooltip/index.mjs
var style = "\n    .p-tooltip {\n        position: absolute;\n        display: none;\n        max-width: dt('tooltip.max.width');\n    }\n\n    .p-tooltip-right,\n    .p-tooltip-left {\n        padding: 0 dt('tooltip.gutter');\n    }\n\n    .p-tooltip-top,\n    .p-tooltip-bottom {\n        padding: dt('tooltip.gutter') 0;\n    }\n\n    .p-tooltip-text {\n        white-space: pre-line;\n        word-break: break-word;\n        background: dt('tooltip.background');\n        color: dt('tooltip.color');\n        padding: dt('tooltip.padding');\n        box-shadow: dt('tooltip.shadow');\n        border-radius: dt('tooltip.border.radius');\n    }\n\n    .p-tooltip-arrow {\n        position: absolute;\n        width: 0;\n        height: 0;\n        border-color: transparent;\n        border-style: solid;\n    }\n\n    .p-tooltip-right .p-tooltip-arrow {\n        margin-top: calc(-1 * dt('tooltip.gutter'));\n        border-width: dt('tooltip.gutter') dt('tooltip.gutter') dt('tooltip.gutter') 0;\n        border-right-color: dt('tooltip.background');\n    }\n\n    .p-tooltip-left .p-tooltip-arrow {\n        margin-top: calc(-1 * dt('tooltip.gutter'));\n        border-width: dt('tooltip.gutter') 0 dt('tooltip.gutter') dt('tooltip.gutter');\n        border-left-color: dt('tooltip.background');\n    }\n\n    .p-tooltip-top .p-tooltip-arrow {\n        margin-left: calc(-1 * dt('tooltip.gutter'));\n        border-width: dt('tooltip.gutter') dt('tooltip.gutter') 0 dt('tooltip.gutter');\n        border-top-color: dt('tooltip.background');\n        border-bottom-color: dt('tooltip.background');\n    }\n\n    .p-tooltip-bottom .p-tooltip-arrow {\n        margin-left: calc(-1 * dt('tooltip.gutter'));\n        border-width: 0 dt('tooltip.gutter') dt('tooltip.gutter') dt('tooltip.gutter');\n        border-top-color: dt('tooltip.background');\n        border-bottom-color: dt('tooltip.background');\n    }\n";

// node_modules/primeng/fesm2022/primeng-tooltip.mjs
var classes = {
  root: "p-tooltip p-component",
  arrow: "p-tooltip-arrow",
  text: "p-tooltip-text"
};
var TooltipStyle = class _TooltipStyle extends BaseStyle {
  name = "tooltip";
  style = style;
  classes = classes;
  static \u0275fac = /* @__PURE__ */ (() => {
    let \u0275TooltipStyle_BaseFactory;
    return function TooltipStyle_Factory(__ngFactoryType__) {
      return (\u0275TooltipStyle_BaseFactory || (\u0275TooltipStyle_BaseFactory = \u0275\u0275getInheritedFactory(_TooltipStyle)))(__ngFactoryType__ || _TooltipStyle);
    };
  })();
  static \u0275prov = /* @__PURE__ */ \u0275\u0275defineInjectable({
    token: _TooltipStyle,
    factory: _TooltipStyle.\u0275fac
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(TooltipStyle, [{
    type: Injectable
  }], null, null);
})();
var TooltipClasses;
(function(TooltipClasses2) {
  TooltipClasses2["root"] = "p-tooltip";
  TooltipClasses2["arrow"] = "p-tooltip-arrow";
  TooltipClasses2["text"] = "p-tooltip-text";
})(TooltipClasses || (TooltipClasses = {}));
var TOOLTIP_INSTANCE = new InjectionToken("TOOLTIP_INSTANCE");
var Tooltip = class _Tooltip extends BaseComponent {
  zone;
  viewContainer;
  componentName = "Tooltip";
  $pcTooltip = inject(TOOLTIP_INSTANCE, {
    optional: true,
    skipSelf: true
  }) ?? void 0;
  /**
   * Position of the tooltip.
   * @group Props
   */
  tooltipPosition;
  /**
   * Event to show the tooltip.
   * @group Props
   */
  tooltipEvent = "hover";
  /**
   * Type of CSS position.
   * @group Props
   */
  positionStyle;
  /**
   * Style class of the tooltip.
   * @group Props
   */
  tooltipStyleClass;
  /**
   * Whether the z-index should be managed automatically to always go on top or have a fixed value.
   * @group Props
   */
  tooltipZIndex;
  /**
   * By default the tooltip contents are rendered as text. Set to false to support html tags in the content.
   * @group Props
   */
  escape = true;
  /**
   * Delay to show the tooltip in milliseconds.
   * @group Props
   */
  showDelay;
  /**
   * Delay to hide the tooltip in milliseconds.
   * @group Props
   */
  hideDelay;
  /**
   * Time to wait in milliseconds to hide the tooltip even it is active.
   * @group Props
   */
  life;
  /**
   * Specifies the additional vertical offset of the tooltip from its default position.
   * @group Props
   */
  positionTop;
  /**
   * Specifies the additional horizontal offset of the tooltip from its default position.
   * @group Props
   */
  positionLeft;
  /**
   * Whether to hide tooltip when hovering over tooltip content.
   * @group Props
   */
  autoHide = true;
  /**
   * Automatically adjusts the element position when there is not enough space on the selected position.
   * @group Props
   */
  fitContent = true;
  /**
   * Whether to hide tooltip on escape key press.
   * @group Props
   */
  hideOnEscape = true;
  /**
   * Whether to show the tooltip only when the target text overflows (e.g., ellipsis is active).
   * @group Props
   */
  showOnEllipsis = false;
  /**
   * Content of the tooltip.
   * @group Props
   */
  content;
  /**
   * When present, it specifies that the component should be disabled.
   * @defaultValue false
   * @group Props
   */
  get disabled() {
    return this._disabled;
  }
  set disabled(val) {
    this._disabled = val;
    this.deactivate();
  }
  /**
   * Specifies the tooltip configuration options for the component.
   * @group Props
   */
  tooltipOptions;
  /**
   * Target element to attach the overlay, valid values are "body" or a local ng-template variable of another element (note: use binding with brackets for template variables, e.g. [appendTo]="mydiv" for a div element having #mydiv as variable name).
   * @defaultValue 'self'
   * @group Props
   */
  appendTo = input(void 0, ...ngDevMode ? [{
    debugName: "appendTo"
  }] : []);
  $appendTo = computed(() => this.appendTo() || this.config.overlayAppendTo(), ...ngDevMode ? [{
    debugName: "$appendTo"
  }] : []);
  _tooltipOptions = {
    tooltipLabel: null,
    tooltipPosition: "right",
    tooltipEvent: "hover",
    appendTo: "body",
    positionStyle: null,
    tooltipStyleClass: null,
    tooltipZIndex: "auto",
    escape: true,
    disabled: null,
    showDelay: null,
    hideDelay: null,
    positionTop: null,
    positionLeft: null,
    life: null,
    autoHide: true,
    hideOnEscape: true,
    showOnEllipsis: false,
    id: s("pn_id_") + "_tooltip"
  };
  _disabled;
  container;
  styleClass;
  tooltipText;
  rootPTClasses = "";
  showTimeout;
  hideTimeout;
  active;
  mouseEnterListener;
  mouseLeaveListener;
  containerMouseleaveListener;
  clickListener;
  focusListener;
  blurListener;
  touchStartListener;
  touchEndListener;
  documentTouchListener;
  documentEscapeListener;
  scrollHandler;
  resizeListener;
  _componentStyle = inject(TooltipStyle);
  interactionInProgress = false;
  /**
   * Used to pass attributes to DOM elements inside the Tooltip component.
   * @defaultValue undefined
   * @deprecated use pTooltipPT instead.
   * @group Props
   */
  ptTooltip = input(...ngDevMode ? [void 0, {
    debugName: "ptTooltip"
  }] : []);
  /**
   * Used to pass attributes to DOM elements inside the Tooltip component.
   * @defaultValue undefined
   * @group Props
   */
  pTooltipPT = input(...ngDevMode ? [void 0, {
    debugName: "pTooltipPT"
  }] : []);
  /**
   * Indicates whether the component should be rendered without styles.
   * @defaultValue undefined
   * @group Props
   */
  pTooltipUnstyled = input(...ngDevMode ? [void 0, {
    debugName: "pTooltipUnstyled"
  }] : []);
  constructor(zone, viewContainer) {
    super();
    this.zone = zone;
    this.viewContainer = viewContainer;
    effect(() => {
      const pt = this.ptTooltip() || this.pTooltipPT();
      pt && this.directivePT.set(pt);
    });
    effect(() => {
      this.pTooltipUnstyled() && this.directiveUnstyled.set(this.pTooltipUnstyled());
    });
  }
  onAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) {
      this.zone.runOutsideAngular(() => {
        const tooltipEvent = this.getOption("tooltipEvent");
        if (tooltipEvent === "hover" || tooltipEvent === "both") {
          this.mouseEnterListener = this.onMouseEnter.bind(this);
          this.mouseLeaveListener = this.onMouseLeave.bind(this);
          this.clickListener = this.onInputClick.bind(this);
          this.el.nativeElement.addEventListener("mouseenter", this.mouseEnterListener);
          this.el.nativeElement.addEventListener("click", this.clickListener);
          this.el.nativeElement.addEventListener("mouseleave", this.mouseLeaveListener);
          this.touchStartListener = this.onTouchStart.bind(this);
          this.touchEndListener = this.onTouchEnd.bind(this);
          this.el.nativeElement.addEventListener("touchstart", this.touchStartListener, {
            passive: true
          });
          this.el.nativeElement.addEventListener("touchend", this.touchEndListener, {
            passive: true
          });
        }
        if (tooltipEvent === "focus" || tooltipEvent === "both") {
          this.focusListener = this.onFocus.bind(this);
          this.blurListener = this.onBlur.bind(this);
          let target = this.el.nativeElement.querySelector(".p-component");
          if (!target) {
            target = this.getTarget(this.el.nativeElement);
          }
          target.addEventListener("focus", this.focusListener);
          target.addEventListener("blur", this.blurListener);
        }
      });
    }
  }
  onChanges(simpleChange) {
    if (simpleChange.tooltipPosition) {
      this.setOption({
        tooltipPosition: simpleChange.tooltipPosition.currentValue
      });
    }
    if (simpleChange.tooltipEvent) {
      this.setOption({
        tooltipEvent: simpleChange.tooltipEvent.currentValue
      });
    }
    if (simpleChange.appendTo) {
      this.setOption({
        appendTo: simpleChange.appendTo.currentValue
      });
    }
    if (simpleChange.positionStyle) {
      this.setOption({
        positionStyle: simpleChange.positionStyle.currentValue
      });
    }
    if (simpleChange.tooltipStyleClass) {
      this.setOption({
        tooltipStyleClass: simpleChange.tooltipStyleClass.currentValue
      });
    }
    if (simpleChange.tooltipZIndex) {
      this.setOption({
        tooltipZIndex: simpleChange.tooltipZIndex.currentValue
      });
    }
    if (simpleChange.escape) {
      this.setOption({
        escape: simpleChange.escape.currentValue
      });
    }
    if (simpleChange.showDelay) {
      this.setOption({
        showDelay: simpleChange.showDelay.currentValue
      });
    }
    if (simpleChange.hideDelay) {
      this.setOption({
        hideDelay: simpleChange.hideDelay.currentValue
      });
    }
    if (simpleChange.life) {
      this.setOption({
        life: simpleChange.life.currentValue
      });
    }
    if (simpleChange.positionTop) {
      this.setOption({
        positionTop: simpleChange.positionTop.currentValue
      });
    }
    if (simpleChange.positionLeft) {
      this.setOption({
        positionLeft: simpleChange.positionLeft.currentValue
      });
    }
    if (simpleChange.disabled) {
      this.setOption({
        disabled: simpleChange.disabled.currentValue
      });
    }
    if (simpleChange.content) {
      this.setOption({
        tooltipLabel: simpleChange.content.currentValue
      });
      if (this.active) {
        if (simpleChange.content.currentValue) {
          if (this.container && this.container.offsetParent) {
            this.updateText();
            this.align();
          } else {
            this.show();
          }
        } else {
          this.hide();
        }
      }
    }
    if (simpleChange.autoHide) {
      this.setOption({
        autoHide: simpleChange.autoHide.currentValue
      });
    }
    if (simpleChange.showOnEllipsis) {
      this.setOption({
        showOnEllipsis: simpleChange.showOnEllipsis.currentValue
      });
    }
    if (simpleChange.id) {
      this.setOption({
        id: simpleChange.id.currentValue
      });
    }
    if (simpleChange.tooltipOptions) {
      this._tooltipOptions = __spreadValues(__spreadValues({}, this._tooltipOptions), simpleChange.tooltipOptions.currentValue);
      this.deactivate();
      if (this.active) {
        if (this.getOption("tooltipLabel")) {
          if (this.container && this.container.offsetParent) {
            this.updateText();
            this.align();
          } else {
            this.show();
          }
        } else {
          this.hide();
        }
      }
    }
  }
  isAutoHide() {
    return this.getOption("autoHide");
  }
  onMouseEnter(e) {
    if (!this.container && !this.showTimeout) {
      this.activate();
    }
  }
  onMouseLeave(e) {
    if (!this.isAutoHide()) {
      const valid = R(e.relatedTarget, "p-tooltip") || R(e.relatedTarget, "p-tooltip-text") || R(e.relatedTarget, "p-tooltip-arrow");
      !valid && this.deactivate();
    } else {
      this.deactivate();
    }
  }
  onTouchStart(e) {
    if (!this.container && !this.showTimeout) {
      this.activate();
      if (!this.isAutoHide()) {
        this.bindDocumentTouchListener();
      }
    }
  }
  onTouchEnd(e) {
    if (this.isAutoHide()) {
      this.deactivate();
    }
  }
  bindDocumentTouchListener() {
    if (!this.documentTouchListener) {
      this.documentTouchListener = this.renderer.listen("document", "touchstart", (e) => {
        if (this.container && !this.container.contains(e.target) && !this.el.nativeElement.contains(e.target)) {
          this.deactivate();
          this.unbindDocumentTouchListener();
        }
      });
    }
  }
  unbindDocumentTouchListener() {
    if (this.documentTouchListener) {
      this.documentTouchListener();
      this.documentTouchListener = null;
    }
  }
  onFocus(e) {
    this.activate();
  }
  onBlur(e) {
    this.deactivate();
  }
  onInputClick(e) {
    this.deactivate();
  }
  hasEllipsis() {
    const el = this.el.nativeElement;
    return el.offsetWidth < el.scrollWidth || el.offsetHeight < el.scrollHeight;
  }
  activate() {
    if (!this.interactionInProgress) {
      if (this.getOption("showOnEllipsis") && !this.hasEllipsis()) {
        return;
      }
      this.active = true;
      this.clearHideTimeout();
      if (this.getOption("showDelay")) this.showTimeout = setTimeout(() => {
        this.show();
      }, this.getOption("showDelay"));
      else this.show();
      if (this.getOption("life")) {
        let duration = this.getOption("showDelay") ? this.getOption("life") + this.getOption("showDelay") : this.getOption("life");
        this.hideTimeout = setTimeout(() => {
          this.hide();
        }, duration);
      }
      if (this.getOption("hideOnEscape")) {
        this.documentEscapeListener = this.renderer.listen("document", "keydown.escape", () => {
          this.deactivate();
          this.documentEscapeListener?.();
        });
      }
      this.interactionInProgress = true;
    }
  }
  deactivate() {
    this.interactionInProgress = false;
    this.active = false;
    this.clearShowTimeout();
    if (this.getOption("hideDelay")) {
      this.clearHideTimeout();
      this.hideTimeout = setTimeout(() => {
        this.hide();
      }, this.getOption("hideDelay"));
    } else {
      this.hide();
    }
    if (this.documentEscapeListener) {
      this.documentEscapeListener();
    }
  }
  create() {
    if (this.container) {
      this.clearHideTimeout();
      this.remove();
    }
    this.container = U("div", {
      class: this.cx("root"),
      "p-bind": this.ptm("root"),
      "data-pc-section": "root"
    });
    this.container.setAttribute("role", "tooltip");
    let tooltipArrow = U("div", {
      class: this.cx("arrow"),
      "p-bind": this.ptm("arrow"),
      "data-pc-section": "arrow"
    });
    this.container.appendChild(tooltipArrow);
    this.tooltipText = U("div", {
      class: this.cx("text"),
      "p-bind": this.ptm("text"),
      "data-pc-section": "text"
    });
    this.updateText();
    if (this.getOption("positionStyle")) {
      this.container.style.position = this.getOption("positionStyle");
    }
    this.container.appendChild(this.tooltipText);
    if (this.getOption("appendTo") === "body") document.body.appendChild(this.container);
    else if (this.getOption("appendTo") === "target") ut(this.container, this.el.nativeElement);
    else ut(this.getOption("appendTo"), this.container);
    this.container.style.display = "none";
    if (this.fitContent) {
      this.container.style.width = "fit-content";
    }
    if (this.isAutoHide()) {
      this.container.style.pointerEvents = "none";
    } else {
      this.container.style.pointerEvents = "unset";
      this.bindContainerMouseleaveListener();
    }
  }
  bindContainerMouseleaveListener() {
    if (!this.containerMouseleaveListener) {
      const targetEl = this.container ?? this.container.nativeElement;
      this.containerMouseleaveListener = this.renderer.listen(targetEl, "mouseleave", (e) => {
        this.deactivate();
      });
    }
  }
  unbindContainerMouseleaveListener() {
    if (this.containerMouseleaveListener) {
      this.bindContainerMouseleaveListener();
      this.containerMouseleaveListener = null;
    }
  }
  show() {
    if (!this.getOption("tooltipLabel") || this.getOption("disabled")) {
      return;
    }
    this.create();
    const nativeElement = this.el.nativeElement;
    const pDialogWrapper = nativeElement.closest("p-dialog");
    if (pDialogWrapper) {
      setTimeout(() => {
        this.container && (this.container.style.display = "inline-block");
        this.container && this.align();
      }, 100);
    } else {
      this.container.style.display = "inline-block";
      this.align();
    }
    ht(this.container, 250);
    if (this.getOption("tooltipZIndex") === "auto") zindexutils.set("tooltip", this.container, this.config.zIndex.tooltip);
    else this.container.style.zIndex = this.getOption("tooltipZIndex");
    this.bindDocumentResizeListener();
    this.bindScrollListener();
  }
  hide() {
    if (this.getOption("tooltipZIndex") === "auto") {
      zindexutils.clear(this.container);
    }
    this.remove();
  }
  updateText() {
    const content = this.getOption("tooltipLabel");
    if (content && typeof content.createEmbeddedView === "function") {
      const embeddedViewRef = this.viewContainer.createEmbeddedView(content);
      embeddedViewRef.detectChanges();
      embeddedViewRef.rootNodes.forEach((node) => this.tooltipText.appendChild(node));
    } else if (this.getOption("escape")) {
      this.tooltipText.innerHTML = "";
      this.tooltipText.appendChild(document.createTextNode(content));
    } else {
      this.tooltipText.innerHTML = content;
    }
  }
  align() {
    const position = this.getOption("tooltipPosition");
    const positionPriority = {
      top: [this.alignTop, this.alignBottom, this.alignRight, this.alignLeft],
      bottom: [this.alignBottom, this.alignTop, this.alignRight, this.alignLeft],
      left: [this.alignLeft, this.alignRight, this.alignTop, this.alignBottom],
      right: [this.alignRight, this.alignLeft, this.alignTop, this.alignBottom]
    };
    const alignFns = positionPriority[position] || [];
    for (let [index, alignmentFn] of alignFns.entries()) {
      if (index === 0) alignmentFn.call(this);
      else if (this.isOutOfBounds()) alignmentFn.call(this);
      else break;
    }
  }
  getHostOffset() {
    if (this.getOption("appendTo") === "body" || this.getOption("appendTo") === "target") {
      let offset = this.el.nativeElement.getBoundingClientRect();
      let targetLeft = offset.left + k();
      let targetTop = offset.top + $();
      return {
        left: targetLeft,
        top: targetTop
      };
    } else {
      return {
        left: 0,
        top: 0
      };
    }
  }
  get activeElement() {
    return this.el.nativeElement.nodeName.startsWith("P-") ? z(this.el.nativeElement, ".p-component") : this.el.nativeElement;
  }
  alignRight() {
    this.preAlign("right");
    const el = this.activeElement;
    const offsetLeft = v(el);
    const offsetTop = (C(el) - C(this.container)) / 2;
    this.alignTooltip(offsetLeft, offsetTop);
    let arrowElement = this.getArrowElement();
    arrowElement.style.top = "50%";
    arrowElement.style.right = null;
    arrowElement.style.bottom = null;
    arrowElement.style.left = "0";
  }
  alignLeft() {
    this.preAlign("left");
    let arrowElement = this.getArrowElement();
    let offsetLeft = v(this.container);
    let offsetTop = (C(this.el.nativeElement) - C(this.container)) / 2;
    this.alignTooltip(-offsetLeft, offsetTop);
    arrowElement.style.top = "50%";
    arrowElement.style.right = "0";
    arrowElement.style.bottom = null;
    arrowElement.style.left = null;
  }
  alignTop() {
    this.preAlign("top");
    let arrowElement = this.getArrowElement();
    let hostOffset = this.getHostOffset();
    let elementWidth = v(this.container);
    let offsetLeft = (v(this.el.nativeElement) - v(this.container)) / 2;
    let offsetTop = C(this.container);
    this.alignTooltip(offsetLeft, -offsetTop);
    let elementRelativeCenter = hostOffset.left - this.getHostOffset().left + elementWidth / 2;
    arrowElement.style.top = null;
    arrowElement.style.right = null;
    arrowElement.style.bottom = "0";
    arrowElement.style.left = elementRelativeCenter + "px";
  }
  getArrowElement() {
    return z(this.container, '[data-pc-section="arrow"]');
  }
  alignBottom() {
    this.preAlign("bottom");
    let arrowElement = this.getArrowElement();
    let elementWidth = v(this.container);
    let hostOffset = this.getHostOffset();
    let offsetLeft = (v(this.el.nativeElement) - v(this.container)) / 2;
    let offsetTop = C(this.el.nativeElement);
    this.alignTooltip(offsetLeft, offsetTop);
    let elementRelativeCenter = hostOffset.left - this.getHostOffset().left + elementWidth / 2;
    arrowElement.style.top = "0";
    arrowElement.style.right = null;
    arrowElement.style.bottom = null;
    arrowElement.style.left = elementRelativeCenter + "px";
  }
  alignTooltip(offsetLeft, offsetTop) {
    let hostOffset = this.getHostOffset();
    let left = hostOffset.left + offsetLeft;
    let top = hostOffset.top + offsetTop;
    this.container.style.left = left + this.getOption("positionLeft") + "px";
    this.container.style.top = top + this.getOption("positionTop") + "px";
  }
  setOption(option) {
    this._tooltipOptions = __spreadValues(__spreadValues({}, this._tooltipOptions), option);
  }
  getOption(option) {
    return this._tooltipOptions[option];
  }
  getTarget(el) {
    return R(el, "p-inputwrapper") ? z(el, "input") : el;
  }
  preAlign(position) {
    this.container.style.left = "-999px";
    this.container.style.top = "-999px";
    this.container.className = this.cn(this.cx("root"), this.ptm("root")?.class, "p-tooltip-" + position, this.getOption("tooltipStyleClass"));
  }
  isOutOfBounds() {
    let offset = this.container.getBoundingClientRect();
    let targetTop = offset.top;
    let targetLeft = offset.left;
    let width = v(this.container);
    let height = C(this.container);
    let viewport = h();
    return targetLeft + width > viewport.width || targetLeft < 0 || targetTop < 0 || targetTop + height > viewport.height;
  }
  onWindowResize(e) {
    this.hide();
  }
  bindDocumentResizeListener() {
    this.zone.runOutsideAngular(() => {
      this.resizeListener = this.onWindowResize.bind(this);
      window.addEventListener("resize", this.resizeListener);
    });
  }
  unbindDocumentResizeListener() {
    if (this.resizeListener) {
      window.removeEventListener("resize", this.resizeListener);
      this.resizeListener = null;
    }
  }
  bindScrollListener() {
    if (!this.scrollHandler) {
      this.scrollHandler = new ConnectedOverlayScrollHandler(this.el.nativeElement, () => {
        if (this.container) {
          this.hide();
        }
      });
    }
    this.scrollHandler.bindScrollListener();
  }
  unbindScrollListener() {
    if (this.scrollHandler) {
      this.scrollHandler.unbindScrollListener();
    }
  }
  unbindEvents() {
    const tooltipEvent = this.getOption("tooltipEvent");
    if (tooltipEvent === "hover" || tooltipEvent === "both") {
      this.el.nativeElement.removeEventListener("mouseenter", this.mouseEnterListener);
      this.el.nativeElement.removeEventListener("mouseleave", this.mouseLeaveListener);
      this.el.nativeElement.removeEventListener("click", this.clickListener);
      this.el.nativeElement.removeEventListener("touchstart", this.touchStartListener);
      this.el.nativeElement.removeEventListener("touchend", this.touchEndListener);
      this.unbindDocumentTouchListener();
    }
    if (tooltipEvent === "focus" || tooltipEvent === "both") {
      let target = this.el.nativeElement.querySelector(".p-component");
      if (!target) {
        target = this.getTarget(this.el.nativeElement);
      }
      target.removeEventListener("focus", this.focusListener);
      target.removeEventListener("blur", this.blurListener);
    }
    this.unbindDocumentResizeListener();
  }
  remove() {
    if (this.container && this.container.parentElement) {
      if (this.getOption("appendTo") === "body") document.body.removeChild(this.container);
      else if (this.getOption("appendTo") === "target") this.el.nativeElement.removeChild(this.container);
      else Gt(this.getOption("appendTo"), this.container);
    }
    this.unbindDocumentResizeListener();
    this.unbindScrollListener();
    this.unbindContainerMouseleaveListener();
    this.unbindDocumentTouchListener();
    this.clearTimeouts();
    this.container = null;
    this.scrollHandler = null;
  }
  clearShowTimeout() {
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
      this.showTimeout = null;
    }
  }
  clearHideTimeout() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }
  clearTimeouts() {
    this.clearShowTimeout();
    this.clearHideTimeout();
  }
  onDestroy() {
    this.unbindEvents();
    if (this.container) {
      zindexutils.clear(this.container);
    }
    this.remove();
    if (this.scrollHandler) {
      this.scrollHandler.destroy();
      this.scrollHandler = null;
    }
    if (this.documentEscapeListener) {
      this.documentEscapeListener();
    }
  }
  static \u0275fac = function Tooltip_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _Tooltip)(\u0275\u0275directiveInject(NgZone), \u0275\u0275directiveInject(ViewContainerRef));
  };
  static \u0275dir = /* @__PURE__ */ \u0275\u0275defineDirective({
    type: _Tooltip,
    selectors: [["", "pTooltip", ""]],
    inputs: {
      tooltipPosition: "tooltipPosition",
      tooltipEvent: "tooltipEvent",
      positionStyle: "positionStyle",
      tooltipStyleClass: "tooltipStyleClass",
      tooltipZIndex: "tooltipZIndex",
      escape: [2, "escape", "escape", booleanAttribute],
      showDelay: [2, "showDelay", "showDelay", numberAttribute],
      hideDelay: [2, "hideDelay", "hideDelay", numberAttribute],
      life: [2, "life", "life", numberAttribute],
      positionTop: [2, "positionTop", "positionTop", numberAttribute],
      positionLeft: [2, "positionLeft", "positionLeft", numberAttribute],
      autoHide: [2, "autoHide", "autoHide", booleanAttribute],
      fitContent: [2, "fitContent", "fitContent", booleanAttribute],
      hideOnEscape: [2, "hideOnEscape", "hideOnEscape", booleanAttribute],
      showOnEllipsis: [2, "showOnEllipsis", "showOnEllipsis", booleanAttribute],
      content: [0, "pTooltip", "content"],
      disabled: [0, "tooltipDisabled", "disabled"],
      tooltipOptions: "tooltipOptions",
      appendTo: [1, "appendTo"],
      ptTooltip: [1, "ptTooltip"],
      pTooltipPT: [1, "pTooltipPT"],
      pTooltipUnstyled: [1, "pTooltipUnstyled"]
    },
    features: [\u0275\u0275ProvidersFeature([TooltipStyle, {
      provide: TOOLTIP_INSTANCE,
      useExisting: _Tooltip
    }, {
      provide: PARENT_INSTANCE,
      useExisting: _Tooltip
    }]), \u0275\u0275InheritDefinitionFeature]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(Tooltip, [{
    type: Directive,
    args: [{
      selector: "[pTooltip]",
      standalone: true,
      providers: [TooltipStyle, {
        provide: TOOLTIP_INSTANCE,
        useExisting: Tooltip
      }, {
        provide: PARENT_INSTANCE,
        useExisting: Tooltip
      }]
    }]
  }], () => [{
    type: NgZone
  }, {
    type: ViewContainerRef
  }], {
    tooltipPosition: [{
      type: Input
    }],
    tooltipEvent: [{
      type: Input
    }],
    positionStyle: [{
      type: Input
    }],
    tooltipStyleClass: [{
      type: Input
    }],
    tooltipZIndex: [{
      type: Input
    }],
    escape: [{
      type: Input,
      args: [{
        transform: booleanAttribute
      }]
    }],
    showDelay: [{
      type: Input,
      args: [{
        transform: numberAttribute
      }]
    }],
    hideDelay: [{
      type: Input,
      args: [{
        transform: numberAttribute
      }]
    }],
    life: [{
      type: Input,
      args: [{
        transform: numberAttribute
      }]
    }],
    positionTop: [{
      type: Input,
      args: [{
        transform: numberAttribute
      }]
    }],
    positionLeft: [{
      type: Input,
      args: [{
        transform: numberAttribute
      }]
    }],
    autoHide: [{
      type: Input,
      args: [{
        transform: booleanAttribute
      }]
    }],
    fitContent: [{
      type: Input,
      args: [{
        transform: booleanAttribute
      }]
    }],
    hideOnEscape: [{
      type: Input,
      args: [{
        transform: booleanAttribute
      }]
    }],
    showOnEllipsis: [{
      type: Input,
      args: [{
        transform: booleanAttribute
      }]
    }],
    content: [{
      type: Input,
      args: ["pTooltip"]
    }],
    disabled: [{
      type: Input,
      args: ["tooltipDisabled"]
    }],
    tooltipOptions: [{
      type: Input
    }],
    appendTo: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "appendTo",
        required: false
      }]
    }],
    ptTooltip: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "ptTooltip",
        required: false
      }]
    }],
    pTooltipPT: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "pTooltipPT",
        required: false
      }]
    }],
    pTooltipUnstyled: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "pTooltipUnstyled",
        required: false
      }]
    }]
  });
})();
var TooltipModule = class _TooltipModule {
  static \u0275fac = function TooltipModule_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _TooltipModule)();
  };
  static \u0275mod = /* @__PURE__ */ \u0275\u0275defineNgModule({
    type: _TooltipModule,
    imports: [Tooltip, BindModule],
    exports: [Tooltip, BindModule]
  });
  static \u0275inj = /* @__PURE__ */ \u0275\u0275defineInjector({
    imports: [BindModule, BindModule]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(TooltipModule, [{
    type: NgModule,
    args: [{
      imports: [Tooltip, BindModule],
      exports: [Tooltip, BindModule]
    }]
  }], null, null);
})();

// node_modules/@primeuix/styles/dist/popover/index.mjs
var style2 = "\n    .p-popover {\n        margin-block-start: dt('popover.gutter');\n        background: dt('popover.background');\n        color: dt('popover.color');\n        border: 1px solid dt('popover.border.color');\n        border-radius: dt('popover.border.radius');\n        box-shadow: dt('popover.shadow');\n        will-change: transform;\n    }\n\n    .p-popover-content {\n        padding: dt('popover.content.padding');\n    }\n\n    .p-popover-flipped {\n        margin-block-start: calc(dt('popover.gutter') * -1);\n        margin-block-end: dt('popover.gutter');\n    }\n\n    .p-popover:after,\n    .p-popover:before {\n        bottom: 100%;\n        left: calc(dt('popover.arrow.offset') + dt('popover.arrow.left'));\n        content: ' ';\n        height: 0;\n        width: 0;\n        position: absolute;\n        pointer-events: none;\n    }\n\n    .p-popover:after {\n        border-width: calc(dt('popover.gutter') - 2px);\n        margin-left: calc(-1 * (dt('popover.gutter') - 2px));\n        border-style: solid;\n        border-color: transparent;\n        border-bottom-color: dt('popover.background');\n    }\n\n    .p-popover:before {\n        border-width: dt('popover.gutter');\n        margin-left: calc(-1 * dt('popover.gutter'));\n        border-style: solid;\n        border-color: transparent;\n        border-bottom-color: dt('popover.border.color');\n    }\n\n    .p-popover-flipped:after,\n    .p-popover-flipped:before {\n        bottom: auto;\n        top: 100%;\n    }\n\n    .p-popover.p-popover-flipped:after {\n        border-bottom-color: transparent;\n        border-top-color: dt('popover.background');\n    }\n\n    .p-popover.p-popover-flipped:before {\n        border-bottom-color: transparent;\n        border-top-color: dt('popover.border.color');\n    }\n";

// node_modules/primeng/fesm2022/primeng-popover.mjs
var _c0 = ["content"];
var _c1 = ["*"];
var _c2 = (a0) => ({
  closeCallback: a0
});
function Popover_Conditional_0_3_ng_template_0_Template(rf, ctx) {
}
function Popover_Conditional_0_3_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275template(0, Popover_Conditional_0_3_ng_template_0_Template, 0, 0, "ng-template");
  }
}
function Popover_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "div", 1);
    \u0275\u0275listener("click", function Popover_Conditional_0_Template_div_click_0_listener($event) {
      \u0275\u0275restoreView(_r1);
      const ctx_r1 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r1.onOverlayClick($event));
    })("pMotionOnEnter", function Popover_Conditional_0_Template_div_pMotionOnEnter_0_listener($event) {
      \u0275\u0275restoreView(_r1);
      const ctx_r1 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r1.onAnimationStart($event));
    })("pMotionOnAfterLeave", function Popover_Conditional_0_Template_div_pMotionOnAfterLeave_0_listener() {
      \u0275\u0275restoreView(_r1);
      const ctx_r1 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r1.onAnimationEnd());
    });
    \u0275\u0275elementStart(1, "div", 2);
    \u0275\u0275listener("click", function Popover_Conditional_0_Template_div_click_1_listener($event) {
      \u0275\u0275restoreView(_r1);
      const ctx_r1 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r1.onContentClick($event));
    })("mousedown", function Popover_Conditional_0_Template_div_mousedown_1_listener($event) {
      \u0275\u0275restoreView(_r1);
      const ctx_r1 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r1.onContentClick($event));
    });
    \u0275\u0275projection(2);
    \u0275\u0275template(3, Popover_Conditional_0_3_Template, 1, 0, null, 3);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r1 = \u0275\u0275nextContext();
    \u0275\u0275styleMap(ctx_r1.sx("root"));
    \u0275\u0275classMap(ctx_r1.cn(ctx_r1.cx("root"), ctx_r1.styleClass));
    \u0275\u0275property("pBind", ctx_r1.ptm("root"))("ngStyle", ctx_r1.style)("pMotion", ctx_r1.overlayVisible)("pMotionAppear", true)("pMotionOptions", ctx_r1.computedMotionOptions());
    \u0275\u0275attribute("aria-modal", ctx_r1.overlayVisible)("aria-label", ctx_r1.ariaLabel)("aria-labelledBy", ctx_r1.ariaLabelledBy);
    \u0275\u0275advance();
    \u0275\u0275classMap(ctx_r1.cx("content"));
    \u0275\u0275property("pBind", ctx_r1.ptm("content"));
    \u0275\u0275advance(2);
    \u0275\u0275property("ngTemplateOutlet", ctx_r1.contentTemplate || ctx_r1._contentTemplate)("ngTemplateOutletContext", \u0275\u0275pureFunction1(17, _c2, ctx_r1.onCloseClick.bind(ctx_r1)));
  }
}
var inlineStyles = {
  root: () => ({
    position: "absolute"
  })
};
var classes2 = {
  root: "p-popover p-component",
  content: "p-popover-content"
};
var PopoverStyle = class _PopoverStyle extends BaseStyle {
  name = "popover";
  style = style2;
  classes = classes2;
  inlineStyles = inlineStyles;
  static \u0275fac = /* @__PURE__ */ (() => {
    let \u0275PopoverStyle_BaseFactory;
    return function PopoverStyle_Factory(__ngFactoryType__) {
      return (\u0275PopoverStyle_BaseFactory || (\u0275PopoverStyle_BaseFactory = \u0275\u0275getInheritedFactory(_PopoverStyle)))(__ngFactoryType__ || _PopoverStyle);
    };
  })();
  static \u0275prov = /* @__PURE__ */ \u0275\u0275defineInjectable({
    token: _PopoverStyle,
    factory: _PopoverStyle.\u0275fac
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(PopoverStyle, [{
    type: Injectable
  }], null, null);
})();
var POPOVER_INSTANCE = new InjectionToken("POPOVER_INSTANCE");
var Popover = class _Popover extends BaseComponent {
  componentName = "Popover";
  $pcPopover = inject(POPOVER_INSTANCE, {
    optional: true,
    skipSelf: true
  }) ?? void 0;
  bindDirectiveInstance = inject(Bind, {
    self: true
  });
  onAfterViewChecked() {
    this.bindDirectiveInstance.setAttrs(this.ptm("host"));
  }
  /**
   * Defines a string that labels the input for accessibility.
   * @group Props
   */
  ariaLabel;
  /**
   * Establishes relationships between the component and label(s) where its value should be one or more element IDs.
   * @group Props
   */
  ariaLabelledBy;
  /**
   * Enables to hide the overlay when outside is clicked.
   * @group Props
   */
  dismissable = true;
  /**
   * Inline style of the component.
   * @group Props
   */
  style;
  /**
   * Style class of the component.
   * @group Props
   */
  styleClass;
  /**
   * Target element to attach the overlay, valid values are "body" or a local ng-template variable of another element (note: use binding with brackets for template variables, e.g. [appendTo]="mydiv" for a div element having #mydiv as variable name).
   * @defaultValue 'self'
   * @group Props
   */
  appendTo = input("body", ...ngDevMode ? [{
    debugName: "appendTo"
  }] : []);
  /**
   * Whether to automatically manage layering.
   * @group Props
   */
  autoZIndex = true;
  /**
   * Aria label of the close icon.
   * @group Props
   */
  ariaCloseLabel;
  /**
   * Base zIndex value to use in layering.
   * @group Props
   */
  baseZIndex = 0;
  /**
   * When enabled, first button receives focus on show.
   * @group Props
   */
  focusOnShow = true;
  /**
   * Transition options of the show animation.
   * @group Props
   * @deprecated since v21.0.0. Use `motionOptions` instead.
   */
  showTransitionOptions = ".12s cubic-bezier(0, 0, 0.2, 1)";
  /**
   * Transition options of the hide animation.
   * @group Props
   * @deprecated since v21.0.0. Use `motionOptions` instead.
   */
  hideTransitionOptions = ".1s linear";
  /**
   * The motion options.
   * @group Props
   */
  motionOptions = input(void 0, ...ngDevMode ? [{
    debugName: "motionOptions"
  }] : []);
  computedMotionOptions = computed(() => {
    return __spreadValues(__spreadValues({}, this.ptm("motion")), this.motionOptions());
  }, ...ngDevMode ? [{
    debugName: "computedMotionOptions"
  }] : []);
  /**
   * Callback to invoke when an overlay becomes visible.
   * @group Emits
   */
  onShow = new EventEmitter();
  /**
   * Callback to invoke when an overlay gets hidden.
   * @group Emits
   */
  onHide = new EventEmitter();
  $appendTo = computed(() => this.appendTo() || this.config.overlayAppendTo(), ...ngDevMode ? [{
    debugName: "$appendTo"
  }] : []);
  container;
  overlayVisible = false;
  render = false;
  selfClick = false;
  documentClickListener;
  target;
  willHide;
  scrollHandler;
  documentResizeListener;
  /**
   * Custom content template.
   * @param {PopoverContentTemplateContext} context - content context.
   * @see {@link PopoverContentTemplateContext}
   * @group Templates
   */
  contentTemplate;
  templates;
  _contentTemplate;
  destroyCallback;
  overlayEventListener;
  overlaySubscription;
  _componentStyle = inject(PopoverStyle);
  zone = inject(NgZone);
  overlayService = inject(OverlayService);
  onAfterContentInit() {
    this.templates.forEach((item) => {
      switch (item.getType()) {
        case "content":
          this._contentTemplate = item.template;
          break;
      }
    });
  }
  bindDocumentClickListener() {
    if (isPlatformBrowser(this.platformId)) {
      if (!this.documentClickListener) {
        let documentEvent = Ut() ? "touchstart" : "click";
        const documentTarget = this.el ? this.el.nativeElement.ownerDocument : this.document;
        this.documentClickListener = this.renderer.listen(documentTarget, documentEvent, (event) => {
          if (!this.dismissable) {
            return;
          }
          if (!this.container?.contains(event.target) && this.target !== event.target && !this.target.contains(event.target) && !this.selfClick) {
            this.hide();
          }
          this.selfClick = false;
          this.cd.markForCheck();
        });
      }
    }
  }
  unbindDocumentClickListener() {
    if (this.documentClickListener) {
      this.documentClickListener();
      this.documentClickListener = null;
      this.selfClick = false;
    }
  }
  /**
   * Toggles the visibility of the panel.
   * @param {Event} event - Browser event
   * @param {Target} target - Target element.
   * @group Method
   */
  toggle(event, target) {
    if (this.overlayVisible) {
      if (this.hasTargetChanged(event, target)) {
        this.destroyCallback = () => {
          this.show(null, target || event.currentTarget || event.target);
        };
      }
      this.hide();
    } else {
      this.show(event, target);
    }
  }
  /**
   * Displays the panel.
   * @param {Event} event - Browser event
   * @param {Target} target - Target element.
   * @group Method
   */
  show(event, target) {
    target && event && event.stopPropagation();
    if (this.container && !this.overlayVisible) {
      this.container = null;
    }
    this.target = target || event.currentTarget || event.target;
    this.overlayVisible = true;
    this.render = true;
    this.cd.markForCheck();
  }
  onOverlayClick(event) {
    this.overlayService.add({
      originalEvent: event,
      target: this.el.nativeElement
    });
    this.selfClick = true;
  }
  onContentClick(event) {
    const targetElement = event.target;
    this.selfClick = event.offsetX < targetElement.clientWidth && event.offsetY < targetElement.clientHeight;
  }
  hasTargetChanged(event, target) {
    return this.target != null && this.target !== (target || event.currentTarget || event.target);
  }
  appendOverlay() {
    if (this.$appendTo() && this.$appendTo() !== "self") {
      if (this.$appendTo() === "body") {
        ut(this.document.body, this.container);
      } else {
        ut(this.$appendTo(), this.container);
      }
    }
  }
  restoreAppend() {
    if (this.container && this.$appendTo() && this.$appendTo() !== "self") {
      ut(this.el.nativeElement, this.container);
    }
  }
  setZIndex() {
    if (this.autoZIndex) {
      zindexutils.set("overlay", this.container, this.baseZIndex + this.config.zIndex.overlay);
    }
  }
  align() {
    if (this.target && this.container) {
      D(this.container, this.target, false);
      const containerOffset = K(this.container);
      const targetOffset = K(this.target);
      const borderRadius = this.document.defaultView?.getComputedStyle(this.container).getPropertyValue("border-radius");
      let arrowLeft = 0;
      if (containerOffset.left < targetOffset.left) {
        arrowLeft = targetOffset.left - containerOffset.left - parseFloat(borderRadius) * 2;
      }
      this.container.style.setProperty(rr("popover.arrow.left").name, `${arrowLeft}px`);
      if (containerOffset.top < targetOffset.top) {
        this.container.setAttribute("data-p-popover-flipped", "true");
        !this.$unstyled() && W(this.container, "p-popover-flipped");
      }
    }
  }
  onAnimationStart(event) {
    this.container = event.element;
    this.container?.setAttribute(this.$attrSelector, "");
    this.appendOverlay();
    this.align();
    this.setZIndex();
    this.bindDocumentClickListener();
    this.bindDocumentResizeListener();
    this.bindScrollListener();
    if (this.focusOnShow) {
      this.focus();
    }
    this.overlayEventListener = (e) => {
      if (this.container && this.container.contains(e.target)) {
        this.selfClick = true;
      }
    };
    this.overlaySubscription = this.overlayService.clickObservable.subscribe(this.overlayEventListener);
    this.onShow.emit(null);
  }
  onAnimationEnd() {
    if (!this.overlayVisible) {
      if (this.destroyCallback) {
        this.destroyCallback();
        this.destroyCallback = null;
      }
      if (this.overlaySubscription) {
        this.overlaySubscription.unsubscribe();
      }
      if (this.autoZIndex) {
        zindexutils.clear(this.container);
      }
      this.onContainerDestroy();
      this.onHide.emit({});
      this.render = false;
      this.container = null;
    }
  }
  focus() {
    let focusable = z(this.container, "[autofocus]");
    if (focusable) {
      this.zone.runOutsideAngular(() => {
        setTimeout(() => focusable.focus(), 5);
      });
    }
  }
  /**
   * Hides the panel.
   * @group Method
   */
  hide() {
    this.overlayVisible = false;
    this.cd.markForCheck();
  }
  onCloseClick(event) {
    this.hide();
    event.preventDefault();
  }
  onEscapeKeydown(_event) {
    this.hide();
  }
  onWindowResize() {
    if (this.overlayVisible && !Yt()) {
      this.hide();
    }
  }
  bindDocumentResizeListener() {
    if (isPlatformBrowser(this.platformId)) {
      if (!this.documentResizeListener) {
        const window2 = this.document.defaultView;
        this.documentResizeListener = this.renderer.listen(window2, "resize", this.onWindowResize.bind(this));
      }
    }
  }
  unbindDocumentResizeListener() {
    if (this.documentResizeListener) {
      this.documentResizeListener();
      this.documentResizeListener = null;
    }
  }
  bindScrollListener() {
    if (isPlatformBrowser(this.platformId)) {
      if (!this.scrollHandler) {
        this.scrollHandler = new ConnectedOverlayScrollHandler(this.target, () => {
          if (this.overlayVisible) {
            this.hide();
          }
        });
      }
      this.scrollHandler.bindScrollListener();
    }
  }
  unbindScrollListener() {
    if (this.scrollHandler) {
      this.scrollHandler.unbindScrollListener();
    }
  }
  onContainerDestroy() {
    if (!this.cd.destroyed) {
      this.target = null;
    }
    this.unbindDocumentClickListener();
    this.unbindDocumentResizeListener();
    this.unbindScrollListener();
  }
  onDestroy() {
    if (this.scrollHandler) {
      this.scrollHandler.destroy();
      this.scrollHandler = null;
    }
    if (this.container && this.autoZIndex) {
      zindexutils.clear(this.container);
    }
    if (!this.cd.destroyed) {
      this.target = null;
    }
    this.destroyCallback = null;
    if (this.container) {
      this.restoreAppend();
      this.onContainerDestroy();
    }
    if (this.overlaySubscription) {
      this.overlaySubscription.unsubscribe();
    }
  }
  static \u0275fac = /* @__PURE__ */ (() => {
    let \u0275Popover_BaseFactory;
    return function Popover_Factory(__ngFactoryType__) {
      return (\u0275Popover_BaseFactory || (\u0275Popover_BaseFactory = \u0275\u0275getInheritedFactory(_Popover)))(__ngFactoryType__ || _Popover);
    };
  })();
  static \u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({
    type: _Popover,
    selectors: [["p-popover"]],
    contentQueries: function Popover_ContentQueries(rf, ctx, dirIndex) {
      if (rf & 1) {
        \u0275\u0275contentQuery(dirIndex, _c0, 4)(dirIndex, PrimeTemplate, 4);
      }
      if (rf & 2) {
        let _t;
        \u0275\u0275queryRefresh(_t = \u0275\u0275loadQuery()) && (ctx.contentTemplate = _t.first);
        \u0275\u0275queryRefresh(_t = \u0275\u0275loadQuery()) && (ctx.templates = _t);
      }
    },
    hostBindings: function Popover_HostBindings(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275listener("keydown.escape", function Popover_keydown_escape_HostBindingHandler($event) {
          return ctx.onEscapeKeydown($event);
        }, \u0275\u0275resolveDocument);
      }
    },
    inputs: {
      ariaLabel: "ariaLabel",
      ariaLabelledBy: "ariaLabelledBy",
      dismissable: [2, "dismissable", "dismissable", booleanAttribute],
      style: "style",
      styleClass: "styleClass",
      appendTo: [1, "appendTo"],
      autoZIndex: [2, "autoZIndex", "autoZIndex", booleanAttribute],
      ariaCloseLabel: "ariaCloseLabel",
      baseZIndex: [2, "baseZIndex", "baseZIndex", numberAttribute],
      focusOnShow: [2, "focusOnShow", "focusOnShow", booleanAttribute],
      showTransitionOptions: "showTransitionOptions",
      hideTransitionOptions: "hideTransitionOptions",
      motionOptions: [1, "motionOptions"]
    },
    outputs: {
      onShow: "onShow",
      onHide: "onHide"
    },
    features: [\u0275\u0275ProvidersFeature([PopoverStyle, {
      provide: POPOVER_INSTANCE,
      useExisting: _Popover
    }, {
      provide: PARENT_INSTANCE,
      useExisting: _Popover
    }]), \u0275\u0275HostDirectivesFeature([Bind]), \u0275\u0275InheritDefinitionFeature],
    ngContentSelectors: _c1,
    decls: 1,
    vars: 1,
    consts: [["role", "dialog", "pMotionName", "p-anchored-overlay", 3, "pBind", "class", "style", "ngStyle", "pMotion", "pMotionAppear", "pMotionOptions"], ["role", "dialog", "pMotionName", "p-anchored-overlay", 3, "click", "pMotionOnEnter", "pMotionOnAfterLeave", "pBind", "ngStyle", "pMotion", "pMotionAppear", "pMotionOptions"], [3, "click", "mousedown", "pBind"], [4, "ngTemplateOutlet", "ngTemplateOutletContext"]],
    template: function Popover_Template(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275projectionDef();
        \u0275\u0275conditionalCreate(0, Popover_Conditional_0_Template, 4, 19, "div", 0);
      }
      if (rf & 2) {
        \u0275\u0275conditional(ctx.render ? 0 : -1);
      }
    },
    dependencies: [CommonModule, NgTemplateOutlet, NgStyle, SharedModule, Bind, MotionModule, MotionDirective],
    encapsulation: 2,
    changeDetection: 0
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(Popover, [{
    type: Component,
    args: [{
      selector: "p-popover",
      standalone: true,
      imports: [CommonModule, SharedModule, Bind, MotionModule],
      providers: [PopoverStyle, {
        provide: POPOVER_INSTANCE,
        useExisting: Popover
      }, {
        provide: PARENT_INSTANCE,
        useExisting: Popover
      }],
      hostDirectives: [Bind],
      template: `
        @if (render) {
            <div
                [pBind]="ptm('root')"
                [class]="cn(cx('root'), styleClass)"
                [style]="sx('root')"
                [ngStyle]="style"
                (click)="onOverlayClick($event)"
                role="dialog"
                [attr.aria-modal]="overlayVisible"
                [attr.aria-label]="ariaLabel"
                [attr.aria-labelledBy]="ariaLabelledBy"
                [pMotion]="overlayVisible"
                pMotionName="p-anchored-overlay"
                [pMotionAppear]="true"
                (pMotionOnEnter)="onAnimationStart($event)"
                (pMotionOnAfterLeave)="onAnimationEnd()"
                [pMotionOptions]="computedMotionOptions()"
            >
                <div [pBind]="ptm('content')" [class]="cx('content')" (click)="onContentClick($event)" (mousedown)="onContentClick($event)">
                    <ng-content></ng-content>
                    <ng-template *ngTemplateOutlet="contentTemplate || _contentTemplate; context: { closeCallback: onCloseClick.bind(this) }"></ng-template>
                </div>
            </div>
        }
    `,
      changeDetection: ChangeDetectionStrategy.OnPush,
      encapsulation: ViewEncapsulation.None
    }]
  }], null, {
    ariaLabel: [{
      type: Input
    }],
    ariaLabelledBy: [{
      type: Input
    }],
    dismissable: [{
      type: Input,
      args: [{
        transform: booleanAttribute
      }]
    }],
    style: [{
      type: Input
    }],
    styleClass: [{
      type: Input
    }],
    appendTo: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "appendTo",
        required: false
      }]
    }],
    autoZIndex: [{
      type: Input,
      args: [{
        transform: booleanAttribute
      }]
    }],
    ariaCloseLabel: [{
      type: Input
    }],
    baseZIndex: [{
      type: Input,
      args: [{
        transform: numberAttribute
      }]
    }],
    focusOnShow: [{
      type: Input,
      args: [{
        transform: booleanAttribute
      }]
    }],
    showTransitionOptions: [{
      type: Input
    }],
    hideTransitionOptions: [{
      type: Input
    }],
    motionOptions: [{
      type: Input,
      args: [{
        isSignal: true,
        alias: "motionOptions",
        required: false
      }]
    }],
    onShow: [{
      type: Output
    }],
    onHide: [{
      type: Output
    }],
    contentTemplate: [{
      type: ContentChild,
      args: ["content", {
        descendants: false
      }]
    }],
    templates: [{
      type: ContentChildren,
      args: [PrimeTemplate]
    }],
    onEscapeKeydown: [{
      type: HostListener,
      args: ["document:keydown.escape", ["$event"]]
    }]
  });
})();
var PopoverModule = class _PopoverModule {
  static \u0275fac = function PopoverModule_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _PopoverModule)();
  };
  static \u0275mod = /* @__PURE__ */ \u0275\u0275defineNgModule({
    type: _PopoverModule,
    imports: [Popover, SharedModule],
    exports: [Popover, SharedModule]
  });
  static \u0275inj = /* @__PURE__ */ \u0275\u0275defineInjector({
    imports: [Popover, SharedModule, SharedModule]
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(PopoverModule, [{
    type: NgModule,
    args: [{
      imports: [Popover, SharedModule],
      exports: [Popover, SharedModule]
    }]
  }], null, null);
})();

// node_modules/jdenticon/dist/jdenticon-module.mjs
function parseHex(hash, startPosition, octets) {
  return parseInt(hash.substr(startPosition, octets), 16);
}
function decToHex(v2) {
  v2 |= 0;
  return v2 < 0 ? "00" : v2 < 16 ? "0" + v2.toString(16) : v2 < 256 ? v2.toString(16) : "ff";
}
function hueToRgb(m1, m2, h2) {
  h2 = h2 < 0 ? h2 + 6 : h2 > 6 ? h2 - 6 : h2;
  return decToHex(255 * (h2 < 1 ? m1 + (m2 - m1) * h2 : h2 < 3 ? m2 : h2 < 4 ? m1 + (m2 - m1) * (4 - h2) : m1));
}
function parseColor(color) {
  if (/^#[0-9a-f]{3,8}$/i.test(color)) {
    let result;
    const colorLength = color.length;
    if (colorLength < 6) {
      const r = color[1], g = color[2], b = color[3], a = color[4] || "";
      result = "#" + r + r + g + g + b + b + a + a;
    }
    if (colorLength == 7 || colorLength > 8) {
      result = color;
    }
    return result;
  }
}
function toCss3Color(hexColor) {
  const a = parseHex(hexColor, 7, 2);
  let result;
  if (isNaN(a)) {
    result = hexColor;
  } else {
    const r = parseHex(hexColor, 1, 2), g = parseHex(hexColor, 3, 2), b = parseHex(hexColor, 5, 2);
    result = "rgba(" + r + "," + g + "," + b + "," + (a / 255).toFixed(2) + ")";
  }
  return result;
}
function hsl(hue, saturation, lightness) {
  let result;
  if (saturation == 0) {
    const partialHex = decToHex(lightness * 255);
    result = partialHex + partialHex + partialHex;
  } else {
    const m2 = lightness <= 0.5 ? lightness * (saturation + 1) : lightness + saturation - lightness * saturation, m1 = lightness * 2 - m2;
    result = hueToRgb(m1, m2, hue * 6 + 2) + hueToRgb(m1, m2, hue * 6) + hueToRgb(m1, m2, hue * 6 - 2);
  }
  return "#" + result;
}
function correctedHsl(hue, saturation, lightness) {
  const correctors = [0.55, 0.5, 0.5, 0.46, 0.6, 0.55, 0.55], corrector = correctors[hue * 6 + 0.5 | 0];
  lightness = lightness < 0.5 ? lightness * corrector * 2 : corrector + (lightness - 0.5) * (1 - corrector) * 2;
  return hsl(hue, saturation, lightness);
}
var GLOBAL = typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : typeof global !== "undefined" ? global : {};
var CONFIG_PROPERTIES = {
  V: "jdenticon_config",
  n: "config"
};
var rootConfigurationHolder = {};
function getConfiguration(paddingOrLocalConfig, defaultPadding) {
  const configObject = typeof paddingOrLocalConfig == "object" && paddingOrLocalConfig || rootConfigurationHolder[
    CONFIG_PROPERTIES.n
    /*MODULE*/
  ] || GLOBAL[
    CONFIG_PROPERTIES.V
    /*GLOBAL*/
  ] || {}, lightnessConfig = configObject["lightness"] || {}, saturation = configObject["saturation"] || {}, colorSaturation = "color" in saturation ? saturation["color"] : saturation, grayscaleSaturation = saturation["grayscale"], backColor = configObject["backColor"], padding = configObject["padding"];
  function lightness(configName, defaultRange) {
    let range = lightnessConfig[configName];
    if (!(range && range.length > 1)) {
      range = defaultRange;
    }
    return function(value) {
      value = range[0] + value * (range[1] - range[0]);
      return value < 0 ? 0 : value > 1 ? 1 : value;
    };
  }
  function hueFunction(originalHue) {
    const hueConfig = configObject["hues"];
    let hue;
    if (hueConfig && hueConfig.length > 0) {
      hue = hueConfig[0 | 0.999 * originalHue * hueConfig.length];
    }
    return typeof hue == "number" ? (
      // A hue was specified. We need to convert the hue from
      // degrees on any turn - e.g. 746° is a perfectly valid hue -
      // to turns in the range [0, 1).
      (hue / 360 % 1 + 1) % 1
    ) : (
      // No hue configured => use original hue
      originalHue
    );
  }
  return {
    W: hueFunction,
    o: typeof colorSaturation == "number" ? colorSaturation : 0.5,
    D: typeof grayscaleSaturation == "number" ? grayscaleSaturation : 0,
    p: lightness("color", [0.4, 0.8]),
    F: lightness("grayscale", [0.3, 0.9]),
    G: parseColor(backColor),
    X: typeof paddingOrLocalConfig == "number" ? paddingOrLocalConfig : typeof padding == "number" ? padding : defaultPadding
  };
}
var Point = class {
  /**
   * @param {number} x 
   * @param {number} y 
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
};
var Transform = class {
  /**
   * @param {number} x The x-coordinate of the upper left corner of the transformed rectangle.
   * @param {number} y The y-coordinate of the upper left corner of the transformed rectangle.
   * @param {number} size The size of the transformed rectangle.
   * @param {number} rotation Rotation specified as 0 = 0 rad, 1 = 0.5π rad, 2 = π rad, 3 = 1.5π rad
   */
  constructor(x, y, size, rotation) {
    this.q = x;
    this.t = y;
    this.H = size;
    this.Y = rotation;
  }
  /**
   * Transforms the specified point based on the translation and rotation specification for this Transform.
   * @param {number} x x-coordinate
   * @param {number} y y-coordinate
   * @param {number=} w The width of the transformed rectangle. If greater than 0, this will ensure the returned point is of the upper left corner of the transformed rectangle.
   * @param {number=} h The height of the transformed rectangle. If greater than 0, this will ensure the returned point is of the upper left corner of the transformed rectangle.
   */
  I(x, y, w, h2) {
    const right = this.q + this.H, bottom = this.t + this.H, rotation = this.Y;
    return rotation === 1 ? new Point(right - y - (h2 || 0), this.t + x) : rotation === 2 ? new Point(right - x - (w || 0), bottom - y - (h2 || 0)) : rotation === 3 ? new Point(this.q + y, bottom - x - (w || 0)) : new Point(this.q + x, this.t + y);
  }
};
var NO_TRANSFORM = new Transform(0, 0, 0, 0);
var Graphics = class {
  /**
   * @param {Renderer} renderer 
   */
  constructor(renderer) {
    this.J = renderer;
    this.u = NO_TRANSFORM;
  }
  /**
   * Adds a polygon to the underlying renderer.
   * @param {Array<number>} points The points of the polygon clockwise on the format [ x0, y0, x1, y1, ..., xn, yn ]
   * @param {boolean=} invert Specifies if the polygon will be inverted.
   */
  g(points, invert) {
    const di = invert ? -2 : 2, transformedPoints = [];
    for (let i = invert ? points.length - 2 : 0; i < points.length && i >= 0; i += di) {
      transformedPoints.push(this.u.I(points[i], points[i + 1]));
    }
    this.J.g(transformedPoints);
  }
  /**
   * Adds a polygon to the underlying renderer.
   * Source: http://stackoverflow.com/a/2173084
   * @param {number} x The x-coordinate of the upper left corner of the rectangle holding the entire ellipse.
   * @param {number} y The y-coordinate of the upper left corner of the rectangle holding the entire ellipse.
   * @param {number} size The size of the ellipse.
   * @param {boolean=} invert Specifies if the ellipse will be inverted.
   */
  h(x, y, size, invert) {
    const p = this.u.I(x, y, size, size);
    this.J.h(p, size, invert);
  }
  /**
   * Adds a rectangle to the underlying renderer.
   * @param {number} x The x-coordinate of the upper left corner of the rectangle.
   * @param {number} y The y-coordinate of the upper left corner of the rectangle.
   * @param {number} w The width of the rectangle.
   * @param {number} h The height of the rectangle.
   * @param {boolean=} invert Specifies if the rectangle will be inverted.
   */
  i(x, y, w, h2, invert) {
    this.g([
      x,
      y,
      x + w,
      y,
      x + w,
      y + h2,
      x,
      y + h2
    ], invert);
  }
  /**
   * Adds a right triangle to the underlying renderer.
   * @param {number} x The x-coordinate of the upper left corner of the rectangle holding the triangle.
   * @param {number} y The y-coordinate of the upper left corner of the rectangle holding the triangle.
   * @param {number} w The width of the triangle.
   * @param {number} h The height of the triangle.
   * @param {number} r The rotation of the triangle (clockwise). 0 = right corner of the triangle in the lower left corner of the bounding rectangle.
   * @param {boolean=} invert Specifies if the triangle will be inverted.
   */
  j(x, y, w, h2, r, invert) {
    const points = [
      x + w,
      y,
      x + w,
      y + h2,
      x,
      y + h2,
      x,
      y
    ];
    points.splice((r || 0) % 4 * 2, 2);
    this.g(points, invert);
  }
  /**
   * Adds a rhombus to the underlying renderer.
   * @param {number} x The x-coordinate of the upper left corner of the rectangle holding the rhombus.
   * @param {number} y The y-coordinate of the upper left corner of the rectangle holding the rhombus.
   * @param {number} w The width of the rhombus.
   * @param {number} h The height of the rhombus.
   * @param {boolean=} invert Specifies if the rhombus will be inverted.
   */
  K(x, y, w, h2, invert) {
    this.g([
      x + w / 2,
      y,
      x + w,
      y + h2 / 2,
      x + w / 2,
      y + h2,
      x,
      y + h2 / 2
    ], invert);
  }
};
function centerShape(index, g, cell, positionIndex) {
  index = index % 14;
  let k2, m, w, h2, inner, outer;
  !index ? (k2 = cell * 0.42, g.g([
    0,
    0,
    cell,
    0,
    cell,
    cell - k2 * 2,
    cell - k2,
    cell,
    0,
    cell
  ])) : index == 1 ? (w = 0 | cell * 0.5, h2 = 0 | cell * 0.8, g.j(cell - w, 0, w, h2, 2)) : index == 2 ? (w = 0 | cell / 3, g.i(w, w, cell - w, cell - w)) : index == 3 ? (inner = cell * 0.1, // Use fixed outer border widths in small icons to ensure the border is drawn
  outer = cell < 6 ? 1 : cell < 8 ? 2 : 0 | cell * 0.25, inner = inner > 1 ? 0 | inner : (
    // large icon => truncate decimals
    inner > 0.5 ? 1 : (
      // medium size icon => fixed width
      inner
    )
  ), // small icon => anti-aliased border
  g.i(outer, outer, cell - inner - outer, cell - inner - outer)) : index == 4 ? (m = 0 | cell * 0.15, w = 0 | cell * 0.5, g.h(cell - w - m, cell - w - m, w)) : index == 5 ? (inner = cell * 0.1, outer = inner * 4, // Align edge to nearest pixel in large icons
  outer > 3 && (outer = 0 | outer), g.i(0, 0, cell, cell), g.g([
    outer,
    outer,
    cell - inner,
    outer,
    outer + (cell - outer - inner) / 2,
    cell - inner
  ], true)) : index == 6 ? g.g([
    0,
    0,
    cell,
    0,
    cell,
    cell * 0.7,
    cell * 0.4,
    cell * 0.4,
    cell * 0.7,
    cell,
    0,
    cell
  ]) : index == 7 ? g.j(cell / 2, cell / 2, cell / 2, cell / 2, 3) : index == 8 ? (g.i(0, 0, cell, cell / 2), g.i(0, cell / 2, cell / 2, cell / 2), g.j(cell / 2, cell / 2, cell / 2, cell / 2, 1)) : index == 9 ? (inner = cell * 0.14, // Use fixed outer border widths in small icons to ensure the border is drawn
  outer = cell < 4 ? 1 : cell < 6 ? 2 : 0 | cell * 0.35, inner = cell < 8 ? inner : (
    // small icon => anti-aliased border
    0 | inner
  ), // large icon => truncate decimals
  g.i(0, 0, cell, cell), g.i(outer, outer, cell - outer - inner, cell - outer - inner, true)) : index == 10 ? (inner = cell * 0.12, outer = inner * 3, g.i(0, 0, cell, cell), g.h(outer, outer, cell - inner - outer, true)) : index == 11 ? g.j(cell / 2, cell / 2, cell / 2, cell / 2, 3) : index == 12 ? (m = cell * 0.25, g.i(0, 0, cell, cell), g.K(m, m, cell - m, cell - m, true)) : (
    // 13
    !positionIndex && (m = cell * 0.4, w = cell * 1.2, g.h(m, m, w))
  );
}
function outerShape(index, g, cell) {
  index = index % 4;
  let m;
  !index ? g.j(0, 0, cell, cell, 0) : index == 1 ? g.j(0, cell / 2, cell, cell / 2, 0) : index == 2 ? g.K(0, 0, cell, cell) : (
    // 3
    (m = cell / 6, g.h(m, m, cell - 2 * m))
  );
}
function colorTheme(hue, config) {
  hue = config.W(hue);
  return [
    // Dark gray
    correctedHsl(hue, config.D, config.F(0)),
    // Mid color
    correctedHsl(hue, config.o, config.p(0.5)),
    // Light gray
    correctedHsl(hue, config.D, config.F(1)),
    // Light color
    correctedHsl(hue, config.o, config.p(1)),
    // Dark color
    correctedHsl(hue, config.o, config.p(0))
  ];
}
function iconGenerator(renderer, hash, config) {
  const parsedConfig = getConfiguration(config, 0.08);
  if (parsedConfig.G) {
    renderer.m(
      parsedConfig.G
      /*backColor*/
    );
  }
  let size = renderer.k;
  const padding = 0.5 + size * parsedConfig.X | 0;
  size -= padding * 2;
  const graphics = new Graphics(renderer);
  const cell = 0 | size / 4;
  const x = 0 | padding + size / 2 - cell * 2;
  const y = 0 | padding + size / 2 - cell * 2;
  function renderShape(colorIndex, shapes, index2, rotationIndex, positions) {
    const shapeIndex = parseHex(hash, index2, 1);
    let r = rotationIndex ? parseHex(hash, rotationIndex, 1) : 0;
    renderer.L(availableColors[selectedColorIndexes[colorIndex]]);
    for (let i = 0; i < positions.length; i++) {
      graphics.u = new Transform(x + positions[i][0] * cell, y + positions[i][1] * cell, cell, r++ % 4);
      shapes(shapeIndex, graphics, cell, i);
    }
    renderer.M();
  }
  const hue = parseHex(hash, -7) / 268435455, availableColors = colorTheme(hue, parsedConfig), selectedColorIndexes = [];
  let index;
  function isDuplicate(values) {
    if (values.indexOf(index) >= 0) {
      for (let i = 0; i < values.length; i++) {
        if (selectedColorIndexes.indexOf(values[i]) >= 0) {
          return true;
        }
      }
    }
  }
  for (let i = 0; i < 3; i++) {
    index = parseHex(hash, 8 + i, 1) % availableColors.length;
    if (isDuplicate([0, 4]) || // Disallow dark gray and dark color combo
    isDuplicate([2, 3])) {
      index = 1;
    }
    selectedColorIndexes.push(index);
  }
  renderShape(0, outerShape, 2, 3, [[1, 0], [2, 0], [2, 3], [1, 3], [0, 1], [3, 1], [3, 2], [0, 2]]);
  renderShape(1, outerShape, 4, 5, [[0, 0], [3, 0], [3, 3], [0, 3]]);
  renderShape(2, centerShape, 1, null, [[1, 1], [2, 1], [2, 2], [1, 2]]);
  renderer.finish();
}
function sha1(message) {
  const HASH_SIZE_HALF_BYTES = 40;
  const BLOCK_SIZE_WORDS = 16;
  var i = 0, f = 0, urlEncodedMessage = encodeURI(message) + "%80", data = [], dataSize, hashBuffer = [], a = 1732584193, b = 4023233417, c = ~a, d = ~b, e = 3285377520, hash = [a, b, c, d, e], blockStartIndex = 0, hexHash = "";
  function rotl(value, shift) {
    return value << shift | value >>> 32 - shift;
  }
  for (; i < urlEncodedMessage.length; f++) {
    data[f >> 2] = data[f >> 2] | (urlEncodedMessage[i] == "%" ? parseInt(urlEncodedMessage.substring(i + 1, i += 3), 16) : urlEncodedMessage.charCodeAt(i++)) << (3 - (f & 3)) * 8;
  }
  dataSize = ((f + 7 >> 6) + 1) * BLOCK_SIZE_WORDS;
  data[dataSize - 1] = f * 8 - 8;
  for (; blockStartIndex < dataSize; blockStartIndex += BLOCK_SIZE_WORDS) {
    for (i = 0; i < 80; i++) {
      f = rotl(a, 5) + e + // Ch
      (i < 20 ? (b & c ^ ~b & d) + 1518500249 : (
        // Parity
        i < 40 ? (b ^ c ^ d) + 1859775393 : (
          // Maj
          i < 60 ? (b & c ^ b & d ^ c & d) + 2400959708 : (
            // Parity
            (b ^ c ^ d) + 3395469782
          )
        )
      )) + (hashBuffer[i] = i < BLOCK_SIZE_WORDS ? data[blockStartIndex + i] | 0 : rotl(hashBuffer[i - 3] ^ hashBuffer[i - 8] ^ hashBuffer[i - 14] ^ hashBuffer[i - 16], 1));
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = f;
    }
    hash[0] = a = hash[0] + a | 0;
    hash[1] = b = hash[1] + b | 0;
    hash[2] = c = hash[2] + c | 0;
    hash[3] = d = hash[3] + d | 0;
    hash[4] = e = hash[4] + e | 0;
  }
  for (i = 0; i < HASH_SIZE_HALF_BYTES; i++) {
    hexHash += // Get word (2^3 half-bytes per word)
    (hash[i >> 3] >>> // Append half-bytes in reverse order
    (7 - (i & 7)) * 4 & 15).toString(16);
  }
  return hexHash;
}
function isValidHash(hashCandidate) {
  return /^[0-9a-f]{11,}$/i.test(hashCandidate) && hashCandidate;
}
function computeHash(value) {
  return sha1(value == null ? "" : "" + value);
}
var CanvasRenderer = class {
  /**
   * @param {number=} iconSize
   */
  constructor(ctx, iconSize) {
    const canvas = ctx.canvas;
    const width = canvas.width;
    const height = canvas.height;
    ctx.save();
    if (!iconSize) {
      iconSize = Math.min(width, height);
      ctx.translate(
        (width - iconSize) / 2 | 0,
        (height - iconSize) / 2 | 0
      );
    }
    this.l = ctx;
    this.k = iconSize;
    ctx.clearRect(0, 0, iconSize, iconSize);
  }
  /**
   * Fills the background with the specified color.
   * @param {string} fillColor  Fill color on the format #rrggbb[aa].
   */
  m(fillColor) {
    const ctx = this.l;
    const iconSize = this.k;
    ctx.fillStyle = toCss3Color(fillColor);
    ctx.fillRect(0, 0, iconSize, iconSize);
  }
  /**
   * Marks the beginning of a new shape of the specified color. Should be ended with a call to endShape.
   * @param {string} fillColor Fill color on format #rrggbb[aa].
   */
  L(fillColor) {
    const ctx = this.l;
    ctx.fillStyle = toCss3Color(fillColor);
    ctx.beginPath();
  }
  /**
   * Marks the end of the currently drawn shape. This causes the queued paths to be rendered on the canvas.
   */
  M() {
    this.l.fill();
  }
  /**
   * Adds a polygon to the rendering queue.
   * @param points An array of Point objects.
   */
  g(points) {
    const ctx = this.l;
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
  }
  /**
   * Adds a circle to the rendering queue.
   * @param {Point} point The upper left corner of the circle bounding box.
   * @param {number} diameter The diameter of the circle.
   * @param {boolean} counterClockwise True if the circle is drawn counter-clockwise (will result in a hole if rendered on a clockwise path).
   */
  h(point, diameter, counterClockwise) {
    const ctx = this.l, radius = diameter / 2;
    ctx.moveTo(point.x + radius, point.y + radius);
    ctx.arc(point.x + radius, point.y + radius, radius, 0, Math.PI * 2, counterClockwise);
    ctx.closePath();
  }
  /**
   * Called when the icon has been completely drawn.
   */
  finish() {
    this.l.restore();
  }
};
var ICON_TYPE_SVG = 1;
var ICON_TYPE_CANVAS = 2;
var ATTRIBUTES = {
  Z: "data-jdenticon-hash",
  N: "data-jdenticon-value"
};
var IS_RENDERED_PROPERTY = "jdenticonRendered";
var documentQuerySelectorAll = (
  /** @type {!Function} */
  typeof document !== "undefined" && document.querySelectorAll.bind(document)
);
function getIdenticonType(el) {
  if (el) {
    const tagName = el["tagName"];
    if (/^svg$/i.test(tagName)) {
      return ICON_TYPE_SVG;
    }
    if (/^canvas$/i.test(tagName) && "getContext" in el) {
      return ICON_TYPE_CANVAS;
    }
  }
}
function svgValue(value) {
  return (value * 10 + 0.5 | 0) / 10;
}
var SvgPath = class {
  constructor() {
    this.v = "";
  }
  /**
   * Adds a polygon with the current fill color to the SVG path.
   * @param points An array of Point objects.
   */
  g(points) {
    let dataString = "";
    for (let i = 0; i < points.length; i++) {
      dataString += (i ? "L" : "M") + svgValue(points[i].x) + " " + svgValue(points[i].y);
    }
    this.v += dataString + "Z";
  }
  /**
   * Adds a circle with the current fill color to the SVG path.
   * @param {Point} point The upper left corner of the circle bounding box.
   * @param {number} diameter The diameter of the circle.
   * @param {boolean} counterClockwise True if the circle is drawn counter-clockwise (will result in a hole if rendered on a clockwise path).
   */
  h(point, diameter, counterClockwise) {
    const sweepFlag = counterClockwise ? 0 : 1, svgRadius = svgValue(diameter / 2), svgDiameter = svgValue(diameter), svgArc = "a" + svgRadius + "," + svgRadius + " 0 1," + sweepFlag + " ";
    this.v += "M" + svgValue(point.x) + " " + svgValue(point.y + diameter / 2) + svgArc + svgDiameter + ",0" + svgArc + -svgDiameter + ",0";
  }
};
var SvgRenderer = class {
  /**
   * @param {SvgElement|SvgWriter} target 
   */
  constructor(target) {
    this.A;
    this.B = {};
    this.O = target;
    this.k = target.k;
  }
  /**
   * Fills the background with the specified color.
   * @param {string} fillColor  Fill color on the format #rrggbb[aa].
   */
  m(fillColor) {
    const match = /^(#......)(..)?/.exec(fillColor), opacity = match[2] ? parseHex(match[2], 0) / 255 : 1;
    this.O.m(match[1], opacity);
  }
  /**
   * Marks the beginning of a new shape of the specified color. Should be ended with a call to endShape.
   * @param {string} color Fill color on format #xxxxxx.
   */
  L(color) {
    this.A = this.B[color] || (this.B[color] = new SvgPath());
  }
  /**
   * Marks the end of the currently drawn shape.
   */
  M() {
  }
  /**
   * Adds a polygon with the current fill color to the SVG.
   * @param points An array of Point objects.
   */
  g(points) {
    this.A.g(points);
  }
  /**
   * Adds a circle with the current fill color to the SVG.
   * @param {Point} point The upper left corner of the circle bounding box.
   * @param {number} diameter The diameter of the circle.
   * @param {boolean} counterClockwise True if the circle is drawn counter-clockwise (will result in a hole if rendered on a clockwise path).
   */
  h(point, diameter, counterClockwise) {
    this.A.h(point, diameter, counterClockwise);
  }
  /**
   * Called when the icon has been completely drawn.
   */
  finish() {
    const pathsByColor = this.B;
    for (let color in pathsByColor) {
      if (pathsByColor.hasOwnProperty(color)) {
        this.O.P(
          color,
          pathsByColor[color].v
          /*dataString*/
        );
      }
    }
  }
};
var SVG_CONSTANTS = {
  R: "http://www.w3.org/2000/svg",
  S: "width",
  T: "height"
};
function SvgElement_append(parentNode, name, ...keyValuePairs) {
  const el = document.createElementNS(SVG_CONSTANTS.R, name);
  for (let i = 0; i + 1 < keyValuePairs.length; i += 2) {
    el.setAttribute(
      /** @type {string} */
      keyValuePairs[i],
      /** @type {string} */
      keyValuePairs[i + 1]
    );
  }
  parentNode.appendChild(el);
}
var SvgElement = class {
  /**
   * @param {Element} element - Target element
   */
  constructor(element) {
    const iconSize = this.k = Math.min(
      Number(element.getAttribute(
        SVG_CONSTANTS.S
        /*WIDTH*/
      )) || 100,
      Number(element.getAttribute(
        SVG_CONSTANTS.T
        /*HEIGHT*/
      )) || 100
    );
    this.U = element;
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
    element.setAttribute("viewBox", "0 0 " + iconSize + " " + iconSize);
    element.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }
  /**
   * Fills the background with the specified color.
   * @param {string} fillColor  Fill color on the format #rrggbb.
   * @param {number} opacity  Opacity in the range [0.0, 1.0].
   */
  m(fillColor, opacity) {
    if (opacity) {
      SvgElement_append(
        this.U,
        "rect",
        SVG_CONSTANTS.S,
        "100%",
        SVG_CONSTANTS.T,
        "100%",
        "fill",
        fillColor,
        "opacity",
        opacity
      );
    }
  }
  /**
   * Appends a path to the SVG element.
   * @param {string} color Fill color on format #xxxxxx.
   * @param {string} dataString The SVG path data string.
   */
  P(color, dataString) {
    SvgElement_append(
      this.U,
      "path",
      "fill",
      color,
      "d",
      dataString
    );
  }
};
function update(el, hashOrValue, config) {
  renderDomElement(el, hashOrValue, config, function(el2, iconType) {
    if (iconType) {
      return iconType == ICON_TYPE_SVG ? new SvgRenderer(new SvgElement(el2)) : new CanvasRenderer(
        /** @type {HTMLCanvasElement} */
        el2.getContext("2d")
      );
    }
  });
}
function renderDomElement(el, hashOrValue, config, rendererFactory) {
  if (typeof el === "string") {
    if (documentQuerySelectorAll) {
      const elements = documentQuerySelectorAll(el);
      for (let i = 0; i < elements.length; i++) {
        renderDomElement(elements[i], hashOrValue, config, rendererFactory);
      }
    }
    return;
  }
  const hash = (
    // 1. Explicit valid hash
    isValidHash(hashOrValue) || // 2. Explicit value (`!= null` catches both null and undefined)
    hashOrValue != null && computeHash(hashOrValue) || // 3. `data-jdenticon-hash` attribute
    isValidHash(el.getAttribute(
      ATTRIBUTES.Z
      /*HASH*/
    )) || // 4. `data-jdenticon-value` attribute. 
    // We want to treat an empty attribute as an empty value. 
    // Some browsers return empty string even if the attribute 
    // is not specified, so use hasAttribute to determine if 
    // the attribute is specified.
    el.hasAttribute(
      ATTRIBUTES.N
      /*VALUE*/
    ) && computeHash(el.getAttribute(
      ATTRIBUTES.N
      /*VALUE*/
    ))
  );
  if (!hash) {
    return;
  }
  const renderer = rendererFactory(el, getIdenticonType(el));
  if (renderer) {
    iconGenerator(renderer, hash, config);
    el[IS_RENDERED_PROPERTY] = true;
  }
}

// apps/web/src/app/shared/components/jdenticon-avatar/jdenticon-avatar.component.ts
var _c02 = ["svgIcon"];
var JdenticonAvatarComponent = class _JdenticonAvatarComponent {
  value = "Clessia";
  size = 40;
  svgIcon;
  constructor() {
    afterNextRender(() => {
      this.updateAvatar();
    });
    effect(() => {
      if (this.svgIcon) {
        this.updateAvatar();
      }
    });
  }
  ngOnChanges() {
    if (this.svgIcon) {
      this.updateAvatar();
    }
  }
  updateAvatar() {
    if (this.svgIcon?.nativeElement) {
      update(this.svgIcon.nativeElement, this.value);
    }
  }
  static \u0275fac = function JdenticonAvatarComponent_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _JdenticonAvatarComponent)();
  };
  static \u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _JdenticonAvatarComponent, selectors: [["app-jdenticon-avatar"]], viewQuery: function JdenticonAvatarComponent_Query(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275viewQuery(_c02, 5);
    }
    if (rf & 2) {
      let _t;
      \u0275\u0275queryRefresh(_t = \u0275\u0275loadQuery()) && (ctx.svgIcon = _t.first);
    }
  }, inputs: { value: "value", size: "size" }, features: [\u0275\u0275NgOnChangesFeature], decls: 2, vars: 3, consts: [["svgIcon", ""]], template: function JdenticonAvatarComponent_Template(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275namespaceSVG();
      \u0275\u0275domElement(0, "svg", null, 0);
    }
    if (rf & 2) {
      \u0275\u0275attribute("width", ctx.size)("height", ctx.size)("data-jdenticon-value", ctx.value);
    }
  }, styles: ["\n\n[_nghost-%COMP%] {\n  display: inline-flex;\n  border-radius: 50%;\n  overflow: hidden;\n}\n/*# sourceMappingURL=jdenticon-avatar.component.css.map */"] });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(JdenticonAvatarComponent, [{
    type: Component,
    args: [{ selector: "app-jdenticon-avatar", standalone: true, template: `
    <svg #svgIcon [attr.width]="size" [attr.height]="size" [attr.data-jdenticon-value]="value"></svg>
  `, styles: ["/* angular:styles/component:scss;6a76203c715c4103a16cb7dd4c987b966402065330ec23d1e9865342a93eb1db;/Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web/src/app/shared/components/jdenticon-avatar/jdenticon-avatar.component.ts */\n:host {\n  display: inline-flex;\n  border-radius: 50%;\n  overflow: hidden;\n}\n/*# sourceMappingURL=jdenticon-avatar.component.css.map */\n"] }]
  }], () => [], { value: [{
    type: Input
  }], size: [{
    type: Input
  }], svgIcon: [{
    type: ViewChild,
    args: ["svgIcon"]
  }] });
})();
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(JdenticonAvatarComponent, { className: "JdenticonAvatarComponent", filePath: "apps/web/src/app/shared/components/jdenticon-avatar/jdenticon-avatar.component.ts", lineNumber: 18 });
})();

// apps/web/src/app/core/device.service.ts
var DeviceService = class _DeviceService {
  platformId = inject(PLATFORM_ID);
  _isTouchDevice = signal(false, ...ngDevMode ? [{ debugName: "_isTouchDevice" }] : []);
  isTouchDevice = this._isTouchDevice.asReadonly();
  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.checkDevice();
    }
  }
  checkDevice() {
    const mql = window.matchMedia("(pointer: coarse)");
    this._isTouchDevice.set(mql.matches);
    mql.addEventListener("change", (e) => {
      this._isTouchDevice.set(e.matches);
    });
  }
  static \u0275fac = function DeviceService_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _DeviceService)();
  };
  static \u0275prov = /* @__PURE__ */ \u0275\u0275defineInjectable({ token: _DeviceService, factory: _DeviceService.\u0275fac, providedIn: "root" });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(DeviceService, [{
    type: Injectable,
    args: [{
      providedIn: "root"
    }]
  }], () => [], null);
})();

// apps/web/src/app/shared/directives/auto-open-tooltip.directive.ts
var AutoOpenTooltipDirective = class _AutoOpenTooltipDirective {
  tooltip = inject(Tooltip, { self: true });
  el = inject(ElementRef);
  platformId = inject(PLATFORM_ID);
  device = inject(DeviceService);
  document = inject(DOCUMENT);
  autoShow = input(true, __spreadProps(__spreadValues({}, ngDevMode ? { debugName: "autoShow" } : {}), { alias: "appAutoOpenTooltip", transform: booleanAttribute }));
  initialDelay = input(0, __spreadProps(__spreadValues({}, ngDevMode ? { debugName: "initialDelay" } : {}), {
    alias: "appAutoOpenTooltipInitialDelay",
    transform: numberAttribute
  }));
  leaveDelay = input(3e3, __spreadProps(__spreadValues({}, ngDevMode ? { debugName: "leaveDelay" } : {}), { alias: "appAutoOpenTooltipLeaveDelay", transform: numberAttribute }));
  animate = input(true, __spreadProps(__spreadValues({}, ngDevMode ? { debugName: "animate" } : {}), { alias: "appAutoOpenTooltipAnimate", transform: booleanAttribute }));
  enterDelay = input(0, __spreadProps(__spreadValues({}, ngDevMode ? { debugName: "enterDelay" } : {}), {
    alias: "appAutoOpenTooltipEnterDelay",
    transform: numberAttribute
  }));
  enterDuration = input(180, __spreadProps(__spreadValues({}, ngDevMode ? { debugName: "enterDuration" } : {}), {
    alias: "appAutoOpenTooltipEnterDuration",
    transform: numberAttribute
  }));
  leaveDuration = input(180, __spreadProps(__spreadValues({}, ngDevMode ? { debugName: "leaveDuration" } : {}), {
    alias: "appAutoOpenTooltipLeaveDuration",
    transform: numberAttribute
  }));
  showTimer = null;
  hideTimer = null;
  leaveTimer = null;
  enterFrameTimer = null;
  leaveTransitionCleanup = null;
  documentClickListener = null;
  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.setupDocumentClickListener();
    }
  }
  setupDocumentClickListener() {
    const handler = (event) => {
      const target = event.target;
      if (!this.el.nativeElement.contains(target)) {
        this.clearAllTimers();
        this.clearLeaveTransitionCleanup();
        const container = this.getTooltipContainer();
        if (container) {
          container.classList.add("clessia-tooltip--kill-animations");
          container.classList.remove("clessia-tooltip--leaving");
          container.classList.remove("clessia-tooltip--pre-enter");
          container.style.removeProperty("--clessia-tooltip-enter-duration");
          container.style.removeProperty("--clessia-tooltip-leave-duration");
          container.style.removeProperty("transition");
          container.style.removeProperty("opacity");
        }
        this.tooltip.hide();
      }
    };
    this.document.addEventListener("click", handler, true);
    this.documentClickListener = () => this.document.removeEventListener("click", handler, true);
  }
  clearAllTimers() {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.leaveTimer !== null) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
    if (this.enterFrameTimer !== null) {
      clearTimeout(this.enterFrameTimer);
      this.enterFrameTimer = null;
    }
  }
  ngAfterViewInit() {
    if (this.device.isTouchDevice()) {
      this.tooltip.disabled = true;
      this.tooltip.deactivate();
      return;
    }
    if (!this.autoShow()) {
      return;
    }
    const initialDelay = Math.max(0, this.initialDelay());
    const enterDelay = this.animate() ? Math.max(0, this.enterDelay()) : 0;
    this.showTimer = setTimeout(() => {
      this.tooltip.show();
      this.applyAnimationConfig();
      this.triggerEnterAnimation();
      this.startHideTimer();
    }, initialDelay + enterDelay);
  }
  ngOnDestroy() {
    this.clearAllTimers();
    this.clearLeaveTransitionCleanup();
  }
  startHideTimer() {
    const leaveDelay = Math.max(0, this.leaveDelay());
    const configuredLeaveDuration = this.animate() ? Math.max(0, this.leaveDuration()) : 0;
    const leaveDuration = Math.min(configuredLeaveDuration, leaveDelay);
    const holdDuration = leaveDelay - leaveDuration;
    this.hideTimer = setTimeout(() => {
      if (leaveDuration === 0) {
        this.tooltip.hide();
        return;
      }
      const container = this.getTooltipContainer();
      if (container === null) {
        this.tooltip.hide();
        return;
      }
      this.startLeaveAnimation(container, leaveDuration);
    }, holdDuration);
  }
  applyAnimationConfig() {
    const container = this.getTooltipContainer();
    if (container === null) {
      return;
    }
    const enterDuration = this.animate() ? Math.max(0, this.enterDuration()) : 0;
    const leaveDuration = this.animate() ? Math.max(0, this.leaveDuration()) : 0;
    container.style.setProperty("--clessia-tooltip-enter-duration", `${enterDuration}ms`);
    container.style.setProperty("--clessia-tooltip-leave-duration", `${leaveDuration}ms`);
  }
  triggerEnterAnimation() {
    const container = this.getTooltipContainer();
    if (container === null) {
      return;
    }
    container.classList.remove("clessia-tooltip--leaving");
    container.classList.remove("clessia-tooltip--pre-enter");
    if (!this.animate() || Math.max(0, this.enterDuration()) === 0) {
      return;
    }
    container.classList.add("clessia-tooltip--pre-enter");
    void container.offsetWidth;
    this.enterFrameTimer = setTimeout(() => {
      container.classList.remove("clessia-tooltip--pre-enter");
    }, 16);
  }
  getTooltipContainer() {
    return this.tooltip.container ?? null;
  }
  startLeaveAnimation(container, leaveDuration) {
    this.clearLeaveTransitionCleanup();
    container.classList.add("clessia-tooltip--leaving");
    container.classList.remove("clessia-tooltip--pre-enter");
    let finished = false;
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      this.clearLeaveTransitionCleanup();
      this.tooltip.hide();
    };
    const onTransitionEnd = (event) => {
      if (event.target !== container) {
        return;
      }
      if (event.propertyName !== "transform") {
        return;
      }
      finish();
    };
    container.addEventListener("transitionend", onTransitionEnd);
    this.leaveTransitionCleanup = () => {
      container.removeEventListener("transitionend", onTransitionEnd);
    };
    this.leaveTimer = setTimeout(finish, leaveDuration + 80);
  }
  clearLeaveTransitionCleanup() {
    if (this.leaveTransitionCleanup !== null) {
      this.leaveTransitionCleanup();
      this.leaveTransitionCleanup = null;
    }
    if (this.leaveTimer !== null) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  }
  static \u0275fac = function AutoOpenTooltipDirective_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _AutoOpenTooltipDirective)();
  };
  static \u0275dir = /* @__PURE__ */ \u0275\u0275defineDirective({ type: _AutoOpenTooltipDirective, selectors: [["", "appAutoOpenTooltip", ""]], inputs: { autoShow: [1, "appAutoOpenTooltip", "autoShow"], initialDelay: [1, "appAutoOpenTooltipInitialDelay", "initialDelay"], leaveDelay: [1, "appAutoOpenTooltipLeaveDelay", "leaveDelay"], animate: [1, "appAutoOpenTooltipAnimate", "animate"], enterDelay: [1, "appAutoOpenTooltipEnterDelay", "enterDelay"], enterDuration: [1, "appAutoOpenTooltipEnterDuration", "enterDuration"], leaveDuration: [1, "appAutoOpenTooltipLeaveDuration", "leaveDuration"] } });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(AutoOpenTooltipDirective, [{
    type: Directive,
    args: [{
      selector: "[appAutoOpenTooltip]",
      standalone: true
    }]
  }], () => [], { autoShow: [{ type: Input, args: [{ isSignal: true, alias: "appAutoOpenTooltip", required: false }] }], initialDelay: [{ type: Input, args: [{ isSignal: true, alias: "appAutoOpenTooltipInitialDelay", required: false }] }], leaveDelay: [{ type: Input, args: [{ isSignal: true, alias: "appAutoOpenTooltipLeaveDelay", required: false }] }], animate: [{ type: Input, args: [{ isSignal: true, alias: "appAutoOpenTooltipAnimate", required: false }] }], enterDelay: [{ type: Input, args: [{ isSignal: true, alias: "appAutoOpenTooltipEnterDelay", required: false }] }], enterDuration: [{ type: Input, args: [{ isSignal: true, alias: "appAutoOpenTooltipEnterDuration", required: false }] }], leaveDuration: [{ type: Input, args: [{ isSignal: true, alias: "appAutoOpenTooltipLeaveDuration", required: false }] }] });
})();

// apps/web/src/app/shared/directives/inherit-size.directive.ts
var InheritSizeDirective = class _InheritSizeDirective {
  widthVar = input("--inherited-width", ...ngDevMode ? [{ debugName: "widthVar" }] : []);
  heightVar = input("--inherited-height", ...ngDevMode ? [{ debugName: "heightVar" }] : []);
  elementRef = inject(ElementRef);
  renderer = inject(Renderer2);
  resizeObserver = null;
  ngOnInit() {
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.elementRef.nativeElement.style.setProperty(this.widthVar(), `${width}px`);
        this.elementRef.nativeElement.style.setProperty(this.heightVar(), `${height}px`);
      }
    });
    this.resizeObserver.observe(this.elementRef.nativeElement);
  }
  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }
  static \u0275fac = function InheritSizeDirective_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _InheritSizeDirective)();
  };
  static \u0275dir = /* @__PURE__ */ \u0275\u0275defineDirective({ type: _InheritSizeDirective, selectors: [["", "appInheritSize", ""]], inputs: { widthVar: [1, "widthVar"], heightVar: [1, "heightVar"] } });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(InheritSizeDirective, [{
    type: Directive,
    args: [{
      selector: "[appInheritSize]",
      standalone: true
    }]
  }], null, { widthVar: [{ type: Input, args: [{ isSignal: true, alias: "widthVar", required: false }] }], heightVar: [{ type: Input, args: [{ isSignal: true, alias: "heightVar", required: false }] }] });
})();

// apps/web/src/app/shared/components/layout/shell-layout/shell-layout.component.ts
var _c03 = ["op"];
function ShellLayoutComponent_Conditional_8_Conditional_0_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    const _r2 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "button", 31);
    \u0275\u0275listener("click", function ShellLayoutComponent_Conditional_8_Conditional_0_Conditional_0_Template_button_click_0_listener() {
      \u0275\u0275restoreView(_r2);
      const ctx_r2 = \u0275\u0275nextContext(3);
      return \u0275\u0275resetView(ctx_r2.auth.openRolePicker());
    });
    \u0275\u0275text(1);
    \u0275\u0275element(2, "i", 32);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const role_r4 = \u0275\u0275nextContext(2);
    const ctx_r2 = \u0275\u0275nextContext();
    \u0275\u0275classMap(\u0275\u0275interpolate1("shell-header__role-badge shell-header__role-badge--", role_r4, " shell-header__role-badge--interactive"));
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", ctx_r2.roleLabels[role_r4], " ");
  }
}
function ShellLayoutComponent_Conditional_8_Conditional_0_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    const _r5 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "button", 33);
    \u0275\u0275listener("click", function ShellLayoutComponent_Conditional_8_Conditional_0_Conditional_1_Template_button_click_0_listener() {
      \u0275\u0275restoreView(_r5);
      const ctx_r2 = \u0275\u0275nextContext(3);
      return \u0275\u0275resetView(ctx_r2.auth.openRolePicker());
    });
    \u0275\u0275text(1);
    \u0275\u0275element(2, "i", 32);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const role_r4 = \u0275\u0275nextContext(2);
    const ctx_r2 = \u0275\u0275nextContext();
    \u0275\u0275classMap(\u0275\u0275interpolate1("shell-header__role-badge shell-header__role-badge--", role_r4, " shell-header__role-badge--interactive"));
    \u0275\u0275property("appAutoOpenTooltipEnterDelay", 500)("appAutoOpenTooltipEnterDuration", 220)("appAutoOpenTooltipLeaveDuration", 220);
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", ctx_r2.roleLabels[role_r4], " ");
  }
}
function ShellLayoutComponent_Conditional_8_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275conditionalCreate(0, ShellLayoutComponent_Conditional_8_Conditional_0_Conditional_0_Template, 3, 4, "button", 29)(1, ShellLayoutComponent_Conditional_8_Conditional_0_Conditional_1_Template, 3, 7, "button", 30);
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext(2);
    \u0275\u0275conditional(ctx_r2.device.isTouchDevice() ? 0 : 1);
  }
}
function ShellLayoutComponent_Conditional_8_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span");
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const role_r4 = \u0275\u0275nextContext();
    const ctx_r2 = \u0275\u0275nextContext();
    \u0275\u0275classMap(\u0275\u0275interpolate1("shell-header__role-badge shell-header__role-badge--", role_r4));
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", ctx_r2.roleLabels[role_r4], " ");
  }
}
function ShellLayoutComponent_Conditional_8_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275conditionalCreate(0, ShellLayoutComponent_Conditional_8_Conditional_0_Template, 2, 1)(1, ShellLayoutComponent_Conditional_8_Conditional_1_Template, 2, 4, "span", 29);
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext();
    \u0275\u0275conditional(ctx_r2.auth.roles().length > 1 ? 0 : 1);
  }
}
var ShellLayoutComponent = class _ShellLayoutComponent {
  op;
  auth = inject(AuthService);
  avatarSeed = computed(() => {
    return (this.auth.user()?.id || "ANYMOUS") + "_" + (this.auth.profile()?.display_name || "USER");
  }, ...ngDevMode ? [{ debugName: "avatarSeed" }] : []);
  device = inject(DeviceService);
  roleLabels = {
    admin: "\u7BA1\u7406\u54E1",
    teacher: "\u4EFB\u8AB2\u8001\u5E2B",
    parent: "\u5BB6\u9577"
  };
  router = inject(Router);
  centered = input(false, __spreadProps(__spreadValues({}, ngDevMode ? { debugName: "centered" } : {}), { transform: (v2) => v2 === "" || v2 === true }));
  onResize() {
    this.op?.hide();
  }
  changePassword() {
    this.op.hide();
    const role = this.auth.activeRole();
    this.router.navigate([`/${role}/change-password`]);
  }
  signOut() {
    this.auth.signOut();
  }
  static \u0275fac = function ShellLayoutComponent_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _ShellLayoutComponent)();
  };
  static \u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _ShellLayoutComponent, selectors: [["app-shell-layout"]], viewQuery: function ShellLayoutComponent_Query(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275viewQuery(_c03, 5);
    }
    if (rf & 2) {
      let _t;
      \u0275\u0275queryRefresh(_t = \u0275\u0275loadQuery()) && (ctx.op = _t.first);
    }
  }, hostBindings: function ShellLayoutComponent_HostBindings(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275listener("resize", function ShellLayoutComponent_resize_HostBindingHandler() {
        return ctx.onResize();
      }, \u0275\u0275resolveWindow);
    }
  }, inputs: { centered: [1, "centered"] }, decls: 38, vars: 12, consts: [["userTrigger", ""], ["op", ""], [1, "shell-layout"], [1, "shell-header"], [1, "shell-header__left"], [1, "shell-header__logo-icon"], [1, "shell-header__logo-text"], [1, "shell-header__right"], [1, "shell-header__user", 3, "click"], [1, "shell-header__avatar", 3, "size", "value"], [1, "shell-header__user-name"], ["styleClass", "user-menu-overlay", "appendTo", "body"], [1, "user-menu"], [1, "user-menu__info"], [1, "user-menu__avatar", 3, "size", "value"], [1, "user-menu__text"], [1, "user-menu__name"], [1, "user-menu__email"], [1, "user-menu__divider"], [1, "user-menu__items"], [1, "user-menu__item", 3, "click"], [1, "user-menu__item-icon", "pi", "pi-key"], [1, "user-menu__item", "user-menu__item--danger", 3, "click"], [1, "user-menu__item-icon", "pi", "pi-sign-out"], ["appInheritSize", "", 1, "shell-layout__body", 3, "widthVar", "heightVar"], [1, "shell-container"], ["name", "sidebar"], [1, "shell-content"], ["name", "bottom-bar"], [3, "class"], ["pTooltip", "\u4F60\u64C1\u6709\u591A\u500B\u89D2\u8272\uFF0C\u9EDE\u64CA\u5373\u53EF\u5207\u63DB", "tooltipPosition", "bottom", "tooltipStyleClass", "clessia-tooltip clessia-tooltip--role-switch", "appAutoOpenTooltip", "", 3, "class", "appAutoOpenTooltipEnterDelay", "appAutoOpenTooltipEnterDuration", "appAutoOpenTooltipLeaveDuration"], [3, "click"], [1, "shell-header__role-badge-icon", "pi", "pi-chevron-down"], ["pTooltip", "\u4F60\u64C1\u6709\u591A\u500B\u89D2\u8272\uFF0C\u9EDE\u64CA\u5373\u53EF\u5207\u63DB", "tooltipPosition", "bottom", "tooltipStyleClass", "clessia-tooltip clessia-tooltip--role-switch", "appAutoOpenTooltip", "", 3, "click", "appAutoOpenTooltipEnterDelay", "appAutoOpenTooltipEnterDuration", "appAutoOpenTooltipLeaveDuration"]], template: function ShellLayoutComponent_Template(rf, ctx) {
    if (rf & 1) {
      const _r1 = \u0275\u0275getCurrentView();
      \u0275\u0275elementStart(0, "div", 2)(1, "header", 3)(2, "div", 4)(3, "span", 5);
      \u0275\u0275text(4, "C");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(5, "span", 6);
      \u0275\u0275text(6, "Clessia");
      \u0275\u0275elementEnd()();
      \u0275\u0275elementStart(7, "div", 7);
      \u0275\u0275conditionalCreate(8, ShellLayoutComponent_Conditional_8_Template, 2, 1);
      \u0275\u0275elementStart(9, "div", 8, 0);
      \u0275\u0275listener("click", function ShellLayoutComponent_Template_div_click_9_listener($event) {
        \u0275\u0275restoreView(_r1);
        const userTrigger_r6 = \u0275\u0275reference(10);
        const op_r7 = \u0275\u0275reference(15);
        return \u0275\u0275resetView(op_r7.toggle($event, userTrigger_r6));
      });
      \u0275\u0275element(11, "app-jdenticon-avatar", 9);
      \u0275\u0275elementStart(12, "span", 10);
      \u0275\u0275text(13);
      \u0275\u0275elementEnd()();
      \u0275\u0275elementStart(14, "p-popover", 11, 1)(16, "div", 12)(17, "div", 13);
      \u0275\u0275element(18, "app-jdenticon-avatar", 14);
      \u0275\u0275elementStart(19, "div", 15)(20, "span", 16);
      \u0275\u0275text(21);
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(22, "span", 17);
      \u0275\u0275text(23);
      \u0275\u0275elementEnd()()();
      \u0275\u0275element(24, "hr", 18);
      \u0275\u0275elementStart(25, "div", 19)(26, "button", 20);
      \u0275\u0275listener("click", function ShellLayoutComponent_Template_button_click_26_listener() {
        \u0275\u0275restoreView(_r1);
        return \u0275\u0275resetView(ctx.changePassword());
      });
      \u0275\u0275element(27, "i", 21);
      \u0275\u0275text(28, " \u4FEE\u6539\u5BC6\u78BC ");
      \u0275\u0275elementEnd();
      \u0275\u0275elementStart(29, "button", 22);
      \u0275\u0275listener("click", function ShellLayoutComponent_Template_button_click_29_listener() {
        \u0275\u0275restoreView(_r1);
        return \u0275\u0275resetView(ctx.signOut());
      });
      \u0275\u0275element(30, "i", 23);
      \u0275\u0275text(31, " \u767B\u51FA ");
      \u0275\u0275elementEnd()()()()()();
      \u0275\u0275elementStart(32, "div", 24)(33, "div", 25);
      \u0275\u0275element(34, "router-outlet", 26);
      \u0275\u0275elementStart(35, "main", 27);
      \u0275\u0275element(36, "router-outlet");
      \u0275\u0275elementEnd()()();
      \u0275\u0275element(37, "router-outlet", 28);
      \u0275\u0275elementEnd();
    }
    if (rf & 2) {
      let tmp_2_0;
      let tmp_5_0;
      let tmp_8_0;
      let tmp_9_0;
      \u0275\u0275advance(8);
      \u0275\u0275conditional((tmp_2_0 = ctx.auth.activeRole()) ? 8 : -1, tmp_2_0);
      \u0275\u0275advance(3);
      \u0275\u0275property("size", 30)("value", ctx.avatarSeed());
      \u0275\u0275advance(2);
      \u0275\u0275textInterpolate(((tmp_5_0 = ctx.auth.profile()) == null ? null : tmp_5_0.display_name) || ((tmp_5_0 = ctx.auth.user()) == null ? null : tmp_5_0.email));
      \u0275\u0275advance(5);
      \u0275\u0275property("size", 48)("value", ctx.avatarSeed());
      \u0275\u0275advance(3);
      \u0275\u0275textInterpolate(((tmp_8_0 = ctx.auth.profile()) == null ? null : tmp_8_0.display_name) || "User");
      \u0275\u0275advance(2);
      \u0275\u0275textInterpolate((tmp_9_0 = ctx.auth.user()) == null ? null : tmp_9_0.email);
      \u0275\u0275advance(9);
      \u0275\u0275property("widthVar", "--shell-layout-body-width")("heightVar", "--shell-layout-body-height");
      \u0275\u0275advance(3);
      \u0275\u0275classProp("shell-content--centered", ctx.centered());
    }
  }, dependencies: [RouterOutlet, Tooltip, AutoOpenTooltipDirective, Popover, JdenticonAvatarComponent, InheritSizeDirective], styles: ["\n\n.shell-header[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  height: 56px;\n  padding: 0 var(--space-6);\n  background: var(--zinc-900);\n  color: var(--color-white);\n  z-index: 100;\n  transform: translateZ(0);\n  backface-visibility: hidden;\n}\n.shell-header__left[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n}\n.shell-header__logo-icon[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 32px;\n  height: 32px;\n  font-size: var(--text-md);\n  font-weight: var(--font-bold);\n  color: var(--zinc-900);\n  background:\n    linear-gradient(\n      135deg,\n      var(--color-white) 0%,\n      var(--zinc-200) 100%);\n  border-radius: var(--radius-md);\n}\n.shell-header__logo-text[_ngcontent-%COMP%] {\n  font-size: var(--text-lg);\n  font-weight: var(--font-bold);\n  letter-spacing: -0.02em;\n}\n.shell-header__right[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n}\n.shell-header__role-badge[_ngcontent-%COMP%] {\n  display: inline-flex;\n  align-items: center;\n  gap: var(--space-2);\n  padding: var(--space-1) var(--space-3);\n  font-size: var(--text-xs);\n  font-weight: var(--font-bold);\n  border-radius: var(--radius-full);\n  text-transform: uppercase;\n  letter-spacing: 0.05em;\n  transition: all var(--transition-fast);\n  border: 1px solid var(--zinc-400);\n  color: var(--zinc-400);\n}\n.shell-header__role-badge--interactive[_ngcontent-%COMP%] {\n  cursor: pointer;\n  padding-right: var(--space-2);\n}\n.shell-header__role-badge--interactive[_ngcontent-%COMP%]:hover {\n  filter: brightness(0.95);\n  transform: translateY(-1px);\n}\n.shell-header__role-badge-icon[_ngcontent-%COMP%] {\n  font-size: 10px;\n}\n.shell-header__user[_ngcontent-%COMP%] {\n  position: relative;\n  display: flex;\n  align-items: center;\n  gap: var(--space-2);\n  margin-left: var(--space-4);\n  padding: var(--space-1) var(--space-3) var(--space-1) var(--space-2);\n  font-size: var(--text-sm);\n  color: var(--zinc-400);\n  border-radius: var(--radius-md);\n  cursor: pointer;\n  transition: all var(--transition-fast);\n}\n.shell-header__user[_ngcontent-%COMP%]:hover {\n  color: var(--color-white);\n  background: var(--zinc-800);\n}\n.shell-header__user[_ngcontent-%COMP%]:hover   .shell-header__avatar[_ngcontent-%COMP%] {\n  border-color: var(--color-white);\n}\n.shell-header__avatar[_ngcontent-%COMP%] {\n  display: block;\n  border: 2px solid var(--zinc-400);\n  font-size: 0;\n  border-radius: 50%;\n  transition: border-color var(--transition-fast);\n}\n.user-menu[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  min-width: 240px;\n  background: var(--color-white);\n  overflow: hidden;\n  border-radius: var(--radius-lg);\n}\n.user-menu__info[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: row;\n  align-items: center;\n  gap: var(--space-3);\n  padding: var(--space-4);\n  background: var(--color-white);\n}\n.user-menu__avatar[_ngcontent-%COMP%] {\n  background: var(--zinc-900);\n  border: 2px solid var(--zinc-300);\n  border-radius: 50%;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n.user-menu__text[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-1);\n}\n.user-menu__name[_ngcontent-%COMP%] {\n  font-size: var(--text-sm);\n  font-weight: var(--font-bold);\n  color: var(--zinc-900);\n}\n.user-menu__email[_ngcontent-%COMP%] {\n  font-size: var(--text-xs);\n  color: var(--zinc-500);\n}\n.user-menu__divider[_ngcontent-%COMP%] {\n  height: 1px;\n  margin: 0;\n  background: var(--zinc-200);\n  border: none;\n}\n.user-menu__items[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  padding: var(--space-1);\n}\n.user-menu__item[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  width: 100%;\n  padding: var(--space-3) var(--space-4);\n  font-size: var(--text-sm);\n  color: var(--zinc-600);\n  text-align: left;\n  background: transparent;\n  border: none;\n  border-radius: var(--radius-sm);\n  cursor: pointer;\n  transition: all var(--transition-fast);\n}\n.user-menu__item[_ngcontent-%COMP%]:hover {\n  background: var(--zinc-100);\n  color: var(--zinc-900);\n}\n.user-menu__item--danger[_ngcontent-%COMP%] {\n  color: var(--error-600);\n}\n.user-menu__item--danger[_ngcontent-%COMP%]:hover {\n  background: var(--error-100);\n  color: var(--error-600);\n}\n.user-menu__item-icon[_ngcontent-%COMP%] {\n  font-size: 16px;\n}\n.shell-layout[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  min-height: 100dvh;\n  background: var(--zinc-50);\n  height: var(--window-height);\n}\n.shell-layout__body[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  flex: 1;\n  overflow: hidden;\n}\n.shell-container[_ngcontent-%COMP%] {\n  display: flex;\n  flex: 1;\n  overflow: hidden;\n}\n.shell-content[_ngcontent-%COMP%] {\n  flex: 1;\n  padding: var(--space-8);\n  background: var(--zinc-50);\n  display: flex;\n  flex-direction: column;\n  overflow-y: auto;\n}\n.shell-content--centered[_ngcontent-%COMP%] {\n  align-items: center;\n  justify-content: center;\n}\n@media (max-width: 640px) {\n  .shell-header[_ngcontent-%COMP%] {\n    padding: 0 var(--space-4);\n  }\n  .shell-header__user-name[_ngcontent-%COMP%] {\n    max-width: 100px;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n    opacity: 0.8;\n  }\n  .shell-content[_ngcontent-%COMP%] {\n    padding: var(--space-4);\n    padding-bottom: calc(var(--space-4) + 64px + env(safe-area-inset-bottom, 0px));\n  }\n}\n/*# sourceMappingURL=shell-layout.component.css.map */"] });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(ShellLayoutComponent, [{
    type: Component,
    args: [{ selector: "app-shell-layout", standalone: true, imports: [RouterOutlet, Tooltip, AutoOpenTooltipDirective, Popover, JdenticonAvatarComponent, InheritSizeDirective], template: `<div class="shell-layout">
  <header class="shell-header">
    <div class="shell-header__left">
      <span class="shell-header__logo-icon">C</span>
      <span class="shell-header__logo-text">Clessia</span>
    </div>
    <div class="shell-header__right">
      @if (auth.activeRole(); as role) {
        @if (auth.roles().length > 1) {
          @if (device.isTouchDevice()) {
            <button
              class="shell-header__role-badge shell-header__role-badge--{{
                role
              }} shell-header__role-badge--interactive"
              (click)="auth.openRolePicker()"
            >
              {{ roleLabels[role] }}
              <i class="shell-header__role-badge-icon pi pi-chevron-down"></i>
            </button>
          } @else {
            <button
              class="shell-header__role-badge shell-header__role-badge--{{
                role
              }} shell-header__role-badge--interactive"
              (click)="auth.openRolePicker()"
              pTooltip="\u4F60\u64C1\u6709\u591A\u500B\u89D2\u8272\uFF0C\u9EDE\u64CA\u5373\u53EF\u5207\u63DB"
              tooltipPosition="bottom"
              tooltipStyleClass="clessia-tooltip clessia-tooltip--role-switch"
              appAutoOpenTooltip
              [appAutoOpenTooltipEnterDelay]="500"
              [appAutoOpenTooltipEnterDuration]="220"
              [appAutoOpenTooltipLeaveDuration]="220"
            >
              {{ roleLabels[role] }}
              <i class="shell-header__role-badge-icon pi pi-chevron-down"></i>
            </button>
          }
        } @else {
          <span class="shell-header__role-badge shell-header__role-badge--{{ role }}">
            {{ roleLabels[role] }}
          </span>
        }
      }

      <div class="shell-header__user" #userTrigger (click)="op.toggle($event, userTrigger)">
        <app-jdenticon-avatar class="shell-header__avatar" [size]="30" [value]="avatarSeed()" />
        <span class="shell-header__user-name">{{
          auth.profile()?.display_name || auth.user()?.email
        }}</span>
      </div>

      <p-popover #op styleClass="user-menu-overlay" appendTo="body">
        <div class="user-menu">
          <div class="user-menu__info">
            <app-jdenticon-avatar class="user-menu__avatar" [size]="48" [value]="avatarSeed()" />
            <div class="user-menu__text">
              <span class="user-menu__name">{{ auth.profile()?.display_name || 'User' }}</span>
              <span class="user-menu__email">{{ auth.user()?.email }}</span>
            </div>
          </div>
          <hr class="user-menu__divider" />
          <div class="user-menu__items">
            <button class="user-menu__item" (click)="changePassword()">
              <i class="user-menu__item-icon pi pi-key"></i>
              \u4FEE\u6539\u5BC6\u78BC
            </button>
            <button class="user-menu__item user-menu__item--danger" (click)="signOut()">
              <i class="user-menu__item-icon pi pi-sign-out"></i>
              \u767B\u51FA
            </button>
          </div>
        </div>
      </p-popover>
    </div>
  </header>

  <div class="shell-layout__body" appInheritSize [widthVar]="'--shell-layout-body-width'" [heightVar]="'--shell-layout-body-height'">
    <div class="shell-container">
      <router-outlet name="sidebar" />
      <main class="shell-content" [class.shell-content--centered]="centered()">
        <router-outlet />
      </main>
    </div>
  </div>

  <router-outlet name="bottom-bar" />
</div>
`, styles: ["/* apps/web/src/app/shared/components/layout/shell-layout/shell-layout.component.scss */\n.shell-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  height: 56px;\n  padding: 0 var(--space-6);\n  background: var(--zinc-900);\n  color: var(--color-white);\n  z-index: 100;\n  transform: translateZ(0);\n  backface-visibility: hidden;\n}\n.shell-header__left {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n}\n.shell-header__logo-icon {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 32px;\n  height: 32px;\n  font-size: var(--text-md);\n  font-weight: var(--font-bold);\n  color: var(--zinc-900);\n  background:\n    linear-gradient(\n      135deg,\n      var(--color-white) 0%,\n      var(--zinc-200) 100%);\n  border-radius: var(--radius-md);\n}\n.shell-header__logo-text {\n  font-size: var(--text-lg);\n  font-weight: var(--font-bold);\n  letter-spacing: -0.02em;\n}\n.shell-header__right {\n  display: flex;\n  align-items: center;\n}\n.shell-header__role-badge {\n  display: inline-flex;\n  align-items: center;\n  gap: var(--space-2);\n  padding: var(--space-1) var(--space-3);\n  font-size: var(--text-xs);\n  font-weight: var(--font-bold);\n  border-radius: var(--radius-full);\n  text-transform: uppercase;\n  letter-spacing: 0.05em;\n  transition: all var(--transition-fast);\n  border: 1px solid var(--zinc-400);\n  color: var(--zinc-400);\n}\n.shell-header__role-badge--interactive {\n  cursor: pointer;\n  padding-right: var(--space-2);\n}\n.shell-header__role-badge--interactive:hover {\n  filter: brightness(0.95);\n  transform: translateY(-1px);\n}\n.shell-header__role-badge-icon {\n  font-size: 10px;\n}\n.shell-header__user {\n  position: relative;\n  display: flex;\n  align-items: center;\n  gap: var(--space-2);\n  margin-left: var(--space-4);\n  padding: var(--space-1) var(--space-3) var(--space-1) var(--space-2);\n  font-size: var(--text-sm);\n  color: var(--zinc-400);\n  border-radius: var(--radius-md);\n  cursor: pointer;\n  transition: all var(--transition-fast);\n}\n.shell-header__user:hover {\n  color: var(--color-white);\n  background: var(--zinc-800);\n}\n.shell-header__user:hover .shell-header__avatar {\n  border-color: var(--color-white);\n}\n.shell-header__avatar {\n  display: block;\n  border: 2px solid var(--zinc-400);\n  font-size: 0;\n  border-radius: 50%;\n  transition: border-color var(--transition-fast);\n}\n.user-menu {\n  display: flex;\n  flex-direction: column;\n  min-width: 240px;\n  background: var(--color-white);\n  overflow: hidden;\n  border-radius: var(--radius-lg);\n}\n.user-menu__info {\n  display: flex;\n  flex-direction: row;\n  align-items: center;\n  gap: var(--space-3);\n  padding: var(--space-4);\n  background: var(--color-white);\n}\n.user-menu__avatar {\n  background: var(--zinc-900);\n  border: 2px solid var(--zinc-300);\n  border-radius: 50%;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n.user-menu__text {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-1);\n}\n.user-menu__name {\n  font-size: var(--text-sm);\n  font-weight: var(--font-bold);\n  color: var(--zinc-900);\n}\n.user-menu__email {\n  font-size: var(--text-xs);\n  color: var(--zinc-500);\n}\n.user-menu__divider {\n  height: 1px;\n  margin: 0;\n  background: var(--zinc-200);\n  border: none;\n}\n.user-menu__items {\n  display: flex;\n  flex-direction: column;\n  padding: var(--space-1);\n}\n.user-menu__item {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  width: 100%;\n  padding: var(--space-3) var(--space-4);\n  font-size: var(--text-sm);\n  color: var(--zinc-600);\n  text-align: left;\n  background: transparent;\n  border: none;\n  border-radius: var(--radius-sm);\n  cursor: pointer;\n  transition: all var(--transition-fast);\n}\n.user-menu__item:hover {\n  background: var(--zinc-100);\n  color: var(--zinc-900);\n}\n.user-menu__item--danger {\n  color: var(--error-600);\n}\n.user-menu__item--danger:hover {\n  background: var(--error-100);\n  color: var(--error-600);\n}\n.user-menu__item-icon {\n  font-size: 16px;\n}\n.shell-layout {\n  display: flex;\n  flex-direction: column;\n  min-height: 100dvh;\n  background: var(--zinc-50);\n  height: var(--window-height);\n}\n.shell-layout__body {\n  display: flex;\n  flex-direction: column;\n  flex: 1;\n  overflow: hidden;\n}\n.shell-container {\n  display: flex;\n  flex: 1;\n  overflow: hidden;\n}\n.shell-content {\n  flex: 1;\n  padding: var(--space-8);\n  background: var(--zinc-50);\n  display: flex;\n  flex-direction: column;\n  overflow-y: auto;\n}\n.shell-content--centered {\n  align-items: center;\n  justify-content: center;\n}\n@media (max-width: 640px) {\n  .shell-header {\n    padding: 0 var(--space-4);\n  }\n  .shell-header__user-name {\n    max-width: 100px;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n    opacity: 0.8;\n  }\n  .shell-content {\n    padding: var(--space-4);\n    padding-bottom: calc(var(--space-4) + 64px + env(safe-area-inset-bottom, 0px));\n  }\n}\n/*# sourceMappingURL=shell-layout.component.css.map */\n"] }]
  }], null, { op: [{
    type: ViewChild,
    args: ["op"]
  }], centered: [{ type: Input, args: [{ isSignal: true, alias: "centered", required: false }] }], onResize: [{
    type: HostListener,
    args: ["window:resize"]
  }] });
})();
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(ShellLayoutComponent, { className: "ShellLayoutComponent", filePath: "apps/web/src/app/shared/components/layout/shell-layout/shell-layout.component.ts", lineNumber: 18 });
})();
export {
  ShellLayoutComponent
};
//# sourceMappingURL=chunk-H2YHUPMV.js.map
