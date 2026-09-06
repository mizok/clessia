#!/usr/bin/env node
/**
 * 找「有 embed、但**沒有 `!inner`**，卻對那個 embed 的欄位下條件」——
 * 這一族的**安靜那半**：條件不會篩掉父列，**回全部，而且沒有任何錯誤**。
 *
 * ```sh
 * SERVICE_KEY=$(npx supabase status -o json | jq -r .SECRET_KEY) \
 *   node apps/api/src/scripts/audit-missing-inner.mjs apps/api/src
 * ```
 *
 * ## 這一族的三半，三支工具
 *
 * | 情況 | 症狀 | 誰抓 |
 * | --- | --- | --- |
 * | select 的欄位／關聯不存在 | `42703` / `PGRST200`，400 | `audit-selects.mjs` |
 * | **沒有** embed 就下條件 | `PGRST108`，400，**大聲** | `audit-embedded-filters.mjs` |
 * | 有 embed 但沒 `!inner` | **什麼都不篩，回全部，安靜** | **這一支** |
 *
 * ## 為什麼它只能給「候選」，而候選仍然有用
 *
 * `!inner` 該不該有，取決於**那個 embed 是不是用來篩父列**：
 *
 * - 想篩父列（「只要有未點名事件的課堂」）→ **要 `!inner`**，沒有就是靜默失效
 * - 想修剪 embed 出來的清單（「這個班的學生，只列在籍的」）→ **不要 `!inner`**，現況正確
 *
 * **那個意圖在程式碼裡看不出來**，所以這支不輸出「違規」。
 *
 * 但它做得到一件比靜態掃描強的事：**證明那個條件現在篩不掉任何父列**。
 * 對每個候選發兩支查詢（同樣的條件，一支照原樣、一支加 `!inner`），比對父列筆數：
 *
 * - **筆數不同** → 現況的寫法確實沒有在篩父列（如果作者想篩，那就是 bug）
 * - 筆數相同 → 這份資料分不出來（可能剛好每一列都有對應的 embed 列）
 *
 * 探針用的是 `<embed 表>.id=eq.<不可能的 uuid>`：**不用造真值、不會撞型別，而且必然不命中**。
 * （第一版用 `not.is.null`，在必填 FK 上每一列都命中，兩種寫法回一樣的筆數 ——
 * 那不是「安全」，是探針太弱。）
 *
 * ## 盲區
 *
 * 1. 只認得靜態字串；鏈式範圍用「到下一個 `.from(`」估（`audit-selects.mjs` 在這裡
 *    製造過 31 筆假命中）
 * 2. **意圖判不出來** —— 見上，所以輸出是候選不是違規
 * 3. 探針的結論依賴**現在這份資料**：筆數相同只代表這份資料分不出來
 * 4. 需要一個 migration 跟上的資料庫（落後的 DB 會讓 embed 整個解析失敗）
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

const candidates = [];

for (const f of files) {
  const src = readFileSync(f, 'utf8');

  for (const m of src.matchAll(/\.from\(\s*['"](\w+)['"]\s*[,)]/g)) {
    let chain = src.slice(m.index + m[0].length, m.index + 6000);
    const nextFrom = chain.search(/\.from\(\s*['"]/);
    if (nextFrom >= 0) chain = chain.slice(0, nextFrom);

    const sel = chain.match(/\.select\(\s*(?:([`'"])([\s\S]*?)\1|(\w*SELECT\w*))/);
    if (!sel) continue;
    const cols = resolve(sel[2] ?? consts.get(sel[3]) ?? '');
    if (!cols || cols.includes('${')) continue;

    for (const cond of chain.matchAll(
      /\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in|not)\(\s*['"]([\w]+)\.([\w]+)['"]/g,
    )) {
      const [, op, table, column] = cond;

      // 這個 embed 在 select 裡長什麼樣（有沒有 !inner）
      const embed = new RegExp(`(^|[,\\s(])(${table}(![\\w!]+)?)\\s*\\(`).exec(cols);
      if (!embed) continue; // 沒有 embed → 那是 audit-embedded-filters.mjs 的事
      const spec = embed[2];
      if (spec.includes('!inner')) continue; // 已經有了

      const line = src.slice(0, m.index + m[0].length + cond.index).split('\n').length;
      candidates.push({ file: f, line, from: m[1], op, table, column, spec, cols: cols.trim() });
    }
  }
}

async function count(table, select, filter) {
  const params = new URLSearchParams({ select });
  if (filter) params.append(...filter);
  const res = await fetch(`${REST}/${table}?${params}`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  const range = res.headers.get('content-range');

  return res.ok && range ? Number(range.split('/')[1]) : null;
}

console.log(`## 候選（${candidates.length}）\n`);

for (const c of candidates) {
  // 同一個條件，一支照原樣、一支加 !inner —— 父列筆數不同就代表現況篩不到父列
  const asWritten = c.cols.replace(/\s+/g, '');
  const withInner = asWritten.replace(
    new RegExp(`(^|[,(])${c.spec.replace(/[!]/g, '\\!')}\\s*\\(`),
    (all, lead) => `${lead}${c.spec}!inner(`,
  );
  // **探針要「不可能命中」才有鑑別力**：第一版用 `not.is.null`，而必填 FK 的
  // embed 每一列都命中，兩種寫法都回一樣的筆數 —— 那不是「安全」，是探針太弱。
  // 改用 embed 那張表的 id 配一個不可能的 uuid：照原樣寫時父列一筆都不會少
  // （證明它篩不到父列），加上 !inner 之後應該歸零。
  const probe = [`${c.table}.id`, 'eq.00000000-0000-0000-0000-000000000000'];

  const [plain, inner] = await Promise.all([
    count(c.from, asWritten, probe),
    count(c.from, withInner, probe),
  ]);

  const verdict =
    plain === null || inner === null
      ? '（探針跑不動，人工看）'
      : plain > inner
        ? `**證明：現況篩不到父列** —— 不可能命中的條件下，照原樣仍回 ${plain} 筆、加 !inner 是 ${inner} 筆`
        : `分不出來（照原樣 ${plain} 筆、加 !inner ${inner} 筆）`;

  console.log(`✱ ${c.file}:${c.line}  .from('${c.from}')`);
  console.log(
    `  .${c.op}('${c.table}.${c.column}', …) 而 select 裡是 \`${c.spec}(\` —— 沒有 !inner`,
  );
  console.log(`  ${verdict}\n`);
}

console.log(
  `候選 ${candidates.length} 筆。**這是候選不是違規** —— ` +
    `想篩父列就該加 !inner，想修剪 embed 清單就不該加，而那個意圖程式碼裡看不出來。`,
);
