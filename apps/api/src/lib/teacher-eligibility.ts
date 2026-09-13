import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 一位老師能不能被指到「某個分校的某個科目」的課堂上。
 *
 * ## 為什麼是一支共用函式
 *
 * 這個判準原本只寫在 `POST /sessions/{id}/substitute` 裡（代課），
 * 而**排課（`PUT /classes/{id}/schedules/{sid}`）完全不驗** —— 三處讀同一張表、一處漏（#854）。
 * 後果：行政可以把 A 校老師排進 B 校的課，**那堂課從此找不到代課老師**
 * （代課的候選讀 `staff_campuses`）—— 而畫面上那堂課看起來完全正常。
 *
 * **兩處各自推論同一件事就會分岔一次**（#815 的教訓），所以判準只有一份，住在這裡。
 *
 * ## 四項檢查，順序是刻意的
 *
 * 1. `staff` 存在且 `status = 'active'` —— 離職的人不該被排課
 * 2. 那個 user 有 `teacher` 角色 —— `staff` 也可能只是行政
 * 3. `staff_subjects` 含這門課的科目
 * 4. `staff_campuses` 含這個班的分校 ← **#849 / #854 的核心**
 *
 * 先查 1、2 是因為它們一次查一列；3、4 是集合比對，放後面讓前面的快速失敗先走。
 *
 * ## 為什麼回 reason 而不是只回 boolean
 *
 * 錯誤訊息要指路。「不符合資格」對使用者是個死結 ——
 * 他需要知道是「沒被指派到這個分校」還是「沒有這個科目」，因為那決定他去人員管理改哪一欄。
 */
export interface TeacherEligibilityInput {
  /** `staff.id`（**不是** `user_id`）—— `schedules.teacher_id` 與 `substituteTeacherId` 都是這個 */
  readonly staffId: string;
  readonly orgId: string;
  readonly campusId: string;
  readonly subjectId: string;
}

export type TeacherEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: string }
  | { readonly eligible: false; readonly dbError: string };

export async function checkTeacherEligibility(
  supabase: SupabaseClient,
  input: TeacherEligibilityInput,
): Promise<TeacherEligibility> {
  const { data: staffRow, error: staffError } = await supabase
    .from('staff')
    .select('id, user_id, status')
    .eq('org_id', input.orgId)
    .eq('id', input.staffId)
    .maybeSingle();

  if (staffError) return { eligible: false, dbError: staffError.message };
  if (!staffRow || (staffRow['status'] as string | null) !== 'active') {
    return { eligible: false, reason: '這位人員不在職' };
  }

  const userId = staffRow['user_id'] as string | null;
  if (!userId) return { eligible: false, reason: '這位人員沒有帳號' };

  const { data: roleRow, error: roleError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'teacher')
    .maybeSingle();

  if (roleError) return { eligible: false, dbError: roleError.message };
  if (!roleRow) return { eligible: false, reason: '這位人員不是任課老師' };

  const [{ data: subjectRows, error: subjectError }, { data: campusRows, error: campusError }] =
    await Promise.all([
      supabase.from('staff_subjects').select('subject_id').eq('staff_id', input.staffId),
      supabase.from('staff_campuses').select('campus_id').eq('staff_id', input.staffId),
    ]);

  if (subjectError) return { eligible: false, dbError: subjectError.message };
  if (campusError) return { eligible: false, dbError: campusError.message };

  const hasSubject = (subjectRows ?? []).some((row) => row['subject_id'] === input.subjectId);
  if (!hasSubject) {
    return { eligible: false, reason: '這位老師沒有這門課的科目，請先到人員管理指派科目' };
  }

  const hasCampus = (campusRows ?? []).some((row) => row['campus_id'] === input.campusId);
  if (!hasCampus) {
    // **這一格是 #849 的成因**：他在那個分校教課，但 `staff_campuses` 沒有該校的列。
    // 訊息要說得出「去哪裡改」——「不符合資格」本身是個死結。
    return { eligible: false, reason: '這位老師未被指派到本分校，請先到人員管理指派分校' };
  }

  return { eligible: true };
}
