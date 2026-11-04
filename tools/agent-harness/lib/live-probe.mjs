/**
 * 部署後帶身分的列表探針（#1435 第 2 項，`deploy.yml` 的 probe-api job 用）。
 *
 * 原本 verify-live 只打未登入的端點，401 擋在查詢之前 —— #1423 的 select／order 不一致上線回 400，
 * 部署照樣全綠。這支用一個**唯讀的探針帳號**（admin 角色、`permissions` 不含任何寫入權限）
 * 打幾支列表，全部 200 才算過。
 *
 * 三分法（計畫席 11-04，審核席 #2276 抓到「打不通也回滾」）：
 *
 * | 判定 | 條件 | 動作 |
 * | --- | --- | --- |
 * | `auth` | 任何一支 401／403 | 紅、**不回滾** —— 探針憑證的問題（cookie 過期、帳號停用、權限不夠） |
 * | `broken` | 其餘任何真的 HTTP 錯誤（5xx，含 `/api/me` 自己 500；也含 #1423 那種 400 等 4xx） | 紅、**回滾** |
 * | `unknown` | 只有打不通（0：逾時、DNS、連線錯） | 紅、**不回滾** —— runner 的網路問題不該退部署 |
 *
 * 混在一起時照表的順序：有 401／403 就是 auth（身分不對，其他結果沒有意義）；伺服器真的回了錯就是 broken
 * （真訊號，就算同時有幾支打不通）。
 */

/** 唯讀帳號讀得到的列表（讀取只要 admin 角色，不吃細部權限；invoices 連讀都要 manage_finance，不放） */
export const PROBE_PATHS = [
  '/api/courses',
  '/api/classes?pageSize=1',
  '/api/students?pageSize=1',
  '/api/staff?pageSize=1',
  '/api/parents?pageSize=1',
  '/api/academy-exams?pageSize=1',
  '/api/attendance/sessions?pageSize=1',
];

const isAuthProblem = (status) => status === 401 || status === 403;

/** 重試：不是 200 的再打幾次、間隔多久（毫秒），用最後一次定案 */
export const RETRIES = 2;
export const RETRY_INTERVAL_MS = 5_000;

/**
 * @param {number} meStatus `GET /api/me` 的狀態碼（打不通 = 0）
 * @param {Array<{ path: string, status: number }>} lists
 * @returns {{ kind: 'ok' | 'auth' | 'broken' | 'unknown', failed: Array<{ path: string, status: number }> }}
 */
export function classifyProbe(meStatus, lists) {
  const all = [{ path: '/api/me', status: meStatus }, ...lists];
  const failed = all.filter((r) => r.status !== 200);
  if (failed.length === 0) return { kind: 'ok', failed };
  if (failed.some((r) => isAuthProblem(r.status))) return { kind: 'auth', failed };
  if (failed.some((r) => r.status !== 0)) return { kind: 'broken', failed };
  return { kind: 'unknown', failed };
}
