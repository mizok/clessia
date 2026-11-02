// A7c 的第二種觸發（#2139）：經由學生才連到分校的 ADMIN 路由。
//
// A7c 原本只掃字面有 `campus_id`／`campusId` 的檔。以學生為主體、自己不存 campus_id 的路由
// （分校要經 students → enrollments → classes.campus_id 才推得出來）完全不在範圍裡 ——
// #2138 的 meals.ts 就是這樣一路綠燈、受限分校的管理員讀得到全機構的餐費。

/**
 * 判斷「有接分校範圍」的識別字。**不分大小寫**（#2139 計畫席 11-02）：範圍 helper 收的是 `CampusScope` 型別、
 * 呼叫 `resolveCampusScope`，只認小寫開頭的 `campusScope` 會把 helper 本身當成沒接（#515 也栽在識別字大小寫）
 */
export const SCOPE_IDENTIFIERS = /campusFilterIds|campusScope|getCampusScope/i;
/**
 * 家長的範圍守門：家長沒有「分校範圍」，範圍是自己的孩子（`childDb`、`isChildAllowed`，
 * kb/wiki/architecture/parent-data-scope.md）。**只用在 A7c 原本那條（碰 campus_id）**；ADMIN＋碰學生那條不吃它 ——
 * 一支 ANY_ROLE 路由的家長分支用 childDb，不代表管理員分支有接分校範圍（notifications 因此仍列在例外帳本）
 */
export const PARENT_SCOPE_IDENTIFIERS = /\bchildDb\b|\bisChildAllowed\b/;
/** 碰分校：A7c 原本那條的觸發 */
export const TOUCHES_CAMPUS = /campus_id|campusId/;
/** 碰學生：`student_id` 欄位，或直接查 students 表 */
export const TOUCHES_STUDENTS = /student_id|\.from\(\s*['"]students['"]\s*\)/;

const ROLE_CONSTS = { ADMIN_ONLY: ['admin'], ANY_ROLE: ['admin', 'teacher', 'parent'] };

/**
 * index.ts 裡角色含 admin 的掛載 → [{ path, spec }]（spec 是 import 的相對路徑，例如 `./routes/meals`）。
 * 認 `mount('/api/x', xRoute, ADMIN_ONLY | ANY_ROLE | ['admin', …], …)`；`app.route` 直接掛的（公開頁、
 * cron）沒有角色，不算 ADMIN。
 */
export function adminMounts(indexSource) {
  const imports = new Map();
  for (const m of indexSource.matchAll(
    /import\s+(?:(\w+)|\{\s*(\w+)\s*\})\s+from\s+['"](\.\/routes\/[^'"]+)['"]/g,
  ))
    imports.set(m[1] ?? m[2], m[3]);
  const out = [];
  for (const m of indexSource.matchAll(
    /\bmount\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*,\s*(\w+|\[[^\]]*\])/g,
  )) {
    const [, path, ident, rolesExpr] = m;
    const roles = rolesExpr.startsWith('[')
      ? [...rolesExpr.matchAll(/['"](\w+)['"]/g)].map((r) => r[1])
      : (ROLE_CONSTS[rolesExpr] ?? []);
    if (!roles.includes('admin')) continue;
    const spec = imports.get(ident);
    if (spec) out.push({ path, spec });
  }
  return out;
}

/** 所有掛載（`mount` 與 `app.route`，不分角色）→ [{ path, spec }] —— A7c 原本那條從這裡出發（#2139） */
export function allMounts(indexSource) {
  const imports = new Map();
  for (const m of indexSource.matchAll(
    /import\s+(?:(\w+)|\{\s*(\w+)\s*\})\s+from\s+['"](\.\/routes\/[^'"]+)['"]/g,
  ))
    imports.set(m[1] ?? m[2], m[3]);
  const out = [];
  for (const m of indexSource.matchAll(
    /\b(?:mount|app\.route)\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g,
  )) {
    const spec = imports.get(m[2]);
    if (spec) out.push({ path: m[1], spec });
  }
  return out;
}

/** 原始碼裡的相對 import（`./x`、`../y`）—— 沿著它把掛載的檔與它用到的 routes/ 子檔串起來 */
export const relativeImports = (source) =>
  [...source.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]);

/**
 * A7c 原本那條，**每個檔自己**看（#2139 計畫席 11-02：整串一起看太鬆 —— `me.ts` 一處提到範圍，底下 8 支家長子路由
 * 就全部過關）：字面碰 campus_id，自己卻沒有分校範圍、也沒有家長範圍的識別字 → 回傳。
 * `files` 是 [{ file, source }]（掛載串到的全部檔，去重過）。
 */
export function unscopedCampusFiles(files) {
  return files
    .filter(
      ({ source }) =>
        TOUCHES_CAMPUS.test(source) &&
        !SCOPE_IDENTIFIERS.test(source) &&
        !PARENT_SCOPE_IDENTIFIERS.test(source),
    )
    .map(({ file }) => file);
}

/**
 * 碰學生、卻全檔（目錄型路由是整個目錄）沒有分校範圍識別字的 ADMIN 路由。
 * `sourceOf(spec)` 回那支路由的原始碼（目錄就把底下的檔串起來）；回 null＝找不到檔，跳過。
 */
export function unscopedStudentRoutes(mounts, sourceOf) {
  const out = [];
  for (const { path, spec } of mounts) {
    const source = sourceOf(spec);
    if (source == null) continue;
    if (TOUCHES_STUDENTS.test(source) && !SCOPE_IDENTIFIERS.test(source)) out.push({ path, spec });
  }
  return out;
}
