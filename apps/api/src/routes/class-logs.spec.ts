import { describe, it, expect } from 'vitest';
import { toClassLogResponse } from './class-logs';

/**
 * 教務日誌是班級×日期層級，`published_at` 是廣播扳機：
 * NULL = 草稿，有值 = 已發布（家長端可見、P4 接上推播）。
 * 見 kb/wiki/rules/teaching-log-rules.md。
 */
const DRAFT = {
  id: 'log-1',
  class_id: 'class-1',
  log_date: '2026-08-29',
  teaching_record: '第三章 一元二次方程式，講到公式解。',
  homework: '習作 p.42-45，週四小考。',
  last_edited_by: 'user-teacher',
  published_at: null,
  classes: { name: '數學班 A' },
  editor: { name: '林老師' },
};

describe('toClassLogResponse', () => {
  it('把 snake_case 的 DB 列轉成 camelCase 回應', () => {
    expect(toClassLogResponse(DRAFT)).toEqual({
      id: 'log-1',
      classId: 'class-1',
      className: '數學班 A',
      logDate: '2026-08-29',
      teachingRecord: '第三章 一元二次方程式，講到公式解。',
      homework: '習作 p.42-45，週四小考。',
      lastEditedByName: '林老師',
      publishedAt: null,
      isPublished: false,
    });
  });

  /** 草稿與已發布的差別只有 published_at 有沒有值 —— 沒有第二個狀態欄位 */
  it('published_at 有值就是已發布', () => {
    const published = { ...DRAFT, published_at: '2026-08-29T10:00:00Z' };

    const result = toClassLogResponse(published);

    expect(result.isPublished).toBe(true);
    expect(result.publishedAt).toBe('2026-08-29T10:00:00Z');
  });

  /**
   * 教學紀錄預設內部、作業安排家長可見（rules 4）。兩欄分開存就是為了將來能分開放行，
   * 所以 homework 為空時不能拿 teaching_record 去頂。
   */
  it('作業可以是空的，不會被教學紀錄頂替', () => {
    const noHomework = { ...DRAFT, homework: '' };

    const result = toClassLogResponse(noHomework);

    expect(result.homework).toBe('');
    expect(result.teachingRecord).toBe(DRAFT.teaching_record);
  });

  it('關聯資料缺漏時給 null', () => {
    const bare = { ...DRAFT, classes: null, editor: null };

    const result = toClassLogResponse(bare);

    expect(result.className).toBeNull();
    expect(result.lastEditedByName).toBeNull();
  });
});
