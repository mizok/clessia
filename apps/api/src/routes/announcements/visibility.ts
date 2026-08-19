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
  /** 這個人隸屬的分校；管理員不受分校限制所以不看這個 */
  readonly campusIds: readonly string[];
}

/** 這個角色的收件匣要看哪個 audience；不是收件人角色就回 null */
export function audienceFor(roles: readonly string[]): Audience | null {
  if (roles.includes('teacher')) return 'all_teachers';
  if (roles.includes('parent')) return 'all_parents';
  return null;
}

export function canSee(row: AnnouncementRow, viewer: ViewerContext): boolean {
  const audience = audienceFor(viewer.roles);
  if (!audience || row.audience !== audience) return false;

  // 全分校公告人人看得到；指定分校的只有該分校的人看得到
  return row.campus_id === null || viewer.campusIds.includes(row.campus_id);
}
