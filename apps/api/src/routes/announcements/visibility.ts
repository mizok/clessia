/**
 * 一則公告該不該出現在某個人的收件匣。
 *
 * 抽成純函式的理由跟前幾支範圍限制一樣：錯的方式很安靜。漏掉分校條件的話，
 * 甲分校的老師會收到乙分校的公告，而畫面上完全看不出來哪裡不對。
 */
export type Audience = 'all_teachers' | 'all_parents';

export interface AnnouncementRow {
  readonly campus_id: string | null;
  readonly audience: Audience;
}

export interface ViewerContext {
  readonly roles: readonly string[];
  /**
   * 前端目前選定的身分（見 `lib/active-role.ts`）。同時是老師又是家長的人切到
   * 家長身分時要看到家長的收件匣，不是角色陣列裡排比較前面的那個 ——
   * 見 kb/wiki/architecture/parent-data-scope.md 第四節、#291。
   */
  readonly activeRole?: string | null;
  /** 這個人隸屬的分校；管理員不受分校限制所以不看這個 */
  readonly campusIds: readonly string[];
}

/**
 * 這個角色的收件匣要看哪個 audience；不是收件人角色就回 null。
 *
 * **`activeRole` 找得到就用它，找不到才退回 `roles` 陣列的優先序** —— 後者是
 * 舊行為的相容路徑（呼叫端沒有 activeRole 資訊時，例如尚未接線的呼叫點）。
 */
export function audienceFor(roles: readonly string[], activeRole?: string | null): Audience | null {
  const role =
    activeRole ??
    (roles.includes('teacher') ? 'teacher' : roles.includes('parent') ? 'parent' : null);
  if (role === 'teacher') return 'all_teachers';
  if (role === 'parent') return 'all_parents';
  return null;
}

export function canSee(row: AnnouncementRow, viewer: ViewerContext): boolean {
  const audience = audienceFor(viewer.roles, viewer.activeRole);
  if (!audience || row.audience !== audience) return false;

  // 全分校公告人人看得到；指定分校的只有該分校的人看得到
  return row.campus_id === null || viewer.campusIds.includes(row.campus_id);
}

/**
 * 收件匣的分校過濾條件（PostgREST 的 `.or()` 字串）。
 *
 * **收件匣與「全部標為已讀」必須用同一份條件** —— 兩邊各長一份的話，
 * 「全部已讀」會標到看不見的公告（多標），或漏掉看得見的（少標，而使用者按完
 * 還是紅點）。兩種都不會報錯，都要等使用者抱怨才發現。
 */
export function campusOrFilter(campusIds: readonly string[]): string {
  return campusIds.length > 0
    ? `campus_id.is.null,campus_id.in.(${campusIds.join(',')})`
    : 'campus_id.is.null';
}
