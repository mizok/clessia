import {
  Component,
  Input,
  input,
  setClassMetadata,
  ɵsetClassDebugInfo,
  ɵɵdefineComponent,
  ɵɵdomElementEnd,
  ɵɵdomElementStart,
  ɵɵtext
} from "./chunk-YGF3CXFR.js";

// apps/web/src/app/features/admin/pages/campuses/campuses.page.ts
var CampusesPage = class _CampusesPage {
  page = input.required(...ngDevMode ? [{ debugName: "page" }] : []);
  static \u0275fac = function CampusesPage_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _CampusesPage)();
  };
  static \u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _CampusesPage, selectors: [["app-campuses"]], inputs: { page: [1, "page"] }, decls: 2, vars: 0, template: function CampusesPage_Template(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275domElementStart(0, "p");
      \u0275\u0275text(1, "campuses works!");
      \u0275\u0275domElementEnd();
    }
  }, encapsulation: 2 });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(CampusesPage, [{
    type: Component,
    args: [{ selector: "app-campuses", imports: [], template: "<p>campuses works!</p>\n" }]
  }], null, { page: [{ type: Input, args: [{ isSignal: true, alias: "page", required: true }] }] });
})();
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(CampusesPage, { className: "CampusesPage", filePath: "apps/web/src/app/features/admin/pages/campuses/campuses.page.ts", lineNumber: 10 });
})();
export {
  CampusesPage
};
//# sourceMappingURL=chunk-ZB2Q5YWU.js.map
