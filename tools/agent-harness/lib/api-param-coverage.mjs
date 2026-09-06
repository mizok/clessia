/**
 * API query 參數的前端覆蓋率 —— 抓「schema 有這個參數，前端 service 沒有」。
 *
 * **這一族已經發生三次**（`billingMode` #186、`hasInvoice` #238、
 * `attendanceTaken` #298），每次的症狀都一樣：API 從一開始就吃那個參數，
 * 但前端的參數型別漏了它，於是**呼叫端不知道那個能力存在**。
 * #186 那次的代價是整批報名的計費設定全部沒送出。
 *
 * **判準刻意只比對「參數名有沒有出現在那支 service 的原始碼裡」**，不驗型別。
 * 三次實例全是名字根本不存在 —— 先解已經發生的那個，不為了完整性做一個大的。
 *
 * 文件由 `getOpenAPIDocument()` 現場產生（`@hono/zod-openapi` 的 public API），
 * **純靜態、不用跑 server 也不用起 DB**。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 前端刻意不支援的參數 —— 跟 baseline（債）不同，這些是**決定**，不該歸零 */
const EXEMPT = new Map([
  [
    '/api/attendance/sessions|teacherId',
    '老師端一律被伺服器蓋成自己（attendance/teacher-scope.ts），前端傳了沒用',
  ],
  [
    '/api/classes/{id}/sessions/preview|includeUnassigned',
    "後端預設就是 true（`includeUnassigned !== 'false'`）。產生課堂的預覽本來就要含未指派的，前端不需要表態",
  ],
  [
    '/api/sessions|courseId',
    'schema 自己標了「單一，舊版」—— 前端用的是 courseIds（複數）。留著單數是為了舊網址',
  ],
  [
    '/api/class-logs|published',
    // ⚠️ 這筆的理由 2026-09-06 改寫過。**原文是「v1a 沒有發布，v1b 啟用發布時要把這一筆
    // 拿掉」——而 v1b 已經在 2026-09-05 啟用發布了**（見 architecture/teacher-class-log.md
    // 的「v1b 已啟用發布」、`class-logs.service.ts` 的 `publish()`、老師端
    // `class-log-sheet.component.ts` 的入口）。也就是說**它自己寫下的移除條件已經成立，
    // 但沒有人回頭看** —— 一個豁免的理由過期之後，它看起來跟一個仍然成立的豁免一模一樣。
    //
    // 回頭查證的結論是**豁免仍然該留，但原本的理由不再是真的**：發布有了，
    // 而 `GET /api/class-logs` 的**唯一消費端**仍然是老師端的課堂 bottom sheet，
    // 它查的是「這一班這一天」的單篇（`class-log-sheet.component.ts`），
    // 沒有「列出多篇再依草稿/已發布篩選」的畫面。家長端讀取頁走的是另一支
    // `GET /api/me/class-logs`（它有自己的豁免那批）。
    //
    // **新的移除條件（比舊的窄，而且是可觀察的）**：出現任何「一次列出多篇日誌」的
    // 消費端時 —— 例如管理端的日誌總覽、或老師端的歷史列表。**不是「發布上線時」**，
    // 因為發布上線跟需不需要這個篩選是兩件事，舊條件把它們綁在一起才會過期。
    '前端唯一消費端（老師端課堂 bottom sheet）只查「這一班這一天」的單篇，沒有需要分草稿/已發布的清單畫面。出現「一次列出多篇日誌」的消費端時要重新評估 —— 詳細理由與 2026-09-06 的回查見上方註解',
  ],
  // ── 這批的理由 2026-09-07 改寫過（issue #589）。**舊理由已經不是真的了。** ──────
  //
  // 舊理由寫「前端消費端排在 P4，**真正的消費端是還沒生出來的**
  // attendance/grades/billing.service.ts」。那三支**早就生出來了**，而且送出的正是
  // 這些參數（`core/parent-attendance.service.ts:66-70` 等，逐參數比對 5/5、5/5、3/3）。
  //
  // **但這批豁免不能因此刪掉，因為它們真正在做的是另一件事** ——
  // 而那件事舊理由只用一句附帶說明帶過（「不代表那兩支 service 要負責這些參數」）：
  //
  // **`servicePrefixes()` 只抽一段路徑**（regex 是 `/api/[a-z0-9-]+`），所以
  // `/api/me/attendance`、`/api/me/grades`、`/api/me/billing`、`/api/me/class-logs`
  // 這四支端點的前綴**全部被抽成 `/api/me`**，而 core 底下有 **6 支** service
  // 宣告了那個前綴（auth / api / children / parent-attendance / parent-grades /
  // parent-billing）。判斷是逐 service 做的（`findMissing` 的迴圈），
  // 於是**每一支都要為其他五支的參數負責**。
  //
  // 實測：把這批拿掉，harness 從綠變成 **43 筆紅**，而每一筆都是
  // 「這個參數有別的 service 在送，只是不是這一支」。
  //
  // **所以這批是在壓前綴碰撞的雜訊，不是在等 P4。** 移除條件也因此不同：
  // **`servicePrefixes()` 改成抽最長路徑（或 findMissing 改成以端點為單位判斷）的那一天**
  // —— 那是一個對 170 支 route 都會改變行為的決定，不在本次範圍（見 issue #589 留言）。
  ['/api/me/attendance|childId', '前綴碰撞：6 支 service 都宣告 /api/me，每支被要求為其他支的參數負責。真正的消費端 core/parent-attendance.service.ts 有送 —— 見上方註解'],
  ['/api/me/attendance|dateFrom', '同上'],
  ['/api/me/attendance|dateTo', '同上'],
  ['/api/me/attendance|page', '同上'],
  ['/api/me/attendance|pageSize', '同上'],
  ['/api/me/grades|childId', '前綴碰撞：6 支 service 都宣告 /api/me，每支被要求為其他支的參數負責。真正的消費端 core/parent-grades.service.ts 有送 —— 見上方註解'],
  ['/api/me/grades|dateFrom', '同上'],
  ['/api/me/grades|dateTo', '同上'],
  ['/api/me/grades|page', '同上'],
  ['/api/me/grades|pageSize', '同上'],
  ['/api/me/billing|childId', '前綴碰撞：6 支 service 都宣告 /api/me，每支被要求為其他支的參數負責。真正的消費端 core/parent-billing.service.ts 有送 —— 見上方註解'],
  ['/api/me/billing|page', '同上'],
  ['/api/me/billing|pageSize', '同上'],
  // 家長端教務日誌讀取端點，同一批排序 —— 前端消費端是 teacher-pages 的
  // v1b（家長讀取頁 + 發布啟用），還沒生出來。見 kb/wiki/architecture/
  // parent-class-logs-read.md。
  ['/api/me/class-logs|childId', '家長端教務日誌讀取端點 API 先行，前端消費端排在 v1b，見上方說明'],
  ['/api/me/class-logs|dateFrom', '同上'],
  ['/api/me/class-logs|dateTo', '同上'],
  ['/api/me/class-logs|page', '同上'],
  ['/api/me/class-logs|pageSize', '同上'],
  // ── #361 的兩筆（`attendanceTaken` / `endedOnly`）已於 2026-09-07 刪除 ──────────
  // 前端消費端（StatCard.queryParams、sessions 頁的「今日未點名」pill）已經落地並送出
  // 這兩個參數，所以豁免對不上任何實際落差 —— 那正是下面 `staleExemptions()` 要抓的。
  //
  // **它們是被機器抓到的，不是被讀出來的。** 同一天 infra 逐筆讀完整張表做稽核
  // （issue #589），讀漏了這兩筆；補上可否證性之後第一次執行就報了出來。
]);

export function collectApiParams(root, record) {
  const apiDir = join(root, 'apps/api');
  // **API schema 側也要記範圍。** 只記 service 那側的話，「API 端點範圍縮小」
  // 就沒有人看著了 —— 少掃一半端點的 gate 一樣會顯示綠燈。
  record?.('api-query-params', { roots: ['apps/api/src/routes'], exts: ['.ts'] });
  const probe = join(apiDir, '.api-param-probe.mjs');
  writeFileSync(
    probe,
    [
      "const mod = await import('./src/index.ts');",
      'const app = mod.default ?? mod.app;',
      "const doc = app.getOpenAPIDocument({ openapi: '3.0.0', info: { title: 'x', version: '0' } });",
      'const out = {};',
      'for (const [path, item] of Object.entries(doc.paths ?? {})) {',
      "  const p = (item.get?.parameters ?? []).filter((x) => x.in === 'query').map((x) => x.name);",
      '  if (p.length > 0) out[path] = p;',
      '}',
      'console.log(JSON.stringify(out));',
    ].join('\n'),
  );
  try {
    const raw = execFileSync('npx', ['tsx', '.api-param-probe.mjs'], {
      cwd: apiDir,
      encoding: 'utf8',
      // stderr 走 inherit:原本是 'ignore',probe 失敗時 execFileSync 丟出的物件裡
      // `stderr: null`、`stdout: ''` —— **只剩一個 status: 1,查不出為什麼**。
      // 2026-09-06 main 紅在這裡,而 CI 日誌沒有任何一行說明原因。
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    return JSON.parse(raw.trim().split('\n').pop());
  } finally {
    rmSync(probe, { force: true });
  }
}

/**
 * 端點路徑歸不歸這個前綴管。**邊界要檢查** —— 純 `startsWith` 會讓
 * `/api/classes` 命中 `/api/classes-archive`。現在沒有這種端點，所以這是預防不是修復。
 */
export function matchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * 一支 service 打哪些 API 路徑前綴。
 *
 * **不綁前面那個變數名。** 第一版寫成 `apiUrl}(/api/…)`，於是漏掉四支用
 * `${this.baseUrl}/api/…` 的（courses / campuses / classes / staff）——
 * 它們的端點變成「無人認領」而**被靜靜跳過**，gate 對那四支全盲卻顯示綠燈。
 *
 * 現在抓任何位置的 `/api/<name>`，**包含註解裡的**。那個方向是安全的：
 * 多認領幾個端點只會多報幾筆要分診的，漏認領才會產生一個假的綠燈。
 */
export function servicePrefixes(source) {
  // **剔除註解行再抓。** 不剔的話，一支 service 的註解提到別支的端點
  //（`attendance` 的註解寫 `/api/leaves`、`contact-book` 的寫 `/api/invoices`）
  // 就會把那些端點認領過來，然後報一堆不屬於它的缺漏。
  // 實際的端點宣告不會住在註解裡，所以這個剔除不會造成漏認領。
  return [...new Set([...stripComments(source).matchAll(/\/api\/[a-z0-9-]+/g)].map((m) => m[0]))];
}

/**
 * 去掉註解行。
 *
 * **兩處都要用，而且第二處才是關鍵。** 前綴抽取不剔的話會認領到別支的端點；
 * 參數檢查不剔的話會把**註解裡提到的參數名**當成「前端有支援」——
 * `invoices.service.ts` 的檔頭寫著「`status` / `total` / `netPaid` 全由後端推導」，
 * 於是 gate 認為它支援 `status`，即使組 query 的那一行被刪掉也不會紅。
 *
 * 這個洞是照 infra 建議的反例驗證（拿掉一個最普通的參數看 gate 紅不紅）抓到的 ——
 * **用訊號抓得到的案例去驗證訊號，永遠會自洽**。
 */
/**
 * 這支 service 有沒有把某個名字當成 query 參數送出去。
 *
 * **認四種明確的形狀，不認「引號」這個過寬的代理。** 第一版認「引號裡的字面值」，
 * 而 repo 裡有 11 處用物件簡寫傳參（`{ params: { date } }`）——
 * 那些鍵**沒有引號**，於是 gate 會把明明支援的參數報成缺漏。
 *
 * **誤報比漏報糟**：漏報只是少擋一次；誤報會讓人去關掉整個 gate，
 * 而且會污染 baseline —— 假債收進去之後，去「修」它的人會發現根本沒東西可修。
 */
export function sendsParam(code, name) {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // ① HttpParams：`p.set('x', …)` / `p.append('x', …)`
  if (new RegExp(`\\.(?:set|append)\\(\\s*['"\`]${n}['"\`]`).test(code)) return true;
  // ② Record 物件：`query['x'] = …` / `query.x = …`
  if (new RegExp(`\\[\\s*['"\`]${n}['"\`]\\s*\\]\\s*=`).test(code)) return true;
  // ③ 傳給 http client 的物件字面值：`{ params: { x } }` / `{ params: { x: … } }`
  for (const block of code.matchAll(/params:\s*\{([^}]*)\}/g)) {
    if (new RegExp(`\\b${n}\\b`).test(block[1])) return true;
  }
  // ④ 先組成一個 query 物件再傳：`const params: Record<string, string> = { from, to }`
  //    reports 與 classes 都是這樣寫的，而它跟 ③ 是同一件事的不同語法
  for (const block of code.matchAll(/(?:const|let)\s+(?:params|query)\b[^=]*=\s*\{([^}]*)\}/g)) {
    if (new RegExp(`\\b${n}\\b`).test(block[1])) return true;
  }
  return false;
}

export function stripComments(source) {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

/**
 * 沒有任何 service 認領的端點 —— **必須是可見的，不能靜靜跳過**。
 *
 * 跳過等於「gate 說沒問題，但它根本沒去看那裡」。這份清單進報告，
 * 讓「範圍縮小」跟「缺漏」一樣看得見。
 *
 * **注意這跟「那支檔案不是 HTTP service」是兩件事**：`core/` 底下有六支完全不含
 * `/api/`（`browser-state` / `device` / `navigation` / `overlay-container` /
 * `reference-data` / `system-clock`）—— 它們被跳過是對的，不該混進這份清單。
 * 報告要把兩者分開講，不然讀的人得自己再確認一次。
 */
export function findOrphanEndpoints(apiParams, services) {
  const prefixes = services.flatMap((s) => servicePrefixes(s.source));
  return Object.keys(apiParams).filter(
    (path) => !prefixes.some((prefix) => matchesPrefix(path, prefix)),
  );
}

export function findMissing(apiParams, services) {
  const missing = [];
  for (const { file, source } of services) {
    const code = stripComments(source);
    const prefixes = servicePrefixes(source);
    if (prefixes.length === 0) continue;

    for (const [path, params] of Object.entries(apiParams)) {
      if (!prefixes.some((prefix) => matchesPrefix(path, prefix))) continue;
      for (const name of params) {
        const key = `${path}|${name}`;
        if (EXEMPT.has(key)) continue;
        if (!sendsParam(code, name)) missing.push({ file, path, name });
      }
    }
  }
  return missing;
}

/** 有打 API 的 service vs 根本不是 HTTP service —— 後者被跳過是對的 */
/**
 * **過期的豁免要自己叫。**
 *
 * 這道機制 2026-09-07 才補上（issue #589），而補它的理由是一次對照出來的觀察：
 *
 * | 豁免表 | 過期時 |
 * | --- | --- |
 * | `TOUCH_TARGET_EXEMPT` / `CONTRAST_EXEMPT`（`check-harness.mjs`） | **gate 紅** |
 * | 本檔的 `EXEMPT`（在此之前） | **什麼都不會發生** —— 唯一的用法是 `if (EXEMPT.has(key)) continue` |
 *
 * 同一個 repo、兩張豁免表，一張可否證、一張不可 ——
 * 而「豁免理由過期了沒人發現」三次全部出自不可否證的那一張
 * （`/api/class-logs|published` 的 #461、`#361` 的 `attendanceTaken` / `endedOnly`）。
 * **不是誰不細心：可否證的那張沒有機會過期太久，因為它會自己叫。**
 *
 * **驗證這件事本身**：#589 的稽核是逐筆**讀**完整張表做的，讀漏了 `#361` 那兩筆；
 * 這支函式第一次執行就把它們報了出來。**讀得再仔細也不是機制。**
 *
 * ## 這支看不到什麼
 *
 * 它只判斷「這個 key 今天還對不對得上一個實際落差」，**不判斷理由寫得對不對**。
 * `/api/me/*` 那批就是活生生的例子：它們對得上落差（所以這支安靜），
 * 但**理由曾經是假的**（寫著「消費端還沒生出來」，而它們早就生出來了）。
 * **一個理由過期、但豁免仍然必要的豁免，這支抓不到 —— 那一半只能靠人稽核。**
 *
 * `exempt` 只為了 self-test 可注入而存在（預設就是本檔的 `EXEMPT`）——
 * **兩個方向都要有測試**：過期的要報，仍然必要的要安靜。
 *
 * @returns {string[]} 對不上任何落差的豁免 key，已排序
 */
export function staleExemptions(apiParams, services, exempt = EXEMPT) {
  const gaps = new Set();
  for (const { source } of services) {
    const code = stripComments(source);
    const prefixes = servicePrefixes(source);
    if (prefixes.length === 0) continue;

    for (const [path, params] of Object.entries(apiParams)) {
      if (!prefixes.some((prefix) => matchesPrefix(path, prefix))) continue;
      for (const name of params) if (!sendsParam(code, name)) gaps.add(`${path}|${name}`);
    }
  }

  return [...exempt.keys()].filter((key) => !gaps.has(key)).sort();
}

export function partitionServices(services) {
  const http = [];
  const nonHttp = [];
  for (const svc of services) {
    (servicePrefixes(svc.source).length > 0 ? http : nonHttp).push(svc.file);
  }
  return { http, nonHttp };
}

export function loadServices(root, record) {
  const dir = join(root, 'apps/web/src/app/core');
  record?.('api-query-params', { roots: ['apps/web/src/app/core'], exts: ['.service.ts'] });
  return readdirSync(dir)
    .filter((f) => f.endsWith('.service.ts'))
    .map((f) => ({
      file: `apps/web/src/app/core/${f}`,
      source: readFileSync(join(dir, f), 'utf8'),
    }));
}
