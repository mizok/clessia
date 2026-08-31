import { describe, expect, it } from 'vitest';

import { countExamsBySession, sessionExamKey } from './session-exams';

describe('countExamsBySession', () => {
  it('counts multiple exams for the same class on the same day', () => {
    const counts = countExamsBySession([
      { class_id: 'class-1', exam_date: '2026-04-01' },
      { class_id: 'class-1', exam_date: '2026-04-01' },
      { class_id: 'class-1', exam_date: '2026-04-02' },
      { class_id: 'class-2', exam_date: '2026-04-01' },
    ]);

    expect(counts.get(sessionExamKey('class-1', '2026-04-01'))).toBe(2);
    expect(counts.get(sessionExamKey('class-1', '2026-04-02'))).toBe(1);
    expect(counts.get(sessionExamKey('class-2', '2026-04-01'))).toBe(1);
  });

  it('does not let one class bleed into another class on the same day', () => {
    const counts = countExamsBySession([{ class_id: 'class-1', exam_date: '2026-04-01' }]);

    expect(counts.get(sessionExamKey('class-2', '2026-04-01'))).toBeUndefined();
  });

  it('skips rows with no class or no date instead of inventing a key', () => {
    const counts = countExamsBySession([
      { class_id: '', exam_date: '2026-04-01' },
      { class_id: 'class-1', exam_date: '' },
    ]);

    expect(counts.size).toBe(0);
  });
});
