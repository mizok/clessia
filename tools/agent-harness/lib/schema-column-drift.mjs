#!/usr/bin/env node
/**
 * 掃「程式碼查的欄位在 DB 裡不存在」（issue #608）。
 *
 * 來源 B 是 migrations **依檔名時間序重放**（CREATE / ADD / DROP / RENAME），
 * 不是只讀 CREATE TABLE —— issue 那一筆正是被後來的 migration DROP 掉的。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.argv[2] ?? ".";
const DROP_FOR_CONTROL = process.env["DROP_COL"]; // 正控用：'students.school'

// ─────────────────────────── 來源 B：重放 migrations ───────────────────────────

/** 去掉 -- 與 //* */ /* 註解，但保留字串字面值內的內容 */
function stripSqlComments(sql) {
  let out = "";
  for (let i = 0; i < sql.length; i++) {
    const two = sql.slice(i, i + 2);
    if (sql[i] === "'") {
      // 單引號字串：整段照抄
      out += sql[i++];
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === "'" && sql[i + 1] === "'") out += sql[++i];
        else if (sql[i] === "'") break;
        i++;
      }
      continue;
    }
    if (two === "--") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < sql.length && sql.slice(i, i + 2) !== "*/") i++;
      i++;
      continue;
    }
    out += sql[i];
  }
  return out;
}

/** 依 ; 切述句，但跳過 $$…$$ 與單引號字串 */
function splitStatements(sql) {
  const stmts = [];
  let cur = "";
  for (let i = 0; i < sql.length; i++) {
    if (sql.slice(i, i + 2) === "$$") {
      const end = sql.indexOf("$$", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      cur += sql.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      cur += sql.slice(i, j + 1);
      i = j;
      continue;
    }
    if (sql[i] === ";") {
      stmts.push(cur);
      cur = "";
      continue;
    }
    cur += sql[i];
  }
  if (cur.trim()) stmts.push(cur);
  return stmts;
}

const unquote = (s) => s.replace(/^"(.*)"$/, "$1").replace(/^public\./i, "");

/** 從 CREATE TABLE 的括號內容抽欄位名（跳過表級約束） */
function parseCreateTableCols(body) {
  const cols = [];
  let depth = 0;
  let cur = "";
  const parts = [];
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const raw of parts) {
    const t = raw.trim();
    if (!t) continue;
    if (
      /^(primary\s+key|unique|check|foreign\s+key|constraint|exclude|like)\b/i.test(
        t,
      )
    )
      continue;
    const m = t.match(/^("([^"]+)"|[a-z_][a-z0-9_]*)/i);
    if (m) cols.push(unquote(m[1]));
  }
  return cols;
}

function buildSchema() {
  const dir = join(ROOT, "supabase/migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 檔名時間序
  /** @type {Map<string, Set<string>>} */
  const tables = new Map();
  const log = [];

  for (const file of files) {
    const sql = stripSqlComments(readFileSync(join(dir, file), "utf8"));
    for (const stmt of splitStatements(sql)) {
      const s = stmt.trim();
      if (!s) continue;

      const create = s.match(
        /^create\s+table\s+(if\s+not\s+exists\s+)?([\w."]+)\s*\(([\s\S]*)\)\s*$/i,
      );
      if (create) {
        const name = unquote(create[2]);
        const cols = parseCreateTableCols(create[3]);
        if (!tables.has(name)) tables.set(name, new Set());
        cols.forEach((c) => tables.get(name).add(c));
        log.push(`${file}: CREATE ${name} (${cols.length} cols)`);
        continue;
      }

      const alter = s.match(
        /^alter\s+table\s+(if\s+exists\s+)?(only\s+)?([\w."]+)\s*([\s\S]*)$/i,
      );
      if (alter) {
        const name = unquote(alter[3]);
        const rest = alter[4];
        if (!tables.has(name)) tables.set(name, new Set());
        const set = tables.get(name);
        // 多子句：ADD COLUMN a …, DROP COLUMN b, RENAME COLUMN c TO d
        for (const m of rest.matchAll(
          /\badd\s+column\s+(if\s+not\s+exists\s+)?("([^"]+)"|[a-z_][a-z0-9_]*)/gi,
        )) {
          set.add(unquote(m[2]));
          log.push(`${file}: ADD ${name}.${unquote(m[2])}`);
        }
        for (const m of rest.matchAll(
          /\bdrop\s+column\s+(if\s+exists\s+)?("([^"]+)"|[a-z_][a-z0-9_]*)/gi,
        )) {
          set.delete(unquote(m[2]));
          log.push(`${file}: DROP ${name}.${unquote(m[2])}`);
        }
        for (const m of rest.matchAll(
          /\brename\s+column\s+("([^"]+)"|[a-z_][a-z0-9_]*)\s+to\s+("([^"]+)"|[a-z_][a-z0-9_]*)/gi,
        )) {
          set.delete(unquote(m[1]));
          set.add(unquote(m[3]));
          log.push(
            `${file}: RENAME ${name}.${unquote(m[1])} -> ${unquote(m[3])}`,
          );
        }
      }
    }
  }

  if (DROP_FOR_CONTROL) {
    const [t, c] = DROP_FOR_CONTROL.split(".");
    if (tables.get(t)?.delete(c))
      log.push(`[POSITIVE CONTROL] 人工移除 ${t}.${c}`);
    else log.push(`[POSITIVE CONTROL] ⚠ ${t}.${c} 本來就不在 schema 裡`);
  }
  return { tables, log };
}

// ─────────────────────────── 來源 A：程式碼用到的欄位 ───────────────────────────

/** 收集檔案裡的字串常數（含跨檔 import 的） */
function collectConsts(files) {
  const perFile = new Map();
  const counts = new Map();
  const global = new Map();
  // **值可能是跨行的字串串接** —— `INVOICE_SELECT` 是
  // `'…' + '…' + '…'`（`lib/invoice-query.ts:12`）。只吃單一字面值的話
  // 金流那 8 個使用點全部落進「動態無法解析」。抓到 `;` 為止再把字面值串起來。
  const RE = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*([^;]*);/g;
  for (const { file, source } of files) {
    const local = new Map();
    for (const m of source.matchAll(RE)) {
      const parts = [...m[2].matchAll(/(`[^`]*`|'[^']*')/g)].map((x) =>
        x[1].slice(1, -1),
      );
      if (parts.length === 0) continue;
      // 右值若**純粹是字面值串接**（中間只有 `+` 與空白）就合併，
      // 否則退回「只取第一個字面值」——第一版直接排除不純的右值，
      // 結果涵蓋率從 365 掉到 354：**修一個漏抓卻製造了另一批漏抓。**
      const residue = m[2].replace(/(`[^`]*`|'[^']*')/g, "").trim();
      const value = /^[+\s]*$/.test(residue) ? parts.join("") : parts[0];
      local.set(m[1], value);
      counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
      global.set(m[1], value);
    }
    perFile.set(file, local);
  }
  // 同名的常數不跨檔解析 —— contact-book 的 SELECT 曾覆蓋 announcements 的
  for (const [name, n] of counts) if (n > 1) global.delete(name);
  return { perFile, global };
}

/**
 * 切頂層逗號。**必須跳過引號內**——不跳的話 `'role, permissions'` 這種
 * 完整的字面參數會被切成 `'role`，於是整支被誤判成「動態 select」。
 * （我為了修 `idexact` 加上「只取第一個參數」時踩到，198/366 因此解析不了，
 * 而輸出照樣是乾淨的「0 筆命中」。）
 */
function splitTop(str) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch;
      let j = i + 1;
      while (j < str.length && str[j] !== q) j += str[j] === "\\" ? 2 : 1;
      cur += str.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * 解析 PostgREST 投影字串。
 * 回傳 { uses: [{table, column}], stars: [table], unresolvedEmbeds: [name] }
 */
function parseSelect(sel, baseTable, knownTables, acc, where) {
  for (const rawItem of splitTop(sel)) {
    const item = rawItem.trim();
    if (!item) continue;
    const embed = item.match(/^([^()]+)\(([\s\S]*)\)$/);
    if (embed) {
      let head = embed[1].trim();
      head = head.replace(/^[\w]+\s*:\s*/, ""); // alias:
      head = head.split("!")[0].trim(); // table!fk / table!inner
      const target = head.replace(/\.\.\.$/, "");
      if (knownTables.has(target)) {
        parseSelect(embed[2], target, knownTables, acc, where);
      } else {
        acc.unresolvedEmbeds.push({ name: target, where });
      }
      continue;
    }
    let col = item.replace(/^[\w]+\s*:\s*/, "").trim(); // alias:col
    col = col.split("::")[0].trim(); // cast
    if (!col) continue;
    if (col === "*") {
      acc.stars.push({ table: baseTable, where });
      continue;
    }
    if (!/^[a-z_][a-z0-9_]*$/i.test(col)) continue;
    // PostgREST 的聚合語法 `table(count)` —— 是計數不是欄位。
    // 實際確認過 `academy-exams.ts:566` 的 `academy_exam_classes(count)`。
    if (col === "count") continue;
    acc.uses.push({ table: baseTable, column: col, where, kind: "select" });
  }
}

/**
 * 從 `.from('x')` 之後切出**這一條鏈**，不是固定字元數。
 *
 * 固定 2500 字元會吃到後面不相干的查詢 —— 第一版就因此把
 * `courses.session_date` 之類的東西報成命中（`sessions.ts:2198` 實際只有
 * `.eq('org_id')` 與 `.in('id')`）。**誤報會讓整份報告失去可信度**，
 * 而它長得跟真命中一模一樣。
 *
 * 規則：走到括號深度 0 的 `;` 為止，或撞到下一個 `.from(` 為止。
 */
function chainSlice(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      let j = i + 1;
      while (j < source.length && source[j] !== q) j += source[j] === '\\' ? 2 : 1;
      i = j;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ';' && depth <= 0) return source.slice(start, i);
    if (source.startsWith('.from(', i) && i > start) return source.slice(start, i);
  }
  return source.slice(start);
}

const FILTER_METHODS =
  "eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|overlaps|order|not|match";

/**
 * 從 `.select(` 之後抓出**括號平衡**的參數字串。
 *
 * 第一版用非貪婪 regex 抓到第一個 `)` —— 而 `select('a, b(c)')` 的第一個 `)`
 * **在字串裡面**，於是每一個帶 embed 的 select 都解析失敗、被歸成「動態」。
 * 結果是 199/366 解析不了，**而輸出是一個乾淨的「0 筆命中」** ——
 * 那正是這支工單警告的形狀。
 */
function balancedArgs(source, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      let j = i + 1;
      while (j < source.length && source[j] !== q) j += source[j] === '\\' ? 2 : 1;
      i = j;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return source.slice(openIdx + 1, i);
    }
  }
  return null;
}

/** 括號平衡地抓出 `{ … }` 內容（跳過字串） */
/** 切物件的頂層逗號：跳過字串（含 template），並追蹤 () [] {} 深度 */
function splitTopObj(str) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch;
      let j = i + 1;
      while (j < str.length && str[j] !== q) j += str[j] === "\\" ? 2 : 1;
      cur += str.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function balancedBraces(source, openIdx) {
  if (source[openIdx] !== "{") return null;
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch;
      let j = i + 1;
      while (j < source.length && source[j] !== q) j += source[j] === "\\" ? 2 : 1;
      i = j;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(openIdx + 1, i);
    }
  }
  return null;
}

/** 從 `import { X } from './rel'` 找出 X 的來源檔，再取那個檔的常數 */
function resolveImport(file, name, perFile) {
  const source = readFileSync(file, "utf8");
  const re = new RegExp(
    `import\\s*\\{([^}]*\\b${name}\\b[^}]*)\\}\\s*from\\s*['"]([^'"]+)['"]`,
  );
  const m = source.match(re);
  if (!m) return undefined;
  const dir = file.slice(0, file.lastIndexOf("/"));
  const base = m[2].startsWith(".") ? normalizePath(`${dir}/${m[2]}`) : null;
  if (!base) return undefined;
  for (const cand of [`${base}.ts`, `${base}/index.ts`]) {
    for (const [f, map] of perFile) {
      if (normalizePath(f) === cand && map.has(name)) return map.get(name);
    }
  }
  return undefined;
}

function normalizePath(p) {
  const out = [];
  for (const seg of p.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

function scanCode(knownTables) {
  const list = execSync(
    `find ${ROOT}/apps/api/src -name '*.ts' ! -name '*.spec.ts'`,
    {
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n");
  const files = list.map((f) => ({ file: f, source: readFileSync(f, "utf8") }));
  const { perFile, global: globalConsts } = collectConsts(files);

  const acc = {
    uses: [],
    stars: [],
    unresolvedEmbeds: [],
    dynamicSelects: [],
    selectsParsed: 0,
  };

  for (const { file, source } of files) {
    const rel = file.replace(`${ROOT}/`, "").replace(/^\.\//, "");
    // 每個 .from('x') 之後的鏈
    // **第二個參數要吃下去。** `childDb.from('students', 'id')` 是本 repo 的包裝器，
    // 而第一版的 regex 要求 `'` 後面直接接 `)` —— 於是正控（`children.ts` 修法前
    // 那一筆真 bug）**完全抓不到，輸出是乾淨的 0 筆**。這就是為什麼正控是硬性的。
    for (const m of source.matchAll(
      /\.from\(\s*'([a-z_][a-z0-9_]*)'\s*(?:,[^)]*)?\)/g,
    )) {
      const table = m[1];
      const start = m.index + m[0].length;
      const chunk = chainSlice(source, start);
      const line = source.slice(0, m.index).split("\n").length;
      const where = `${rel}:${line}`;

      // .select(...)
      const selIdx = chunk.search(/^\s*(?:\/\/[^\n]*\n\s*)*\.select\(/);
      const openIdx =
        selIdx === 0 ? chunk.indexOf('(', chunk.indexOf('.select')) : -1;
      const rawArgs = openIdx >= 0 ? balancedArgs(chunk, openIdx) : null;
      if (rawArgs !== null) {
        const arg = rawArgs.trim();
        // **只取第一個參數。** `.select('id', { count: 'exact' })` 的第二個
        // 參數也是字串，串進去會造出 `idexact` 這種不存在的欄位（8 筆假命中）。
        const firstArg = splitTop(arg)[0] ?? '';
        const litParts = [...firstArg.matchAll(/(`[^`]*`|'[^']*')/g)].map((x) =>
          x[1].slice(1, -1),
        );
        if (litParts.length > 0 && /^[`']/.test(arg)) {
          acc.selectsParsed++;
          parseSelect(litParts.join(""), table, knownTables, acc, where);
        } else {
          const id = arg.match(/^([A-Za-z_$][\w$]*)/);
          const local = perFile.get(file);
          // 順序：本檔 → **跟著 import 走** → 全庫唯一的同名常數。
          // 跟著 import 是關鍵：`INVOICE_SELECT` 在 `lib/invoice-query.ts` 與
          // `routes/reports.ts` 各有一份，「同名就不跨檔」的規則會正確地拒絕猜，
          // 但那讓金流那 8 個使用點全落進盲區。**解法是解析而不是猜。**
          const viaImport = id ? resolveImport(file, id[1], perFile) : undefined;
          const resolved = id
            ? (local.get(id[1]) ?? viaImport ?? globalConsts.get(id[1]))
            : undefined;
          if (resolved !== undefined) {
            acc.selectsParsed++;
            parseSelect(resolved, table, knownTables, acc, where);
          } else {
            acc.dynamicSelects.push({
              where,
              arg: arg.slice(0, 60).replace(/\s+/g, " "),
            });
          }
        }
      }

      // **寫入路徑的欄位也要看。** `.insert({...})` / `.update({...})` /
      // `.upsert({...})` 的物件鍵就是欄位名 —— 寫進一個被 DROP 的欄位一樣會炸，
      // 只掃 select 會漏掉整個寫入面。
      for (const w of chunk.matchAll(/\.(insert|update|upsert)\(\s*\{/g)) {
        const objStart = chunk.indexOf("{", w.index + w[0].length - 1);
        const obj = balancedBraces(chunk, objStart);
        if (obj === null) continue;
        // **只取頂層鍵。** 不限深度的話會吃到 TypeScript 型別斷言裡的鍵 ——
        // `reason: \`補 ${(target as { session_date: string }).session_date} 停課\``
        // 曾被報成 `schedule_changes.session_date` 缺欄位（`sessions.ts:1372`），
        // 而那筆誤報長得跟真命中一模一樣，是開檔才發現的。
        for (const part of splitTopObj(obj)) {
          const k = part.match(/^\s*(?:'([a-z_][a-z0-9_]*)'|([a-z_][a-z0-9_]*))\s*:/i);
          const col = k?.[1] ?? k?.[2];
          if (!col) continue;
          acc.uses.push({ table, column: col, where, kind: w[1] });
        }
      }

      // 過濾／排序方法的欄位（屬於 base table）
      for (const f of chunk.matchAll(
        new RegExp(`\\.(${FILTER_METHODS})\\(\\s*'([^']+)'`, "g"),
      )) {
        const col = f[2];
        if (!/^[a-z_][a-z0-9_]*$/i.test(col)) continue; // 帶點的是 embed 路徑，另計
        acc.uses.push({ table, column: col, where, kind: f[1] });
      }
    }
  }
  return acc;
}

// ─────────────────────────── 比對 ───────────────────────────

const { tables, log } = buildSchema();
const acc = scanCode(tables);

const missing = [];
const seen = new Set();
for (const u of acc.uses) {
  const cols = tables.get(u.table);
  if (!cols) continue; // 不是我們 schema 裡的表（ba_* 由 Better Auth 管，仍在 schema 裡的話會有）
  if (cols.has(u.column)) continue;
  const key = `${u.table}.${u.column}|${u.where}|${u.kind}`;
  if (seen.has(key)) continue;
  seen.add(key);
  missing.push(u);
}

const mode = DROP_FOR_CONTROL
  ? `正控模式（已移除 ${DROP_FOR_CONTROL}）`
  : "正常掃描";
console.log(`\n=== ${mode} ===`);
console.log(`schema: ${tables.size} 張表`);
console.log(
  `來源 A: ${acc.selectsParsed} 個 select 解析成功、${acc.dynamicSelects.length} 個動態無法解析`,
);
console.log(`欄位使用點: ${acc.uses.length}（去重前）`);
console.log(`select('*') 黑箱: ${acc.stars.length} 處`);
console.log(`無法解析的 embed 名稱: ${acc.unresolvedEmbeds.length} 處`);
console.log(
  `\n--- 命中（程式碼查的欄位不在 schema 裡）: ${missing.length} 筆 ---`,
);
for (const m of missing)
  console.log(`  ${m.table}.${m.column}  ${m.where}  (${m.kind})`);

if (process.env["SHOW"] === "blind") {
  console.log("\n--- 動態 select ---");
  acc.dynamicSelects.forEach((d) => console.log(`  ${d.where}  ${d.arg}`));
  console.log("\n--- select(*) ---");
  [...new Set(acc.stars.map((s) => `${s.table} @ ${s.where}`))].forEach((s) =>
    console.log(`  ${s}`),
  );
  console.log("\n--- 未解析 embed ---");
  [
    ...new Set(acc.unresolvedEmbeds.map((e) => `${e.name} @ ${e.where}`)),
  ].forEach((e) => console.log(`  ${e}`));
}
if (process.env["SHOW"] === "ddl") log.forEach((l) => console.log(l));
if (process.env["SHOW"] === "students") {
  console.log("students 欄位:", [...(tables.get("students") ?? [])].join(", "));
}
