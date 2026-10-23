import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { loadDailyAttendance, type TodaySession } from './today-attendance';

/**
 * **日到班的「今天該有誰、誰到了、誰請假」讀取失敗要失敗，不能當成空的**（#1928）。
 *
 * 原本三支讀取都不看 error：在籍讀失敗 → 今天沒人該來；打卡讀失敗 → 全部「該到沒到」；
 * 請假讀失敗 → 請假的學生顯示成「該到沒到」（作業台會叫行政去追請了假的人）。
 * 失敗一律丟例外，呼叫端（作業台、學生名冊）由全域 onError 回 500。
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

type Result = { data: unknown; error: unknown };
const ok = (data: unknown): Result => ({ data, error: null });
const boom: Result = { data: null, error: { message: 'boom' } };

function fake(results: Partial<Record<string, Result>>, calls: string[] = []) {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      let range: [number, number] | null = null;
      for (const m of ['select', 'eq', 'in', 'lte', 'gte', 'or', 'order'])
        q[m] = (col: unknown) => (calls.push(`${table}.${m}(${String(col)})`), q);
      // 照 PostgREST 切頁（max_rows 1000）：沒下 range 也最多回 1000 列
      q['range'] = (from: number, to: number) => ((range = [from, to]), q);
      q['then'] = (resolve: (v: unknown) => unknown) => {
        const r = results[table] ?? ok([]);
        if (!Array.isArray(r.data)) return resolve(r);
        const [from, to] = range ?? [0, 999];
        return resolve({ ...r, data: r.data.slice(from, Math.min(to, from + 999) + 1) });
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const ENROLLED = ok([
  { student_id: 'stu-1', class_id: 'class-1', students: { name: '小明', grade: 'J1' } },
  { student_id: 'stu-2', class_id: 'class-1', students: { name: '小華', grade: 'J1' } },
]);

describe('loadDailyAttendance（#1928）', () => {
  it('正常：應到、到了、請假各自讀到', async () => {
    const res = await loadDailyAttendance(
      fake({
        enrollments: ENROLLED,
        daily_checkins: ok([
          { id: 'ck-1', student_id: 'stu-1', checked_in_at: '2026-06-01T08:00:00Z' },
        ]),
        leave_requests: ok([
          {
            student_id: 'stu-2',
            submitted_by_role: 'parent',
            reason: '感冒',
            start_date: DATE,
            end_date: DATE,
            start_time: null,
            end_time: null,
          },
        ]),
      }),
      'org-1',
      DATE,
      SESSIONS,
    );
    expect(res.expected.map((s) => s.studentId).sort()).toEqual(['stu-1', 'stu-2']);
    expect(res.arrived.map((a) => a.studentId)).toEqual(['stu-1']);
    expect(res.onLeave.map((l) => l.studentId)).toEqual(['stu-2']);
  });

  it.each([
    ['在籍（enrollments）', { enrollments: boom }],
    ['打卡（daily_checkins）', { enrollments: ENROLLED, daily_checkins: boom }],
    ['請假（leave_requests）', { enrollments: ENROLLED, leave_requests: boom }],
  ])('%s讀取失敗 → 丟例外，不是當成空的', async (_name, results) => {
    await expect(loadDailyAttendance(fake(results), 'org-1', DATE, SESSIONS)).rejects.toThrow();
  });

  it('請假不把應到學生 id 塞進 .in（會 414）；名單外的人的假不列', async () => {
    const calls: string[] = [];
    const leave = (studentId: string) => ({
      student_id: studentId,
      submitted_by_role: 'parent',
      reason: null,
      start_date: DATE,
      end_date: DATE,
      start_time: null,
      end_time: null,
    });
    const res = await loadDailyAttendance(
      fake(
        { enrollments: ENROLLED, leave_requests: ok([leave('stu-2'), leave('stu-other')]) },
        calls,
      ),
      'org-1',
      DATE,
      SESSIONS,
    );
    expect(calls).not.toContain('leave_requests.in(student_id)');
    expect(res.onLeave.map((l) => l.studentId)).toEqual(['stu-2']);
  });

  it('在籍、打卡超過 max_rows（1000）也翻到底，不會靜默截斷', async () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        student_id: `stu-${i}`,
        class_id: 'class-1',
        students: { name: `生${i}`, grade: 'J1' },
      }));
    const res = await loadDailyAttendance(
      fake({
        enrollments: ok(many(2500)),
        daily_checkins: ok(
          Array.from({ length: 1200 }, (_, i) => ({
            id: `ck-${i}`,
            student_id: `stu-${i}`,
            checked_in_at: '2026-06-01T08:00:00Z',
          })),
        ),
      }),
      'org-1',
      DATE,
      SESSIONS,
    );
    expect(res.expected).toHaveLength(2500);
    expect(res.arrived).toHaveLength(1200);
  });
});
