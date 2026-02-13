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

// apps/web/src/app/features/admin/pages/leave/leave.page.ts
var LeavePage = class _LeavePage {
  page = input.required(...ngDevMode ? [{ debugName: "page" }] : []);
  static \u0275fac = function LeavePage_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _LeavePage)();
  };
  static \u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _LeavePage, selectors: [["app-leave"]], inputs: { page: [1, "page"] }, decls: 2, vars: 0, template: function LeavePage_Template(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275domElementStart(0, "p");
      \u0275\u0275text(1, "leave works!");
      \u0275\u0275domElementEnd();
    }
  }, encapsulation: 2 });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(LeavePage, [{
    type: Component,
    args: [{ selector: "app-leave", imports: [], template: "<p>leave works!</p>\n" }]
  }], null, { page: [{ type: Input, args: [{ isSignal: true, alias: "page", required: true }] }] });
})();
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(LeavePage, { className: "LeavePage", filePath: "apps/web/src/app/features/admin/pages/leave/leave.page.ts", lineNumber: 10 });
})();
export {
  LeavePage
};
//# sourceMappingURL=chunk-AM3GLVMY.js.map
