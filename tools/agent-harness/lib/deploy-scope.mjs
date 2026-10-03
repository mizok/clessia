/**
 * 自動部署的範圍判斷（#1283，`deploy.yml` 的 plan job 用）。
 *
 * 給「上次成功部署 → 這次要部署」之間改到的檔案，決定 api／web 各要不要部署。
 * **純文件、工具、migration 一律不觸發部署** —— migration 歸 `migrate.yml` 管，
 * kb／herdr-team／tools 不在任何產物裡。
 *
 * 寧可多部署也不要漏：root 的 `package.json`／lockfile 與 `packages/`（前後端共用型別與驗證）
 * 兩邊都算。重複部署同一份程式碼是冪等的；漏部署是線上跑舊碼而沒人知道。
 */

const SHARED = [/^packages\//, /^package(-lock)?\.json$/];
const API = [/^apps\/api\//, ...SHARED];
const WEB = [/^apps\/web\//, ...SHARED];

/** 測試檔不進任何產物 —— 只改 spec 不必部署 */
const isTest = (file) => /\.spec\.ts$|\.test\.(m?js|ts)$/.test(file);

/**
 * @param {string[]} files `git diff --name-only <上次部署>..<這次>` 的輸出
 * @returns {{ api: boolean, web: boolean, apiFiles: string[], webFiles: string[] }}
 */
export function deployScope(files) {
  const relevant = files.filter((file) => file && !isTest(file));
  const apiFiles = relevant.filter((file) => API.some((re) => re.test(file)));
  const webFiles = relevant.filter((file) => WEB.some((re) => re.test(file)));
  return { api: apiFiles.length > 0, web: webFiles.length > 0, apiFiles, webFiles };
}

/**
 * 從 run 標題撈出最後一個 40 字元 SHA。
 * deploy 的標題是 `deploy @ <migrate 的標題 或 dispatch 的 SHA>`，migrate 的標題是 `migrate @ <sha>`，
 * 所以「最後一個 SHA」就是要部署的那一顆。撈不到回 `null`。
 */
export function shaFromTitle(title) {
  const all = String(title ?? '').match(/\b[0-9a-f]{40}\b/g);
  return all ? all[all.length - 1] : null;
}
