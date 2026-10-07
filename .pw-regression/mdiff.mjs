// S3 用：殼換了，元素 key 以 main 為根重新對齊。node mdiff.mjs before after
import { readFileSync } from 'node:fs';
const [A, B] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const GEO = /^(width|height|left|right|top|bottom|min-|max-)/;
const rekey = (els) => {
  const out = {}, shell = {};
  for (const [k, v] of Object.entries(els)) {
    const i = k.indexOf('>main');
    if (i >= 0) { const rest = k.slice(i + 1).replace(/^main[^>]*/, 'main'); out[rest] = v; }
    else if (/^app-root/.test(k)) shell[k] = v; else out[k] = v; // overlay dumps 不在 main 底下
  }
  return out;
};
const r = { states: 0, missingStates: [], missingEl: 0, extraEl: 0, geo: 0, other: 0 };
const agg = new Map(), miss = new Map();
for (const s of Object.keys(A)) {
  if (!B[s]) { r.missingStates.push(s); continue; }
  r.states++;
  const a = rekey(A[s]), b = rekey(B[s]);
  for (const e of Object.keys(a)) {
    if (!b[e]) { r.missingEl++; miss.set(s.split(' | ')[0], (miss.get(s.split(' | ')[0]) ?? 0) + 1); continue; }
    for (const p of Object.keys(a[e])) if (a[e][p] !== b[e][p]) {
      const g = GEO.test(p); g ? r.geo++ : r.other++;
      if (g) continue;
      const k = `${e.split('>').slice(-2).join('>').replace(/:\d+/g, '')} | ${p} | ${a[e][p]} → ${b[e][p]}`;
      (agg.get(k) ?? agg.set(k, new Set()).get(k)).add(s.split(' | ')[0]);
    }
  }
  for (const e of Object.keys(b)) if (!a[e]) r.extraEl++;
}
r.missingByPage = Object.fromEntries(miss);
r.nonGeo = [...agg].map(([k, s]) => ({ k: k.slice(0, 230), pages: [...s] })).sort((x, y) => y.pages.length - x.pages.length);
console.log(JSON.stringify(r, null, 1));
