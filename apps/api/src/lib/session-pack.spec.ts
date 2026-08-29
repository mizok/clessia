import { describe, expect, it } from 'vitest';

import { countDeductedSessions, remainingSessions } from './session-pack';

const packs = (...counts: number[]) => counts.map((purchasedCount) => ({ purchasedCount }));

describe('countDeductedSessions', () => {
  it('出席扣堂', () => {
    expect(countDeductedSessions(['present', 'present'], false)).toBe(2);
  });

  // 曠課（沒說一聲）照扣 —— 學生佔了那個位子沒來，堂數照消耗。這件事沒有爭議，
  // 所以它不是設定值
  it('缺席一律扣，不看開關', () => {
    expect(countDeductedSessions(['absent'], false)).toBe(1);
    expect(countDeductedSessions(['absent'], true)).toBe(1);
  });

  /**
   * 請假是**唯一**的結構化決定（billing-rules 規則 8）—— 各家做法不同，所以是
   * 班級層級的開關 `classes.leave_deducts_session`。
   */
  it('請假看開關', () => {
    expect(countDeductedSessions(['on_leave'], false)).toBe(0);
    expect(countDeductedSessions(['on_leave'], true)).toBe(1);
  });

  it('混合狀態', () => {
    const statuses = ['present', 'absent', 'on_leave', 'present'] as const;

    expect(countDeductedSessions([...statuses], false)).toBe(3);
    expect(countDeductedSessions([...statuses], true)).toBe(4);
  });

  it('沒有出勤記錄就是沒扣', () => {
    expect(countDeductedSessions([], true)).toBe(0);
  });
});

describe('remainingSessions', () => {
  it('多包相加再扣', () => {
    expect(remainingSessions(packs(10, 5), ['present', 'present'], false)).toBe(13);
  });

  /**
   * **剩餘可以是負數，不要 clamp 到 0。** 規則 1：堂數用完不硬擋上課，剩餘 ≤ 0 時
   * 警示行政追補買。clamp 掉的話「超上了三堂」會顯示成「剛好用完」，該追的補買就
   * 追不到了 —— 那正是這個數字存在的理由。
   */
  it('超上會變負數，不能被壓成 0', () => {
    expect(remainingSessions(packs(2), ['present', 'present', 'present'], false)).toBe(-1);
  });

  it('還沒買過任何一包', () => {
    expect(remainingSessions([], ['present'], false)).toBe(-1);
  });
});
