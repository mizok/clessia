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
    '教務日誌 v1a 沒有發布（發布不可逆而下游都還不存在，見 architecture/teacher-class-log.md），前端只查「這一班這一天」，不需要分草稿/已發布。v1b 啟用發布時要把這一筆拿掉',
  ],
  // 家長端三支讀取端點（出缺席／成績／繳費）是 API 先行交付，前端消費端排在
  // P4 家長頁面（見 kb/wiki/architecture/parent-read-endpoints.md）。/api/me 的
  // 字首已經被 auth.service.ts / api.service.ts 認領（它們打 /api/me 拿 profile），
  // 這支只是把新子路徑掛在同一個字首下，不代表那兩支 service 要負責這些參數 ——
  // 真正的消費端是還沒生出來的 attendance/grades/billing.service.ts。
  // **這批不是永久決定，是排序**：前端 PR 落地時要把這裡對應的幾筆一起刪掉，
  // 不是新增更多。
  ['/api/me/attendance|childId', '家長端出缺席端點 API 先行，前端消費端排在 P4，見上方說明'],
  ['/api/me/attendance|dateFrom', '同上'],
  ['/api/me/attendance|dateTo', '同上'],
  ['/api/me/attendance|page', '同上'],
  ['/api/me/attendance|pageSize', '同上'],
  ['/api/me/grades|childId', '家長端成績端點 API 先行，前端消費端排在 P4，見上方說明'],
  ['/api/me/grades|dateFrom', '同上'],
  ['/api/me/grades|dateTo', '同上'],
  ['/api/me/grades|page', '同上'],
  ['/api/me/grades|pageSize', '同上'],
  ['/api/me/billing|childId', '家長端繳費端點 API 先行，前端消費端排在 P4，見上方說明'],
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
  // #361（design-web 告警系統統一設計）的 API 側前置：/api/sessions 補
  // attendanceTaken 與 endedOnly 是為了讓儀表板的「未點名課堂」深連結、sessions
  // 頁自己的「今日未點名」pill 表達得出同一個概念。前端消費端（StatCard.queryParams、
  // sessions.page.ts 讀 ActivatedRoute、拔掉 countUntakenSessions）是 design-web
  // 那半，卡在這支之後。**這不是永久決定，是排序**——design-web 接上時要把這兩筆
  // 拿掉，不是新增更多。
  ['/api/sessions|attendanceTaken', '#361 API 先行，design-web 的前端半緊接著接上，見上方說明'],
  ['/api/sessions|endedOnly', '同上'],
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
      stdio: ['ignore', 'pipe', 'ignore'],
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
