// A7c 的第二種觸發（#2139）：經由學生才連到分校的 ADMIN 路由。
//
// A7c 原本只掃字面有 `campus_id`／`campusId` 的檔。以學生為主體、自己不存 campus_id 的路由
// （分校要經 students → enrollments → classes.campus_id 才推得出來）完全不在範圍裡 ——
// #2138 的 meals.ts 就是這樣一路綠燈、受限分校的管理員讀得到全機構的餐費。

/** 判斷「有接分校範圍」的識別字 —— 跟 A7c 原本那條同一組（識別字改名時兩條一起改） */
export const SCOPE_IDENTIFIERS = /campusFilterIds|campusScope|getCampusScope/;
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
