/**
 * A30（#2493）：**每一支 admin 可達的端點都要有分校範圍契約**，或明文列為「本來不分校」。
 *
 * ## 為什麼是端點層級
 *
 * A7c 看的是檔：一個檔裡有一處 `getCampusScope(` 就整檔過關。#2493 盤點時 206 支裡有 33 支缺口
 * 全在「有接範圍的檔」裡 —— 列表收斂了、同一檔的 `/:id` 沒收斂；body 的 campusId 驗了、
 * path 的 id 沒驗。**檔層級的綠燈對這種洞全盲。**
 *
 * ## 判準
 *
 * 端點清單由 `app.routes` 現場產生（不手抄），濾出 `mount()` 角色含 admin 的前綴。每一支必須落在下列之一：
 *
 * 1. **契約認領**：`apps/api/src/contract/*.contract.ts` 裡有一行 `// scope-contract: METHOD /api/path`
 * 2. **ORG 帳本**（`campus-scope-org.json`）：本來不分校的資料，每筆 reason＋evidence＋ruling
 * 3. **baseline**（`campus-scope-contract-baseline.json`）：債。只降不升 —— 有契約認領了就要刪
 *
 * 新端點三者都不在 → 紅。帳本或標記指到不存在的端點 → 紅（過期）。
 *
 * ## 這支看不到什麼（**也寫進 fail 訊息**）
 *
 * **它只證明「有人寫了契約並宣稱覆蓋」，不證明契約的斷言是對的。** 一份只測列表的契約掛上
 * `/:id` 的標記，這裡一樣綠。斷言正確與否是審核席讀契約的事。
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 契約裡的認領標記：`// scope-contract: PATCH /api/enrollments/:id` */
const TAG = /^\s*\/\/\s*scope-contract:\s*(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)\s*$/gm;

export function contractTags(files) {
  const out = new Map();
  for (const { file, source } of files)
    for (const m of source.matchAll(TAG)) out.set(`${m[1]} ${m[2]}`, file);
  return out;
}

/** 端點路徑歸不歸某個前綴（邊界要對：`/api/me` 不吃 `/api/meals`） */
const under = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * @param endpoints  `METHOD /path` 全部（app.routes）
 * @param adminPrefixes  mount 角色含 admin 的前綴
 * @param tags  contractTags() 的結果
 * @param org  [{ endpoint } | { prefix }，各帶 reason／evidence／ruling]
 * @param baseline  { [endpoint]: 備註 }
 * @returns 失敗訊息陣列
 */
export function scopeContractProblems({ endpoints, adminPrefixes, tags, org, baseline }) {
  const admin = endpoints.filter((e) => adminPrefixes.some((p) => under(e.split(' ')[1], p)));
  const adminSet = new Set(admin);
  const inOrg = (e) =>
    org.some((o) => (o.endpoint ? o.endpoint === e : under(e.split(' ')[1], o.prefix)));
  const problems = [];

  for (const e of admin) {
    if (tags.has(e) || inOrg(e) || e in baseline) continue;
    problems.push(
      `${e} 沒有分校範圍契約 —— 在契約檔加一行 \`// scope-contract: ${e}\`，並斷言` +
        `「受限一校看不到／寫不進別校、指名別校 403 或 404、空範圍 0 列」；本來不分校的列進 ` +
        `campus-scope-org.json（reason＋evidence＋ruling）。` +
        `（這道只認標記，不驗契約斷言對不對 —— 那是審核席讀契約的事）`,
    );
  }
  for (const [e, file] of tags)
    if (!adminSet.has(e))
      problems.push(`${file} 的 scope-contract 標記 ${e} 對不到任何 admin 端點（過期或打錯）`);
  for (const o of org) {
    const key = o.endpoint ?? `${o.prefix}/*`;
    if (!o.reason || !o.evidence || !o.ruling)
      problems.push(`campus-scope-org.json 的 ${key} 少了 reason／evidence／ruling`);
    const hit = o.endpoint
      ? adminSet.has(o.endpoint)
      : admin.some((e) => under(e.split(' ')[1], o.prefix));
    if (!hit) problems.push(`campus-scope-org.json 的 ${key} 對不到任何 admin 端點 —— 刪掉`);
  }
  for (const e of Object.keys(baseline)) {
    if (!adminSet.has(e))
      problems.push(`campus-scope-contract-baseline.json 的 ${e} 已不存在 —— 刪掉（只降不升）`);
    else if (tags.has(e))
      problems.push(
        `${e} 已有契約認領（${tags.get(e)}）—— 從 campus-scope-contract-baseline.json 刪掉`,
      );
    else if (inOrg(e)) problems.push(`${e} 同時在 ORG 帳本與 baseline —— 擇一`);
  }
  return problems;
}

/** 現場產生 `METHOD /path` 清單（同 api-param-coverage 的 tsx probe；ALL 是 middleware 不算） */
export function collectEndpoints(root) {
  const apiDir = join(root, 'apps/api');
  const probe = join(apiDir, '.scope-contract-probe.mjs');
  writeFileSync(
    probe,
    [
      "const mod = await import('./src/index.ts');",
      'const app = mod.default ?? mod.app;',
      "const out = new Set(app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`));",
      'console.log(JSON.stringify([...out]));',
    ].join('\n'),
  );
  try {
    const raw = execFileSync('npx', ['tsx', '.scope-contract-probe.mjs'], {
      cwd: apiDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    return JSON.parse(raw.trim().split('\n').pop());
  } finally {
    rmSync(probe, { force: true });
  }
}

export function loadContractFiles(root) {
  const dir = join(root, 'apps/api/src/contract');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.contract.ts'))
    .map((f) => ({
      file: `apps/api/src/contract/${f}`,
      source: readFileSync(join(dir, f), 'utf8'),
    }));
}
