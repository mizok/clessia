// 拋棄式：比對 capture.mjs 的兩份輸出。node diff.mjs before.json after.json > diff.json
import { readFileSync } from "node:fs";
const [a, b] = process.argv
  .slice(2)
  .map((f) => JSON.parse(readFileSync(f, "utf8")));
const rows = [];
const missing = [];
for (const state of Object.keys(a)) {
  if (!b[state]) {
    missing.push(state);
    continue;
  }
  for (const el of Object.keys(a[state])) {
    const x = a[state][el],
      y = b[state][el];
    if (!y) { (rows.missingEl ||= []).push(`${state} :: ${el}`); continue; }
    for (const p of Object.keys(x))
      if (x[p] !== y[p])
        rows.push({ state, el, prop: p, before: x[p], after: y[p] });
  }
}
// 依「元素末段＋屬性＋前後值」聚合：同一條規則翻轉通常在很多頁重複出現
const agg = new Map();
for (const r of rows) {
  const tail = r.el.split(">").slice(-2).join(">").replace(/:\d+/g, "");
  const k = `${tail} | ${r.prop} | ${r.before} → ${r.after}`;
  if (!agg.has(k)) agg.set(k, new Set());
  agg.get(k).add(r.state.split(" | ")[0]);
}
console.log(
  JSON.stringify(
    {
      states: Object.keys(a).length,
      missingInAfter: missing,
      changedDecls: rows.length,
    missingElements: (rows.missingEl || []).length,
    missingElementSample: (rows.missingEl || []).slice(0, 5),
      groups: [...agg.entries()]
        .map(([k, s]) => ({ k, pages: [...s] }))
        .sort((x, y) => y.pages.length - x.pages.length),
    },
    null,
    1,
  ),
);
