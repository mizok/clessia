/**
 * 守 c1 的「寫入帶 `org_id`」那一半（#966 B 批）。
 *
 * ## 問題形狀
 *
 * API 用 service role，RLS 不擋（AGENTS.md）—— **`org_id` 過濾是唯一的一道牆**。
 * 而 `supabase.from('campuses').update(x).eq('id', id)` 少了 `.eq('org_id', orgId)`
 * **不會報任何錯**：同 org 的 id 照常成功，別 org 的 id 也照常成功。
 * 1037 盤點（#966）之後沒有人逐支補，就是因為它不會紅。
 *
 * ## 判準
 *
 * 對「有 `org_id` 欄位的表」的 `update` / `delete` 鏈，必須二擇一：
 * - 鏈裡有 `.eq('org_id', …)`
 * - 整條鏈是 `inOrg(…, orgId)` 的第一個參數（`apps/api/src/lib/org-scope.ts`）
 *
 * **哪些表有 `org_id` 從 migration 推導**，不在這裡抄一份（c11）。
 *
 * ## 這支看不到什麼（fail 訊息也要講）
 *
 * - **只看 update / delete。** insert / upsert 的 payload 多半在前面組好，靜態看不出有沒有
 *   `org_id`（盤點時 18 處有 17 處是誤報）—— 那一半與「body 指名的外部 id 屬不屬於本 org」
 *   （B4）都靠 review。
 * - **子表**（沒有 `org_id` 欄位，例如 `schedules`、`invoice_items`）不在範圍內：
 *   它們要驗的是父列，不是自己的欄位。
 * - **不驗值**：`.eq('org_id', somethingElse)` 也算過。
 */

/** 從 migration 文字推導「有 `org_id` 欄位的表」。照檔名順序餵進來（時間戳 = 套用順序）。 */
export function orgTablesFromMigrations(sqlTexts) {
  const tables = new Set();
  for (const raw of sqlTexts) {
    const sql = raw.replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(
      /\b(create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table(?:\s+if\s+exists)?(?:\s+only)?|drop\s+table(?:\s+if\s+exists)?)\s+(?:public\.)?"?(\w+)"?/gi,
    )) {
      const verb = m[1].toLowerCase();
      const table = m[2].toLowerCase();
      if (verb.startsWith('drop')) {
        tables.delete(table);
        continue;
      }
      const rest = sql.slice(m.index + m[0].length);
      if (verb.startsWith('create')) {
        const body = parenBody(rest);
        if (body !== null && /(^|[(,\s])org_id\s/i.test(body)) tables.add(table);
      } else {
        const stmt = rest.slice(0, rest.indexOf(';') === -1 ? undefined : rest.indexOf(';'));
        if (/add\s+column\s+(?:if\s+not\s+exists\s+)?org_id\b/i.test(stmt)) tables.add(table);
      }
    }
  }
  return tables;
}

/** `rest` 第一個 `(` 到對應 `)` 之間的文字；不是以 `(` 開頭（例如 `create table x as select`）回 null */
function parenBody(rest) {
  const start = rest.search(/\S/);
  if (start === -1 || rest[start] !== '(') return null;
  let depth = 0;
  for (let i = start; i < rest.length; i++) {
    if (rest[i] === '(') depth++;
    else if (rest[i] === ')' && --depth === 0) return rest.slice(start + 1, i);
  }
  return null;
}

/**
 * @param {Array<{path: string, text: string}>} files
 * @param {Set<string>} orgTables
 * @returns {Array<{path: string, line: number, table: string, op: string}>}
 */
export function unscopedOrgWrites(files, orgTables) {
  const hits = [];
  for (const { path, text } of files) {
    for (const m of text.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)/g)) {
      const table = m[1];
      if (!orgTables.has(table)) continue;
      const chain = chainFrom(text, m.index);
      const op = chain.match(/\.(update|delete)\(/)?.[1];
      if (!op) continue;
      if (/\.eq\(\s*['"]org_id['"]/.test(chain) || wrappedByInOrg(text, m.index)) continue;
      hits.push({ path, line: text.slice(0, m.index).split('\n').length, table, op });
    }
  }
  return hits;
}

/** 從 `.from(` 走到同層的 `;` 或把它包住的那個右括號 */
function chainFrom(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch) && --depth < 0) return text.slice(start, i);
    else if (ch === ';' && depth === 0) return text.slice(start, i);
  }
  return text.slice(start);
}

/** `inOrg(supabase.from(...)` / `inOrg(\n  db\n    .from(...)` —— 往回略過接收者與空白，看是不是 `inOrg(` */
function wrappedByInOrg(text, fromIndex) {
  const before = text.slice(Math.max(0, fromIndex - 200), fromIndex);
  return /\binOrg\(\s*[\w$.]*\s*$/.test(before);
}

/** 從 `lib/org-scope.ts` 原始碼抽 `OrgTable` union 的成員 */
export function declaredOrgTables(source) {
  const m = source.match(/export\s+type\s+OrgTable\s*=([^;]+);/);
  if (!m) return null;
  return new Set([...m[1].matchAll(/['"](\w+)['"]/g)].map((x) => x[1]));
}
