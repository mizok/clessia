/**
 * 這筆出勤紀錄是誰記的 —— 寫進 `attendance_records.recorded_by_role`。
 *
 * **這一欄原本三個人工寫入點都寫死 `'admin'`**，即使按下按鈕的是老師（#106 之後
 * 老師也能點名）。於是這一欄的實際語意變成「有人透過出勤 UI 按的」，跟角色無關 ——
 * 而它看起來像角色，將來拿它做稽核或分流會得到錯的答案。
 *
 * `roles` 是陣列（一個人可以同時是管理員與老師），這一欄是單一值，所以要取一個。
 * **admin 優先**，跟 `lib/teacher-scope.ts` 的 `resolveTeachingScope` 同一個優先序 ——
 * 那裡管理員也壓過老師。兩個地方對「這個人算什麼」給不同答案的話，
 * 稽核紀錄會跟權限判斷對不上。
 *
 * `'system'` 不從這裡來：那是自動寫入（掃碼、請假連動、報名連動）自己寫死的，
 * 它們沒有操作者。
 */
export function resolveRecordedByRole(roles: readonly string[]): 'admin' | 'teacher' {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('teacher')) return 'teacher';

  // 出勤路由掛在 `['admin', 'teacher']` 底下，走到這裡代表 middleware 的角色檢查
  // 跟這裡看到的東西對不上。與其記一個假的角色，不如讓它壞掉 ——
  // 稽核欄位寫錯比寫不進去難發現得多。
  throw new Error(`無法判斷出勤紀錄的記錄者角色：roles=${JSON.stringify(roles)}`);
}
