/**
 * 老師能動哪些考試。
 *
 * 2026-08-30 裁決（設計文件：`.claude/team/billing-api-p3-grades-scope-design.md`）：
 *
 * | | 老師的權限 |
 * | --- | --- |
 * | `academy_exams`（校內考） | **自己建的**可改／刪／關閉；別人建的只能登錄成績 |
 * | `school_exams`（學校段考） | 考試本體**唯讀** —— 它是機構層目錄不是老師的東西；成績照樣登錄 |
 *
 * 為什麼別人建的不能動：一場考試可以跨班（`academy_exam_classes`），刪除會 CASCADE
 * 掉其他班的成績。做這件事的人必須看得到全部影響範圍，而老師依定義看不到自己不任課
 * 的班。「只能編自己建的」的代價（管理員建錯要找管理員改）是**罕見**的；
 * 「可編自己任課班的全部」的越權是**每次都在**。
 */

export interface AcademyExamScopeInput {
  readonly roles: readonly string[];
  readonly userId: string;
  /** `academy_exams.created_by`。舊資料可能是 null（建立者帳號被刪） */
  readonly createdBy: string | null;
}

export function canManageAcademyExam(input: AcademyExamScopeInput): boolean {
  if (input.roles.includes('admin')) return true;
  // fail-closed：createdBy 是 null 時老師動不了。不確定的時候放行正是授權的洞長出來的地方
  if (input.roles.includes('teacher'))
    return Boolean(input.createdBy) && input.createdBy === input.userId;
  return false;
}

/**
 * 機構層的考試目錄（`school_exams`）只有管理員能動。
 *
 * 它沒有 `created_by`、沒有班級關聯 —— 是「學年 × 學期 × 考試類型」的參照資料。
 * 兩個老師各自建一筆「第一次段考」只會製造重複。
 */
export function canManageOrgExam(roles: readonly string[]): boolean {
  return roles.includes('admin');
}

export type ExamClassResolution = { classIds: string[] } | { error: string };

/**
 * 考試的參加班級要改成什麼。
 *
 * 兩條邊界（跟 A3 一起釘的）：
 * - **不能加自己沒任課的班** —— 沒有這條，「老師可以建考試」就變成「老師可以把任何班
 *   拉進自己的考試」，而那看起來完全像正常操作
 * - **不能移除自己沒任課的班** —— 管理員事後把別班加進來，老師把它踢掉會刪掉別班的成績
 *
 * 兩種違規都**明著回錯誤**，不默默修正 —— 默默補回去的話老師會以為自己移除成功了。
 */
export function resolveExamClassIds(input: {
  isAdmin: boolean;
  /** 目前的參加班級（新建時是空陣列） */
  current: readonly string[];
  requested: readonly string[];
  /** 這位老師固定任課的班 */
  taught: readonly string[];
}): ExamClassResolution {
  if (input.isAdmin) return { classIds: [...input.requested] };

  const taught = new Set(input.taught);
  const current = new Set(input.current);

  for (const classId of input.requested) {
    if (!taught.has(classId) && !current.has(classId)) {
      return { error: 'CLASS_NOT_TAUGHT' };
    }
  }

  for (const classId of input.current) {
    if (!taught.has(classId) && !input.requested.includes(classId)) {
      return { error: 'CANNOT_REMOVE_OTHERS_CLASS' };
    }
  }

  return { classIds: [...input.requested] };
}
