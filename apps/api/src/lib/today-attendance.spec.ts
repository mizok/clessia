import { describe, expect, it, vi } from 'vitest';

import { DAILY_ATTENDANCE_SQL, loadDailyAttendance, type TodaySession } from './today-attendance';

/**
 * 日到班「今天該有誰、誰到了、誰請假」（#1314 SL1）。原料走一支 pg SQL（#1595 P2 ①）；判準在 JS。
 *
 * - **讀取失敗要失敗，不能當成空的**（#1928）：在籍空＝今天沒人該來、打卡空＝全部「該到沒到」、
 *   請假空＝請假的學生顯示成「該到沒到」。SQL 拋錯或結果形狀不對一律丟例外（呼叫端回 500）
 * - 範圍只吃參數：分校、班（老師）照呼叫端給的傳進去；SQL 的語意（org、停課、生效區間）由
 *   `contract/workbench-today-sql.contract.ts`、`contract/today-attendance.contract.ts` 對真 DB 驗
 */

const DATE = '2026-06-01';
const SESSIONS: TodaySession[] = [
  {
    classId: 'class-1',
    className: 'A 班',
    startTime: '16:00',
    campusId: 'campus-1',
    campusName: '總校',
    status: 'scheduled',
  },
];

const leave = (studentId: string, extra: Record<string, unknown> = {}) => ({
  student_id: studentId,
  submitted_by_role: 'parent',
  reason: '感冒',
  start_date: DATE,
  end_date: DATE,
  start_time: null,
  end_time: null,
  leave_request_sessions: [],
  ...extra,
});

const RAW = {
  enrollments: [
    {
      id: 'en-1',
      student_id: 'stu-1',
      class_id: 'class-1',
      students: { name: '小明', grade: 'J1' },
    },
    {
      id: 'en-2',
      student_id: 'stu-2',
      class_id: 'class-1',
      students: { name: '小華', grade: 'J1' },
    },
  ],
  checkins: [{ id: 'ck-1', student_id: 'stu-1', checked_in_at: '2026-06-01T08:00:00+00:00' }],
  leaves: [leave('stu-2')],
};

const poolReturning = (result: unknown) => ({
  query: vi.fn().mockResolvedValue({ rows: [{ result }] }),
});
const NO_SCOPE = { campusIds: null, classIds: null };

describe('loadDailyAttendance', () => {
  it('應到、到了、請假各自讀到', async () => {
    const res = await loadDailyAttendance(poolReturning(RAW), 'org-1', DATE, SESSIONS, NO_SCOPE);
    expect(res.expected.map((s) => s.studentId).sort()).toEqual(['stu-1', 'stu-2']);
    expect(res.expected[0]).toMatchObject({
      campusName: '總校',
      firstSession: { startTime: '16:00', className: 'A 班' },
    });
    expect(res.arrived).toEqual([
      { studentId: 'stu-1', checkedInAt: '2026-06-01T08:00:00+00:00', checkinId: 'ck-1' },
    ]);
    expect(res.onLeave.map((l) => l.studentId)).toEqual(['stu-2']);
  });

  it('一支 SQL：org、日期、分校、班照呼叫端給的傳（null＝不篩，空陣列照樣傳 → 零筆）', async () => {
    const pool = poolReturning(RAW);
    await loadDailyAttendance(pool, 'org-1', DATE, SESSIONS, {
      campusIds: ['campus-1'],
      classIds: [],
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(DAILY_ATTENDANCE_SQL, [
      'org-1',
      DATE,
      ['campus-1'],
      [],
    ]);
    const unscoped = poolReturning(RAW);
    await loadDailyAttendance(unscoped, 'org-1', DATE, SESSIONS, NO_SCOPE);
    expect(unscoped.query.mock.calls[0]![1]).toEqual(['org-1', DATE, null, null]);
  });

  it('今天的課全部停課 → 沒人該到，不查 DB', async () => {
    const pool = poolReturning(RAW);
    const res = await loadDailyAttendance(
      pool,
      'org-1',
      DATE,
      [{ ...SESSIONS[0]!, status: 'cancelled' }],
      NO_SCOPE,
    );
    expect(res).toEqual({ expected: [], arrived: [], onLeave: [] });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('請假：名單外的人不列；綁定堂次的假看綁的那堂是不是今天', async () => {
    const res = await loadDailyAttendance(
      poolReturning({
        ...RAW,
        leaves: [
          leave('stu-other'),
          leave('stu-1', {
            leave_request_sessions: [
              { session_id: 's-x', sessions: { session_date: '2026-06-02' } },
            ],
          }),
          leave('stu-2', {
            leave_request_sessions: [{ session_id: 's-y', sessions: { session_date: DATE } }],
          }),
        ],
      }),
      'org-1',
      DATE,
      SESSIONS,
      NO_SCOPE,
    );
    expect(res.onLeave.map((l) => l.studentId)).toEqual(['stu-2']);
  });

  it('SQL 拋錯 → 丟例外，不是當成空的', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('boom')) };
    await expect(loadDailyAttendance(pool, 'org-1', DATE, SESSIONS, NO_SCOPE)).rejects.toThrow();
  });

  it.each([
    ['沒有列', undefined],
    ['在籍不是陣列', { ...RAW, enrollments: null }],
    ['打卡不是陣列', { ...RAW, checkins: null }],
    ['請假不是陣列', { ...RAW, leaves: null }],
  ])('結果形狀不對（%s）→ 丟例外', async (_label, result) => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: result ? [{ result }] : [] }) };
    await expect(loadDailyAttendance(pool, 'org-1', DATE, SESSIONS, NO_SCOPE)).rejects.toThrow();
  });
});
