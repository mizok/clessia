import { describe, expect, it } from 'vitest';

import { toEnrollmentResponse } from './enrollments';

/**
 * #1314 SD1：報名列帶班的上課時段與老師（學生檔案「這學期的課」）。
 * 結束的時段用遠古日期，不靠今天 —— 避免時間炸彈（`npm run test:timetravel`）。
 */
const row = (schedules: unknown[] | undefined) => ({
  id: 'e1',
  status: 'active',
  classes: { name: '國一數學', schedules },
});

describe('toEnrollmentResponse —— classSchedule／teacherName（#1314 SD1）', () => {
  it('只取有效時段、依星期與時間排、時間取到分', () => {
    const res = toEnrollmentResponse(
      row([
        {
          weekday: 5,
          start_time: '19:00:00',
          end_time: '21:00:00',
          effective_to: null,
          staff: { display_name: '王老師' },
        },
        {
          weekday: 2,
          start_time: '18:30:00',
          end_time: '20:30:00',
          effective_to: '2999-12-31',
          staff: { display_name: '李老師' },
        },
        {
          weekday: 2,
          start_time: '09:00:00',
          end_time: '10:00:00',
          effective_to: '2000-01-01',
          staff: { display_name: '舊老師' },
        },
        {
          weekday: 2,
          start_time: '14:00:00',
          end_time: '15:00:00',
          effective_to: null,
          staff: { display_name: '王老師' },
        },
      ]),
    );

    expect(res.classSchedule).toEqual([
      { weekday: 2, startTime: '14:00', endTime: '15:00', teacherName: '王老師' },
      { weekday: 2, startTime: '18:30', endTime: '20:30', teacherName: '李老師' },
      { weekday: 5, startTime: '19:00', endTime: '21:00', teacherName: '王老師' },
    ]);
    // 去重、依時段順序
    expect(res.teacherName).toBe('王老師、李老師');
  });

  it('沒指派老師 → teacherName null；select 沒帶 schedules → 空陣列', () => {
    const unassigned = toEnrollmentResponse(
      row([
        {
          weekday: 1,
          start_time: '10:00:00',
          end_time: '11:00:00',
          effective_to: null,
          staff: null,
        },
      ]),
    );
    expect(unassigned.classSchedule[0]?.teacherName).toBeNull();
    expect(unassigned.teacherName).toBeNull();

    const none = toEnrollmentResponse(row(undefined));
    expect(none.classSchedule).toEqual([]);
    expect(none.teacherName).toBeNull();
  });
});
