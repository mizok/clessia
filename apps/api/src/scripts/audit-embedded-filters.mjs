#!/usr/bin/env node
/**
 * 找「對 embed 的欄位下條件，但那張表不在 `select` 裡」—— PostgREST 的 `PGRST108`。
 *
 * ```sh
 * node apps/api/src/scripts/audit-embedded-filters.mjs apps/api/src
 * ```
 *
 * ## 它補的是 `audit-selects.mjs` 的盲區
 *
 * 那一支把 `select` 送去問資料庫，**但 #528 的 `/api/me/attendance` 是 filter 出的問題**：
 *
 * ```ts
 * .select('id', { count: 'exact', head: true })     // select 完全合法
 * .gte('events.event_date', monthStart())           // ← events 不在 select 裡
 * ```
 *
 * PostgREST 直接回 400 `PGRST108`，**那支端點對每一個家長、每一次呼叫都 500，
 * 而它活了四個半月**（因為 seed 沒有 parent 角色，沒有人打得開）。
 *
 * ## 這支不需要資料庫
 *
 * 純靜態：**條件的欄位帶點（`表.欄位`）時，那個表必須出現在同一條鏈的 `select` 裡。**
 * 不用連線、不怕本機 DB 落後 —— 而落後的 DB 正是另一支工具最大的假陽性來源。
 *
 * ## 盲區
 *
 * 1. **只認得靜態字串**：條件式組出來的、跨函式傳進來的看不到
 * 2. **鏈式範圍是行數估的**：從 `.from(` 到下一個 `.from(` 為止。同一個 handler 裡
 *    多支查詢交錯時可能配錯（`audit-selects.mjs` 踩過，那次製造了 31 筆假命中）
 * 3. **不驗欄位本身存不存在** —— 那是 `audit-selects.mjs` 的事
 * 4. **`!inner` 的有無它不管**：少了 `!inner` 條件會**靜靜地什麼都不篩**（安靜的那半），
 *    這支只抓「連 embed 都沒有」的大聲那半。兩半的說明見
 *    `kb/wiki/lessons/silent-tool-failures.md`
 *
 * **「這支工具沒查到」不等於「查過沒問題」。**
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] ?? 'apps/api/src';

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

// lib 裡的 SELECT 常數（跨檔共用的那些，只看呼叫端的字面量會漏掉）
const consts = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:export )?const (\w*SELECT\w*)\s*=\s*([`'"])([\s\S]*?)\2\s*;/g)) {
    consts.set(m[1], m[3]);
  }
  for (const m of src.matchAll(
    /(?:export )?const (\w*SELECT\w*)\s*=\s*((?:\s*['"][^'"]*['"]\s*\+?)+)\s*;/g,
  )) {
    if (!consts.has(m[1])) {
      consts.set(m[1], [...m[2].matchAll(/['"]([^'"]*)['"]/g)].map((x) => x[1]).join(''));
    }
  }
}
const resolve = (s, depth = 0) =>
  depth > 4
    ? s
    : s.replace(/\$\{(\w+)\}/g, (all, name) =>
        consts.has(name) ? resolve(consts.get(name), depth + 1) : all,
      );

const findings = [];

for (const f of files) {
  const src = readFileSync(f, 'utf8');

  for (const m of src.matchAll(/\.from\(\s*['"](\w+)['"]\s*[,)]/g)) {
    // 這條鏈：從這個 .from( 到下一個 .from( 為止
    let chain = src.slice(m.index + m[0].length, m.index + 6000);
    const nextFrom = chain.search(/\.from\(\s*['"]/);
    if (nextFrom >= 0) chain = chain.slice(0, nextFrom);

    const sel = chain.match(/\.select\(\s*(?:([`'"])([\s\S]*?)\1|(\w*SELECT\w*))/);
    if (!sel) continue;
    const cols = resolve(sel[2] ?? consts.get(sel[3]) ?? '');
    if (!cols || cols.includes('${')) continue; // 拼不出來的交給人工

    // 條件裡帶點的欄位 = 對 embed 的資源下條件
    for (const cond of chain.matchAll(
      /\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in)\(\s*['"]([\w]+)\.([\w]+)['"]/g,
    )) {
      const [, op, table, column] = cond;
      // 同一條鏈的 select 裡有沒有 embed 這張表
      const embedded = new RegExp(`(^|[,\\s(])${table}\\s*(!\\w+)*\\s*\\(`).test(cols);
      if (embedded) continue;

      const line = src.slice(0, m.index + m[0].length + cond.index).split('\n').length;
      findings.push({ file: f, line, from: m[1], op, table, column, cols: cols.trim() });
    }
  }
}

for (const x of findings) {
  console.log(`\n✖ ${x.file}:${x.line}  .from('${x.from}')`);
  console.log(`  .${x.op}('${x.table}.${x.column}', …) 但 select 沒有 embed '${x.table}'`);
  console.log(`  select: ${x.cols.replace(/\s+/g, ' ').slice(0, 120)}`);
}

console.log(`\n找到 ${findings.length} 處「對沒 embed 的資源下條件」。`);
