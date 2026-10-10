import type { Class } from '@core/classes.service';

/**
 * 一個班需不需要人介入（A6 的「需介入 N 個班」以**班**為單位，#1314）。
 *
 * 四種情況任一成立（只看啟用中的班 —— 停用的班不開課，談不上「家長看不到下一堂」）：
 * - 沒有任何時段（`scheduleCount` 0）
 * - 有時段，但**沒有未來的課堂**，而且不是因為整批停課（`upcomingCancelledCount` > 0 的班
 *   是「課都被停掉了」，已經有人處理過）
 * - 有未來課堂還沒指派老師
 * - 有時段衝突（班級衝突或老師衝突）
 *
 * 原因文字（無時段／無未來排程／未指派／衝突）不寫在提醒列 —— 提醒列只講一句；
 * 課程列的 ⚠ tooltip 保留完整原因。
 */
export function classNeedsIntervention(cls: Class): boolean {
  if (!cls.isActive) return false;
  const schedules = cls.scheduleCount ?? 0;
  return (
    schedules === 0 ||
    (!cls.hasUpcomingSessions && (cls.upcomingCancelledCount ?? 0) === 0) ||
    (cls.upcomingUnassignedCount ?? 0) > 0 ||
    (cls.upcomingClassConflictCount ?? 0) + (cls.upcomingTeacherConflictCount ?? 0) > 0
  );
}
