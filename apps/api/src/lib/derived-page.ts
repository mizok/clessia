/**
 * 推導條件下的切頁：**先篩完再切，`total` 是篩後的全體筆數。**
 *
 * 為什麼需要它：像「帳單繳清了沒」這種推導值 DB 濾不掉，只能撈回來自己篩。這時
 * 分頁必須在記憶體裡做，而**最容易寫錯的就是 total** —— 在切頁之後才數，回的是當頁
 * 筆數，除了最後一頁以外永遠等於 pageSize，前端算出來的總頁數就永遠是 1 或 2。
 *
 * 這個函式存在的理由就是把那個順序固定下來，讓它有地方被測。
 */
export function sliceDerivedPage<T>(
  rows: T[],
  page: number,
  pageSize: number,
): { rows: T[]; total: number } {
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
  };
}
