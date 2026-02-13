import {
  Component,
  Input,
  input,
  setClassMetadata,
  ɵsetClassDebugInfo,
  ɵɵadvance,
  ɵɵdefineComponent,
  ɵɵdomElementEnd,
  ɵɵdomElementStart,
  ɵɵtext,
  ɵɵtextInterpolate
} from "./chunk-YGF3CXFR.js";

// apps/web/src/app/features/admin/pages/grades/grades.component.ts
var GradesComponent = class _GradesComponent {
  page = input.required(...ngDevMode ? [{ debugName: "page" }] : []);
  static \u0275fac = function GradesComponent_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || _GradesComponent)();
  };
  static \u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _GradesComponent, selectors: [["app-grades"]], inputs: { page: [1, "page"] }, decls: 5, vars: 1, consts: [[1, "p-4"], [1, "text-2xl", "font-bold", "mb-4"], [1, "text-zinc-500"]], template: function GradesComponent_Template(rf, ctx) {
    if (rf & 1) {
      \u0275\u0275domElementStart(0, "div", 0)(1, "h2", 1);
      \u0275\u0275text(2);
      \u0275\u0275domElementEnd();
      \u0275\u0275domElementStart(3, "p", 2);
      \u0275\u0275text(4, "Grades management content coming soon...");
      \u0275\u0275domElementEnd()();
    }
    if (rf & 2) {
      \u0275\u0275advance(2);
      \u0275\u0275textInterpolate(ctx.page().label);
    }
  }, encapsulation: 2 });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(GradesComponent, [{
    type: Component,
    args: [{ selector: "app-grades", standalone: true, imports: [], template: `
    <div class="p-4">
      <h2 class="text-2xl font-bold mb-4">{{ page().label }}</h2>
      <p class="text-zinc-500">Grades management content coming soon...</p>
    </div>
  ` }]
  }], null, { page: [{ type: Input, args: [{ isSignal: true, alias: "page", required: true }] }] });
})();
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(GradesComponent, { className: "GradesComponent", filePath: "apps/web/src/app/features/admin/pages/grades/grades.component.ts", lineNumber: 16 });
})();
export {
  GradesComponent
};
//# sourceMappingURL=chunk-FNVBHIMZ.js.map
