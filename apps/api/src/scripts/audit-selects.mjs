#!/usr/bin/env node
/**
 * 把每一支 `.select()` 拿去問**真的資料庫**，而不是 grep 欄位名。
 *
 * ```sh
 * SERVICE_KEY=$(npx supabase status -o json | jq -r .SECRET_KEY) \
 *   node apps/api/src/scripts/audit-selects.mjs apps/api/src
 * ```
 *
 * ## 為什麼不用 grep
 *
 * 欄位名常常是常見英文字（`school` / `status` / `name`），grep 會給你幾百筆無法判斷的
 * 命中。**直接把 select 送給 PostgREST，跑不動的它會告訴你為什麼** ——
 * 而且它同時涵蓋三種不同的錯：
 *
 * - `42703` 欄位不存在（被 DROP 或改名，#528 的 `students.school`）
 * - `PGRST200` 找不到關聯（embed 寫錯表名）
 * - `PGRST108` 對沒 embed 的資源下條件（**這支工具看不到，見下方盲區**）
 *
 * ## 判讀
 *
 * - **真訊號**：`42703` / `PGRST200` —— 那支 select 對現在的 schema 跑不動
 * - **抽取器看不懂**：`PGRST100`（送出去的字串本身是壞的）＝ 我沒把 TS 的字串拼出來，
 *   **不是路由的錯**，要人工看
 *
 * ## 盲區（每一條都實際踩過）
 *
 * 1. **只看 select，不看 filter。** #528 的 `/api/me/attendance` 是
 *    `.gte('events.event_date', …)` 對沒 embed 的資源下條件（`PGRST108`），
 *    **而它的 select 本身完全合法** —— 這支工具抓不到那一類
 * 2. **只認得靜態字串。** 條件式組出來的 select、跨函式傳進來的，都看不到
 * 3. **`.from(table, idColumn)` 兩個參數的寫法**（`childDb`）—— 第一版的 regex 要求
 *    字串後面直接是 `)`，於是**漏掉了它自己要抓的那個 bug**。已修，但同一族的
 *    下一個變形還是會漏
 * 4. **資料庫必須是最新的。** 落後的本機 DB 會讓「欄位不存在」大量假陽性，
 *    而錯誤訊息跟真的一模一樣（#528 的 grades）。跑之前先
 *    `npx supabase migration list --local` 確認沒有未套用的
 *
 * **「這支工具沒查到」不等於「查過沒問題」。**
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] ?? 'apps/api/src';
const REST = process.env.REST_URL ?? 'http://127.0.0.1:54321/rest/v1';
const KEY = process.env.SERVICE_KEY ?? '';

const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const f = join(d, n);
    return statSync(f).isDirectory()
      ? walk(f)
      : f.endsWith('.ts') && !f.endsWith('.spec.ts')
        ? [f]
        : [];
  });
const files = walk(ROOT);

// 1) 所有 SELECT 常數（含用別的常數插值組成的）
const consts = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:export )?const (\w*SELECT\w*)\s*=\s*([`'"])([\s\S]*?)\2\s*;/g)) {
    consts.set(m[1], m[3]);
  }
  // 用 + 串接的常數（INVOICE_SELECT 是這種）
  for (const m of src.matchAll(
    /(?:export )?const (\w*SELECT\w*)\s*=\s*((?:\s*['"][^'"]*['"]\s*\+?)+)\s*;/g,
  )) {
    if (!consts.has(m[1]))
      consts.set(m[1], [...m[2].matchAll(/['"]([^'"]*)['"]/g)].map((x) => x[1]).join(''));
  }
}
const resolve = (s, depth = 0) =>
  depth > 4
    ? s
    : s.replace(/\$\{(\w+)\}/g, (all, name) =>
        consts.has(name) ? resolve(consts.get(name), depth + 1) : all,
      );

// 2) .from('table') 之後**同一條鏈**上的 .select(...)（跨行、括號配對）
const pairs = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\.from\(\s*['"](\w+)['"]\s*[,)]/g)) {
    const table = m[1];
    // **截到下一個 .from( 為止** —— 連續幾個 .from() 排在一起時，
    // 不截的話會把下一條鏈的 select 配到這一條上（實測製造大量假命中）
    let after = src.slice(m.index + m[0].length, m.index + 4000);
    const nextFrom = after.search(/\.from\(\s*['\"]/);
    if (nextFrom >= 0) after = after.slice(0, nextFrom);
    const sel = after.match(/\.select\(\s*(?:([`'"])([\s\S]*?)\1|(\w*SELECT\w*))/);
    if (!sel) continue;
    let cols = sel[2] ?? consts.get(sel[3]);
    if (!cols) continue;
    cols = resolve(cols);
    const line = src.slice(0, m.index).split('\n').length;
    pairs.push({ file: f, line, table, cols, via: sel[3] ?? 'inline' });
  }
}

// 3) 問資料庫
const seen = new Set();
const real = [],
  extractor = [];
for (const p of pairs) {
  const cols = p.cols.replace(/\s+/g, '');
  if (!cols || cols.includes('${')) {
    extractor.push({ ...p, why: '插值解不開' });
    continue;
  }
  const key = `${p.table}|${cols}`;
  if (seen.has(key)) continue;
  seen.add(key);

  const res = await fetch(`${REST}/${p.table}?select=${encodeURIComponent(cols)}&limit=0`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (res.ok) continue;
  const body = await res.json().catch(() => ({}));
  const rec = {
    ...p,
    code: body.code ?? String(res.status),
    message: body.message,
    hint: body.hint,
  };
  // PGRST100 = 送出去的字串本身是壞的 → 幾乎一定是抽取器的錯，不是路由的錯
  (rec.code === 'PGRST100' ? extractor : real).push(rec);
}

console.log(`## 真訊號（${real.length}）`);
for (const r of real)
  console.log(
    `\n✖ ${r.file}:${r.line} (${r.table}, via ${r.via})\n  ${r.code}: ${r.message}${r.hint ? `\n  hint: ${r.hint}` : ''}`,
  );
console.log(`\n## 抽取器看不懂、要人工看（${extractor.length}）`);
for (const r of extractor) console.log(`  ${r.file}:${r.line} (${r.table}) —— ${r.why ?? r.code}`);
console.log(`\n檢查了 ${seen.size} 組不重複的 (table, select)。`);
