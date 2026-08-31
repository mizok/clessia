/**
 * 這堂課是不是代課。
 *
 * 定義：**實際上的老師（`sessions.teacher_id`）跟課表排定的老師
 * （`schedules.teacher_id`）不一致**。
 *
 * 抽成函式是因為它有兩個容易搞錯的邊界，而且兩個都往同一個方向倒：
 * 資料不全時**不是**代課。誤標代課會讓老師以為自己在代別人的課，比漏標更擾人。
 */
export function isSubstituteSession(input: {
  sessionTeacherId: string | null;
  /** 臨時加開的課堂沒有 schedule，也就沒有排定老師可比 */
  scheduleTeacherId: string | null;
}): boolean {
  if (!input.sessionTeacherId || !input.scheduleTeacherId) return false;

  return input.sessionTeacherId !== input.scheduleTeacherId;
}
