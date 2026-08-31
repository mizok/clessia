import { describe, expect, it } from 'vitest';

import { isSubstituteSession } from './session-substitute';

describe('isSubstituteSession', () => {
  /**
   * 代課的定義是**這堂課實際上的老師（`sessions.teacher_id`）跟課表排定的老師
   * （`schedules.teacher_id`）不一致**。兩個欄位都要拿到才判斷得出來 ——
   * 原本的 API 兩個都沒回，`teacherName` 還寫死 null，所以前端無論如何都做不出這件事。
   */
  it('實際老師與排定老師不同 → 代課', () => {
    expect(isSubstituteSession({ sessionTeacherId: 't2', scheduleTeacherId: 't1' })).toBe(true);
  });

  it('兩者相同 → 不是代課', () => {
    expect(isSubstituteSession({ sessionTeacherId: 't1', scheduleTeacherId: 't1' })).toBe(false);
  });

  /**
   * 臨時加開的課堂沒有 `schedule_id`，也就沒有「排定的老師」可以比 ——
   * **沒有基準就不是代課**，不是「未知」也不是 true。標成代課會讓每一堂臨時課
   * 都掛著代課標籤。
   */
  it('沒有排定老師（臨時課堂）→ 不是代課', () => {
    expect(isSubstituteSession({ sessionTeacherId: 't1', scheduleTeacherId: null })).toBe(false);
  });

  // 資料不全時往「不是代課」倒 —— 誤標代課會讓老師以為自己在代別人的課
  it('實際老師從缺 → 不是代課', () => {
    expect(isSubstituteSession({ sessionTeacherId: null, scheduleTeacherId: 't1' })).toBe(false);
    expect(isSubstituteSession({ sessionTeacherId: null, scheduleTeacherId: null })).toBe(false);
  });
});
