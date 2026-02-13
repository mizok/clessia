import {
  NavigationService
} from "./chunk-WNZVBO57.js";
import "./chunk-6PJ7S3AC.js";
import "./chunk-IDX5LEWH.js";
import "./chunk-WSLHL2JA.js";
import {
  RouterLink,
  RouterLinkActive
} from "./chunk-NFVC465N.js";
import {
  Component,
  Directive,
  Input,
  computed,
  inject,
  input,
  setClassMetadata,
  signal,
  ɵsetClassDebugInfo,
  ɵɵadvance,
  ɵɵclassMap,
  ɵɵclassProp,
  ɵɵconditional,
  ɵɵconditionalCreate,
  ɵɵdefineComponent,
  ɵɵdefineDirective,
  ɵɵdomElementEnd,
  ɵɵdomElementStart,
  ɵɵelement,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵgetCurrentView,
  ɵɵinterpolate1,
  ɵɵlistener,
  ɵɵnextContext,
  ɵɵprojection,
  ɵɵprojectionDef,
  ɵɵproperty,
  ɵɵreference,
  ɵɵrepeater,
  ɵɵrepeaterCreate,
  ɵɵresetView,
  ɵɵrestoreView,
  ɵɵtext,
  ɵɵtextInterpolate
} from "./chunk-YGF3CXFR.js";

// apps/web/src/app/shared/components/collapsible/collapsible.component.ts
var _c0 = ["*"];
var CollapsibleComponent = class _CollapsibleComponent {
  collapsed = input(true, ...ngDevMode ? [{ debugName: "collapsed" }] : []);
  static \u0275fac = function CollapsibleComponent_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _CollapsibleComponent)();
  };
  static \u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _CollapsibleComponent, selectors: [["app-collapsible"]], inputs: { collapsed: [1, "collapsed"] }, ngContentSelectors: _c0, decls: 3, vars: 2, consts: [[1, "collapsible"], [1, "collapsible__inner"]], template: function CollapsibleComponent_Template(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275projectionDef();
      \u0275\u0275domElementStart(0, "div", 0)(1, "div", 1);
      \u0275\u0275projection(2);
      \u0275\u0275domElementEnd()();
    }
    if (rf & 2) {
      \u0275\u0275classProp("collapsible--collapsed", ctx.collapsed());
    }
  }, styles: ["\n\n.collapsible[_ngcontent-%COMP%] {\n  display: grid;\n  grid-template-rows: 1fr;\n  transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1);\n}\n.collapsible--collapsed[_ngcontent-%COMP%] {\n  grid-template-rows: 0fr;\n}\n.collapsible--collapsed[_ngcontent-%COMP%]   .collapsible__inner[_ngcontent-%COMP%] {\n  opacity: 0;\n  transform: translateY(-8px);\n  margin-top: 0;\n  margin-bottom: 0;\n}\n.collapsible__inner[_ngcontent-%COMP%] {\n  overflow: hidden;\n  min-height: 0;\n  opacity: 1;\n  transform: translateY(0);\n  transition:\n    opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1),\n    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),\n    margin 0.3s cubic-bezier(0.4, 0, 0.2, 1);\n}\n/*# sourceMappingURL=collapsible.component.css.map */"] });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(CollapsibleComponent, [{
    type: Component,
    args: [{ selector: "app-collapsible", imports: [], template: '<div \n  class="collapsible"\n  [class.collapsible--collapsed]="collapsed()"\n>\n  <div class="collapsible__inner">\n    <ng-content />\n  </div>\n</div>\n', styles: ["/* apps/web/src/app/shared/components/collapsible/collapsible.component.scss */\n.collapsible {\n  display: grid;\n  grid-template-rows: 1fr;\n  transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1);\n}\n.collapsible--collapsed {\n  grid-template-rows: 0fr;\n}\n.collapsible--collapsed .collapsible__inner {\n  opacity: 0;\n  transform: translateY(-8px);\n  margin-top: 0;\n  margin-bottom: 0;\n}\n.collapsible__inner {\n  overflow: hidden;\n  min-height: 0;\n  opacity: 1;\n  transform: translateY(0);\n  transition:\n    opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1),\n    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),\n    margin 0.3s cubic-bezier(0.4, 0, 0.2, 1);\n}\n/*# sourceMappingURL=collapsible.component.css.map */\n"] }]
  }], null, { collapsed: [{ type: Input, args: [{ isSignal: true, alias: "collapsed", required: false }] }] });
})();
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(CollapsibleComponent, { className: "CollapsibleComponent", filePath: "apps/web/src/app/shared/components/collapsible/collapsible.component.ts", lineNumber: 9 });
})();

// apps/web/src/app/shared/directives/accordion.directive.ts
var AccordionDirective = class _AccordionDirective {
  /** Whether to allow multiple items to be open at once. Default: false (accordion behavior) */
  multi = input(false, ...ngDevMode ? [{ debugName: "multi" }] : []);
  // Store open item IDs
  openItems = signal(/* @__PURE__ */ new Set(), ...ngDevMode ? [{ debugName: "openItems" }] : []);
  // Helper to check if item is open
  isOpen(id) {
    return this.openItems().has(id);
  }
  toggle(id) {
    this.openItems.update((current) => {
      const isCurrentlyOpen = current.has(id);
      if (this.multi()) {
        const newSet = new Set(current);
        if (isCurrentlyOpen) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
        return newSet;
      } else {
        if (isCurrentlyOpen) {
          return /* @__PURE__ */ new Set();
        } else {
          return /* @__PURE__ */ new Set([id]);
        }
      }
    });
  }
  expand(id) {
    this.openItems.update((current) => {
      if (this.multi()) {
        const newSet = new Set(current);
        newSet.add(id);
        return newSet;
      } else {
        return /* @__PURE__ */ new Set([id]);
      }
    });
  }
  collapseAll() {
    this.openItems.set(/* @__PURE__ */ new Set());
  }
  static \u0275fac = function AccordionDirective_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _AccordionDirective)();
  };
  static \u0275dir = /* @__PURE__ */ \u0275\u0275defineDirective({ type: _AccordionDirective, selectors: [["", "appAccordion", ""]], inputs: { multi: [1, "multi"] }, exportAs: ["appAccordion"] });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(AccordionDirective, [{
    type: Directive,
    args: [{
      selector: "[appAccordion]",
      standalone: true,
      exportAs: "appAccordion"
    }]
  }], null, { multi: [{ type: Input, args: [{ isSignal: true, alias: "multi", required: false }] }] });
})();

// apps/web/src/app/shared/components/sidebar/sidebar.component.ts
var _forTrack0 = ($index, $item) => $item.label;
var _forTrack1 = ($index, $item) => $item.route;
function SidebarComponent_For_4_Conditional_0_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "div", 6);
    \u0275\u0275listener("click", function SidebarComponent_For_4_Conditional_0_Template_div_click_0_listener($event) {
      \u0275\u0275restoreView(_r1);
      const group_r2 = \u0275\u0275nextContext().$implicit;
      const ctx_r2 = \u0275\u0275nextContext();
      const accordion_r4 = \u0275\u0275reference(2);
      accordion_r4.toggle(group_r2.label);
      return \u0275\u0275resetView(ctx_r2.handleScroll($event));
    });
    \u0275\u0275elementStart(1, "span", 7);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275element(3, "i", 8);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const group_r2 = \u0275\u0275nextContext().$implicit;
    \u0275\u0275nextContext();
    const accordion_r4 = \u0275\u0275reference(2);
    \u0275\u0275classProp("sidebar__group-header--collapsed", !accordion_r4.isOpen(group_r2.label));
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(group_r2.label);
  }
}
function SidebarComponent_For_4_Conditional_1_For_2_Conditional_4_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span", 12);
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const item_r6 = \u0275\u0275nextContext().$implicit;
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(item_r6.badge);
  }
}
function SidebarComponent_For_4_Conditional_1_For_2_Template(rf, ctx) {
  if (rf & 1) {
    const _r5 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "a", 10);
    \u0275\u0275listener("click", function SidebarComponent_For_4_Conditional_1_For_2_Template_a_click_0_listener($event) {
      \u0275\u0275restoreView(_r5);
      const ctx_r2 = \u0275\u0275nextContext(3);
      return \u0275\u0275resetView(ctx_r2.handleScroll($event));
    });
    \u0275\u0275element(1, "i");
    \u0275\u0275elementStart(2, "span", 11);
    \u0275\u0275text(3);
    \u0275\u0275elementEnd();
    \u0275\u0275conditionalCreate(4, SidebarComponent_For_4_Conditional_1_For_2_Conditional_4_Template, 2, 1, "span", 12);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const item_r6 = ctx.$implicit;
    \u0275\u0275property("routerLink", item_r6.route);
    \u0275\u0275advance();
    \u0275\u0275classMap(\u0275\u0275interpolate1("pi ", item_r6.icon, " sidebar__icon"));
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(item_r6.label);
    \u0275\u0275advance();
    \u0275\u0275conditional(item_r6.badge ? 4 : -1);
  }
}
function SidebarComponent_For_4_Conditional_1_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 4);
    \u0275\u0275repeaterCreate(1, SidebarComponent_For_4_Conditional_1_For_2_Template, 5, 6, "a", 9, _forTrack1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const group_r2 = \u0275\u0275nextContext().$implicit;
    \u0275\u0275advance();
    \u0275\u0275repeater(group_r2.items);
  }
}
function SidebarComponent_For_4_Conditional_2_For_3_Conditional_4_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span", 12);
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const item_r8 = \u0275\u0275nextContext().$implicit;
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(item_r8.badge);
  }
}
function SidebarComponent_For_4_Conditional_2_For_3_Template(rf, ctx) {
  if (rf & 1) {
    const _r7 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "a", 14);
    \u0275\u0275listener("click", function SidebarComponent_For_4_Conditional_2_For_3_Template_a_click_0_listener($event) {
      \u0275\u0275restoreView(_r7);
      const ctx_r2 = \u0275\u0275nextContext(3);
      return \u0275\u0275resetView(ctx_r2.handleScroll($event));
    });
    \u0275\u0275element(1, "i");
    \u0275\u0275elementStart(2, "span", 11);
    \u0275\u0275text(3);
    \u0275\u0275elementEnd();
    \u0275\u0275conditionalCreate(4, SidebarComponent_For_4_Conditional_2_For_3_Conditional_4_Template, 2, 1, "span", 12);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const item_r8 = ctx.$implicit;
    \u0275\u0275property("routerLink", item_r8.route);
    \u0275\u0275advance();
    \u0275\u0275classMap(\u0275\u0275interpolate1("pi ", item_r8.icon, " sidebar__icon"));
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(item_r8.label);
    \u0275\u0275advance();
    \u0275\u0275conditional(item_r8.badge ? 4 : -1);
  }
}
function SidebarComponent_For_4_Conditional_2_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "app-collapsible", 5)(1, "div", 4);
    \u0275\u0275repeaterCreate(2, SidebarComponent_For_4_Conditional_2_For_3_Template, 5, 6, "a", 13, _forTrack1);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const group_r2 = \u0275\u0275nextContext().$implicit;
    \u0275\u0275nextContext();
    const accordion_r4 = \u0275\u0275reference(2);
    \u0275\u0275property("collapsed", !accordion_r4.isOpen(group_r2.label));
    \u0275\u0275advance(2);
    \u0275\u0275repeater(group_r2.items);
  }
}
function SidebarComponent_For_4_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275conditionalCreate(0, SidebarComponent_For_4_Conditional_0_Template, 4, 3, "div", 3);
    \u0275\u0275conditionalCreate(1, SidebarComponent_For_4_Conditional_1_Template, 3, 0, "div", 4)(2, SidebarComponent_For_4_Conditional_2_Template, 4, 1, "app-collapsible", 5);
  }
  if (rf & 2) {
    const group_r2 = ctx.$implicit;
    \u0275\u0275conditional(group_r2.label ? 0 : -1);
    \u0275\u0275advance();
    \u0275\u0275conditional(!group_r2.label ? 1 : 2);
  }
}
var SidebarComponent = class _SidebarComponent {
  nav = inject(NavigationService);
  groupedNav = computed(() => {
    const items = this.nav.navItems();
    if (items.length === 0)
      return [];
    const groupedItems = items.filter((item) => !!item.group);
    const ungroupedItems = items.filter((item) => !item.group);
    const sortedItems = [...ungroupedItems, ...groupedItems];
    let currentGroupLabel = sortedItems[0].group;
    let currentGroupItems = [sortedItems[0]];
    const groups = [];
    for (let i = 1; i < sortedItems.length; i++) {
      const item = sortedItems[i];
      if (item.group === currentGroupLabel) {
        currentGroupItems.push(item);
      } else {
        groups.push({
          label: currentGroupLabel,
          items: currentGroupItems
        });
        currentGroupLabel = item.group;
        currentGroupItems = [item];
      }
    }
    groups.push({
      label: currentGroupLabel,
      items: currentGroupItems
    });
    return groups;
  }, ...ngDevMode ? [{ debugName: "groupedNav" }] : []);
  handleScroll(event) {
    const element = event.currentTarget;
    requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    });
  }
  static \u0275fac = function SidebarComponent_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _SidebarComponent)();
  };
  static \u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _SidebarComponent, selectors: [["app-sidebar"]], hostAttrs: [1, "sidebar"], decls: 5, vars: 0, consts: [["accordion", "appAccordion"], [1, "sidebar", "u-full-height", "u-scrollable"], ["appAccordion", "", 1, "sidebar__nav"], [1, "sidebar__group-header", 3, "sidebar__group-header--collapsed"], [1, "sidebar__group-items"], [3, "collapsed"], [1, "sidebar__group-header", 3, "click"], [1, "sidebar__group-title"], [1, "pi", "pi-chevron-down", "sidebar__group-icon"], ["routerLinkActive", "sidebar__item--active", 1, "sidebar__item", 3, "routerLink"], ["routerLinkActive", "sidebar__item--active", 1, "sidebar__item", 3, "click", "routerLink"], [1, "sidebar__label"], [1, "sidebar__badge"], ["routerLinkActive", "sidebar__item--active", 1, "sidebar__item", "sidebar__item--indented", 3, "routerLink"], ["routerLinkActive", "sidebar__item--active", 1, "sidebar__item", "sidebar__item--indented", 3, "click", "routerLink"]], template: function SidebarComponent_Template(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275elementStart(0, "aside", 1)(1, "nav", 2, 0);
      \u0275\u0275repeaterCreate(3, SidebarComponent_For_4_Template, 3, 2, null, null, _forTrack0);
      \u0275\u0275elementEnd()();
    }
    if (rf & 2) {
      \u0275\u0275advance(3);
      \u0275\u0275repeater(ctx.groupedNav());
    }
  }, dependencies: [RouterLink, RouterLinkActive, CollapsibleComponent, AccordionDirective], styles: ["\n\n.sidebar[_ngcontent-%COMP%] {\n  width: 240px;\n  min-width: 240px;\n  background: #fff;\n  border-right: 1px solid var(--zinc-200);\n  display: flex;\n  flex-direction: column;\n  overflow: auto;\n}\n.sidebar__nav[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  padding: var(--space-3) var(--space-2);\n  gap: 2px;\n}\n.sidebar__group-header[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: var(--space-2) var(--space-3);\n  margin-top: var(--space-2);\n  color: var(--zinc-500);\n  cursor: pointer;\n  border-radius: var(--radius-md);\n  transition: background var(--transition-fast);\n}\n.sidebar__group-header[_ngcontent-%COMP%]:hover {\n  background: var(--zinc-50);\n  color: var(--zinc-800);\n}\n.sidebar__group-header--collapsed[_ngcontent-%COMP%]   .sidebar__group-icon[_ngcontent-%COMP%] {\n  transform: rotate(-90deg);\n}\n.sidebar__group-title[_ngcontent-%COMP%] {\n  font-size: var(--text-xs);\n  font-weight: var(--font-bold);\n  text-transform: uppercase;\n  letter-spacing: 0.06em;\n}\n.sidebar__group-icon[_ngcontent-%COMP%] {\n  font-size: 10px;\n  transition: transform var(--transition-fast);\n}\n.sidebar__group-items[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  min-height: 0;\n}\n.sidebar__item--indented[_ngcontent-%COMP%] {\n  margin-left: var(--space-3);\n  padding-left: var(--space-2);\n  border-left: 2px solid var(--zinc-100);\n}\n.sidebar__item[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  padding: var(--space-2) var(--space-3);\n  border-radius: var(--radius-md);\n  color: var(--zinc-500);\n  text-decoration: none;\n  font-size: var(--text-sm);\n  font-weight: var(--font-medium);\n  transition: background var(--transition-fast), color var(--transition-fast);\n}\n.sidebar__item[_ngcontent-%COMP%]:hover {\n  background: var(--zinc-100);\n  color: var(--zinc-900);\n}\n.sidebar__item--active[_ngcontent-%COMP%] {\n  background: var(--accent-50);\n  color: var(--accent-600);\n}\n.sidebar__item--active[_ngcontent-%COMP%]   .sidebar__icon[_ngcontent-%COMP%] {\n  color: var(--accent-500);\n}\n.sidebar__icon[_ngcontent-%COMP%] {\n  font-size: 17px;\n  width: 20px;\n  text-align: center;\n  flex-shrink: 0;\n}\n.sidebar__label[_ngcontent-%COMP%] {\n  flex: 1;\n}\n.sidebar__badge[_ngcontent-%COMP%] {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  min-width: 18px;\n  height: 18px;\n  padding: 0 5px;\n  font-size: 10px;\n  font-weight: var(--font-bold);\n  color: #fff;\n  background: var(--accent-500);\n  border-radius: var(--radius-full);\n}\n@media (max-width: 640px) {\n  .sidebar[_ngcontent-%COMP%] {\n    display: none;\n  }\n}\n/*# sourceMappingURL=sidebar.component.css.map */"] });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(SidebarComponent, [{
    type: Component,
    args: [{ selector: "app-sidebar", standalone: true, imports: [RouterLink, RouterLinkActive, CollapsibleComponent, AccordionDirective], host: {
      class: "sidebar"
    }, template: '<aside class="sidebar u-full-height u-scrollable">\n  <nav class="sidebar__nav" appAccordion #accordion="appAccordion">\n    @for (group of groupedNav(); track group.label) {\n      @if (group.label) {\n        <div\n          class="sidebar__group-header"\n          [class.sidebar__group-header--collapsed]="!accordion.isOpen(group.label)"\n          (click)="accordion.toggle(group.label); handleScroll($event)"\n        >\n          <span class="sidebar__group-title">{{ group.label }}</span>\n          <i class="pi pi-chevron-down sidebar__group-icon"></i>\n        </div>\n      }\n\n      @if (!group.label) {\n        <div class="sidebar__group-items">\n          @for (item of group.items; track item.route) {\n            <a\n              class="sidebar__item"\n              [routerLink]="item.route"\n              routerLinkActive="sidebar__item--active"\n              (click)="handleScroll($event)"\n            >\n              <i class="pi {{ item.icon }} sidebar__icon"></i>\n              <span class="sidebar__label">{{ item.label }}</span>\n              @if (item.badge) {\n                <span class="sidebar__badge">{{ item.badge }}</span>\n              }\n            </a>\n          }\n        </div>\n      } @else {\n        <app-collapsible [collapsed]="!accordion.isOpen(group.label)">\n          <div class="sidebar__group-items">\n            @for (item of group.items; track item.route) {\n              <a\n                class="sidebar__item sidebar__item--indented"\n                [routerLink]="item.route"\n                routerLinkActive="sidebar__item--active"\n                (click)="handleScroll($event)"\n              >\n                <i class="pi {{ item.icon }} sidebar__icon"></i>\n                <span class="sidebar__label">{{ item.label }}</span>\n                @if (item.badge) {\n                  <span class="sidebar__badge">{{ item.badge }}</span>\n                }\n              </a>\n            }\n          </div>\n        </app-collapsible>\n      }\n    }\n  </nav>\n</aside>\n', styles: ["/* apps/web/src/app/shared/components/sidebar/sidebar.component.scss */\n.sidebar {\n  width: 240px;\n  min-width: 240px;\n  background: #fff;\n  border-right: 1px solid var(--zinc-200);\n  display: flex;\n  flex-direction: column;\n  overflow: auto;\n}\n.sidebar__nav {\n  display: flex;\n  flex-direction: column;\n  padding: var(--space-3) var(--space-2);\n  gap: 2px;\n}\n.sidebar__group-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: var(--space-2) var(--space-3);\n  margin-top: var(--space-2);\n  color: var(--zinc-500);\n  cursor: pointer;\n  border-radius: var(--radius-md);\n  transition: background var(--transition-fast);\n}\n.sidebar__group-header:hover {\n  background: var(--zinc-50);\n  color: var(--zinc-800);\n}\n.sidebar__group-header--collapsed .sidebar__group-icon {\n  transform: rotate(-90deg);\n}\n.sidebar__group-title {\n  font-size: var(--text-xs);\n  font-weight: var(--font-bold);\n  text-transform: uppercase;\n  letter-spacing: 0.06em;\n}\n.sidebar__group-icon {\n  font-size: 10px;\n  transition: transform var(--transition-fast);\n}\n.sidebar__group-items {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  min-height: 0;\n}\n.sidebar__item--indented {\n  margin-left: var(--space-3);\n  padding-left: var(--space-2);\n  border-left: 2px solid var(--zinc-100);\n}\n.sidebar__item {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);\n  padding: var(--space-2) var(--space-3);\n  border-radius: var(--radius-md);\n  color: var(--zinc-500);\n  text-decoration: none;\n  font-size: var(--text-sm);\n  font-weight: var(--font-medium);\n  transition: background var(--transition-fast), color var(--transition-fast);\n}\n.sidebar__item:hover {\n  background: var(--zinc-100);\n  color: var(--zinc-900);\n}\n.sidebar__item--active {\n  background: var(--accent-50);\n  color: var(--accent-600);\n}\n.sidebar__item--active .sidebar__icon {\n  color: var(--accent-500);\n}\n.sidebar__icon {\n  font-size: 17px;\n  width: 20px;\n  text-align: center;\n  flex-shrink: 0;\n}\n.sidebar__label {\n  flex: 1;\n}\n.sidebar__badge {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  min-width: 18px;\n  height: 18px;\n  padding: 0 5px;\n  font-size: 10px;\n  font-weight: var(--font-bold);\n  color: #fff;\n  background: var(--accent-500);\n  border-radius: var(--radius-full);\n}\n@media (max-width: 640px) {\n  .sidebar {\n    display: none;\n  }\n}\n/*# sourceMappingURL=sidebar.component.css.map */\n"] }]
  }], null, null);
})();
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(SidebarComponent, { className: "SidebarComponent", filePath: "apps/web/src/app/shared/components/sidebar/sidebar.component.ts", lineNumber: 22 });
})();
export {
  SidebarComponent
};
//# sourceMappingURL=chunk-GRI24HYC.js.map
