/**
 * 部署後帶身分的列表探針（#1435 第 2 項，`deploy.yml` 的 probe-api job 用）。
 *
 * 原本 verify-live 只打未登入的端點，401 擋在查詢之前 —— #1423 的 select／order 不一致上線回 400，
 * 部署照樣全綠。這支用一個**唯讀的探針帳號**（admin 角色、`permissions` 不含任何寫入權限）
 * 打幾支列表，全部 200 才算過。
 *
 * **401／403 不回滾**：那是探針的憑證（session cookie 過期、帳號被停用、權限不夠）出問題，
 * 不是這次部署壞了 —— 照「紅就回滾」會把好好的部署退掉。只有「身分沒問題、列表卻不是 200」
 * （或打不通）才判 broken、回滾。
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

/**
 * @param {number} meStatus `GET /api/me` 的狀態碼（打不通 = 0）
 * @param {Array<{ path: string, status: number }>} lists
 * @returns {{ kind: 'ok' | 'auth' | 'broken', failed: Array<{ path: string, status: number }> }}
 */
export function classifyProbe(meStatus, lists) {
  const all = [{ path: '/api/me', status: meStatus }, ...lists];
  const failed = all.filter((r) => r.status !== 200);
  if (failed.length === 0) return { kind: 'ok', failed };
  // 任何一支 401／403 → 憑證問題；其餘失敗先不管（身分不對時，列表的結果本來就沒有意義）
  if (failed.some((r) => isAuthProblem(r.status))) return { kind: 'auth', failed };
  return { kind: 'broken', failed };
}
