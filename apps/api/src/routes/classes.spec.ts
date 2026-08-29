import { describe, expect, it, vi } from 'vitest';
import * as classesRoute from './classes';

describe('applyClassDetailScheduleScope', () => {
  it('only scopes schedules by class_id', () => {
    const applyClassDetailScheduleScope = (classesRoute as Record<string, unknown>)[
      'applyClassDetailScheduleScope'
    ] as
      | (<T extends { eq: (column: string, value: unknown) => T }>(query: T, classId: string) => T)
      | undefined;

    expect(applyClassDetailScheduleScope).toBeTypeOf('function');

    const eq = vi.fn();
    const query = { eq } as { eq: (column: string, value: unknown) => typeof query };
    eq.mockReturnValue(query);

    applyClassDetailScheduleScope?.(query, 'class-1');

    expect(eq).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('class_id', 'class-1');
  });
});

/**
 * `classes.uses_contact_book` 是國小／國中模式的開關（contact-book-rules 規則 2）。
 * 欄位在 migration 20260829100000 建好了，但 route 一直沒把它讀出來也沒讓人寫 ——
 * 管理端的班級設定與聯絡簿頁都需要它，沒有這條管線那個欄位等於不存在。
 */
describe('mapClass —— uses_contact_book', () => {
  const mapClass = (classesRoute as Record<string, unknown>)['mapClass'] as
    ((row: Record<string, unknown>) => Record<string, unknown>) | undefined;

  const row = {
    id: 'class-1',
    org_id: 'org-1',
    campus_id: 'campus-1',
    course_id: 'course-1',
    name: '數學班 A',
    max_students: 20,
    next_class_id: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('開了聯絡簿的班回 true', () => {
    expect(mapClass).toBeTypeOf('function');
    expect(mapClass?.({ ...row, uses_contact_book: true })['usesContactBook']).toBe(true);
  });

  // 預設 false（現況全是紙本），而且**不能是 undefined** —— 前端拿 undefined
  // 去畫開關會變成不確定狀態
  it('沒開的班回 false，不是 undefined', () => {
    expect(mapClass?.({ ...row, uses_contact_book: false })['usesContactBook']).toBe(false);
  });

  it('欄位缺席時退回 false', () => {
    expect(mapClass?.(row)['usesContactBook']).toBe(false);
  });
});
