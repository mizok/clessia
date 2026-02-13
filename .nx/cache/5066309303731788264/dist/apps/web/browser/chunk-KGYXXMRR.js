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

// apps/web/src/app/features/teacher/pages/schedule/schedule.page.ts
var SchedulePage = class _SchedulePage {
  page = input.required(...ngDevMode ? [{ debugName: "page" }] : []);
  static \u0275fac = function SchedulePage_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _SchedulePage)();
  };
  static \u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _SchedulePage, selectors: [["app-schedule"]], inputs: { page: [1, "page"] }, decls: 2, vars: 0, template: function SchedulePage_Template(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275domElementStart(0, "p");
      \u0275\u0275text(1, "schedule works!");
      \u0275\u0275domElementEnd();
    }
  }, encapsulation: 2 });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(SchedulePage, [{
    type: Component,
    args: [{ selector: "app-schedule", imports: [], template: "<p>schedule works!</p>\n" }]
  }], null, { page: [{ type: Input, args: [{ isSignal: true, alias: "page", required: true }] }] });
})();
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(SchedulePage, { className: "SchedulePage", filePath: "apps/web/src/app/features/teacher/pages/schedule/schedule.page.ts", lineNumber: 10 });
})();
export {
  SchedulePage
};
//# sourceMappingURL=chunk-KGYXXMRR.js.map
