import type { Pool } from 'pg';

import type { CampusScope } from './campus-scope';
import { withTx } from './pg-tx';
import { buildSessionGenerationPlan } from '../domain/session-assignment/session-generation-planner';

/**
 * 「從某日起改時段」（#1100 #22 寫入面）：舊段止於 X−1、新段起於 X，**一個交易**。
 *
 * 1. `FOR UPDATE` 鎖班級（org＋分校範圍，不符＝not-found）與舊時段
 * 2. X 要落在舊段區間內、且晚於舊段起始日（不然舊段會變成空區間；那種情況直接編輯就好）
 * 3. 舊段 `effective_to = X − 1`；新段 `effective_from = X`，止日沿用舊段的止日
 *    —— 新段跟同時段的其他段重疊時排除約束 `schedules_no_overlap` 丟 23P01 → `overlap`
 * 4. 舊段已產生、日期 ≥ X 的課堂（Q2，計畫席 10-23）：
 *    - **沒有任何資料的**刪掉，再依新段在同一段日期裡重產（到舊段最後一堂為止）
 *    - 有資料的（見 `KeptReason`）保留，列給行政用「批次改時間」處理 —— 不默默刪有資料的課堂
 *
 * `dryRun`＝整段照跑再 ROLLBACK：預覽跟真的送出是同一份 SQL，撞約束也在預覽就看得到。
 */

export type KeptReason = 'status' | 'attendance' | 'schedule_change' | 'leave' | 'makeup';

export interface KeptSession {
  readonly id: string;
  readonly sessionDate: string;
  readonly startTime: string;
  readonly reasons: KeptReason[];
}

export interface ScheduleSplitInput {
  readonly orgId: string;
  readonly classId: string;
  readonly scheduleId: string;
  readonly scope: CampusScope;
  readonly fromDate: string;
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly teacherId: string | null;
  readonly classroomId: string | null;
  readonly createdBy: string | null;
  readonly dryRun: boolean;
}

export type ScheduleSplitOutcome =
  | { readonly status: 'not-found' }
  | {
      readonly status: 'invalid-date';
      readonly effectiveFrom: string;
      readonly effectiveTo: string | null;
    }
  | { readonly status: 'overlap' }
  | {
      readonly status: 'done';
      readonly dryRun: boolean;
      readonly newScheduleId: string;
      readonly removedCount: number;
      readonly createdCount: number;
      readonly kept: KeptSession[];
    };

class DryRunRollback extends Error {
  constructor(readonly outcome: ScheduleSplitOutcome) {
    super('dry run');
  }
}

/** 23P01 = 排除約束違反（`schedules_no_overlap`：同班同星期同開始時間、區間重疊） */
function isExclusionViolation(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === '23P01';
}

export async function splitSchedule(
  pool: Pool,
  input: ScheduleSplitInput,
): Promise<ScheduleSplitOutcome> {
  const { orgId, classId, scheduleId, scope, fromDate } = input;
  try {
    return await withTx(pool, async (db) => {
      const { rows: cls } = await db.query<{ campus_id: string }>(
        'SELECT campus_id FROM classes WHERE id = $1 AND org_id = $2 FOR UPDATE',
        [classId, orgId],
      );
      if (!cls[0] || (scope !== null && !scope.includes(cls[0].campus_id))) {
        return { status: 'not-found' } as const;
      }

      // schedules 沒有 org_id：org 條件靠父班級（同 c1 #966 B2）
      const { rows: olds } = await db.query<{
        effective_from: string;
        effective_to: string | null;
      }>(
        `SELECT s.effective_from::text, s.effective_to::text FROM schedules s
         JOIN classes c ON c.id = s.class_id AND c.org_id = $2
         WHERE s.id = $3 AND s.class_id = $1 FOR UPDATE OF s`,
        [classId, orgId, scheduleId],
      );
      const old = olds[0];
      if (!old) return { status: 'not-found' } as const;
      if (
        fromDate <= old.effective_from ||
        (old.effective_to !== null && fromDate > old.effective_to)
      ) {
        return {
          status: 'invalid-date',
          effectiveFrom: old.effective_from,
          effectiveTo: old.effective_to,
        } as const;
      }

      await db.query(
        `UPDATE schedules SET effective_to = $4::date - 1
         WHERE id = $3 AND class_id = $1 AND class_id IN (SELECT id FROM classes WHERE org_id = $2)`,
        [classId, orgId, scheduleId, fromDate],
      );
      const { rows: created } = await db.query<{ id: string }>(
        `INSERT INTO schedules (class_id, weekday, start_time, end_time, teacher_id, classroom_id,
                                effective_from, effective_to)
         SELECT $1, $3, $4, $5, $6, $7, $8::date, $9::date FROM classes WHERE id = $1 AND org_id = $2
         RETURNING id`,
        [
          classId,
          orgId,
          input.weekday,
          input.startTime,
          input.endTime,
          input.teacherId,
          input.classroomId,
          fromDate,
          old.effective_to,
        ],
      );
      const newScheduleId = created[0]!.id;

      const { rows: affected } = await db.query<{
        id: string;
        session_date: string;
        start_time: string;
        status: string;
        attendance: boolean;
        schedule_change: boolean;
        leave: boolean;
        makeup: boolean;
      }>(
        `SELECT s.id, s.session_date::text, s.start_time::text, s.status,
                s.event_id IS NOT NULL AS attendance,
                EXISTS (SELECT 1 FROM schedule_changes x WHERE x.session_id = s.id AND x.org_id = $2) AS schedule_change,
                EXISTS (SELECT 1 FROM leave_request_sessions x WHERE x.session_id = s.id) AS leave,
                EXISTS (SELECT 1 FROM sessions x WHERE x.makeup_for_session_id = s.id AND x.org_id = $2) AS makeup
         FROM sessions s
         WHERE s.class_id = $1 AND s.org_id = $2 AND s.schedule_id = $3 AND s.session_date >= $4::date
         ORDER BY s.session_date, s.start_time
         FOR UPDATE OF s`,
        [classId, orgId, scheduleId, fromDate],
      );

      const kept: KeptSession[] = [];
      const removable: string[] = [];
      for (const r of affected) {
        const reasons: KeptReason[] = [];
        if (r.status !== 'scheduled') reasons.push('status');
        if (r.attendance) reasons.push('attendance');
        if (r.schedule_change) reasons.push('schedule_change');
        if (r.leave) reasons.push('leave');
        if (r.makeup) reasons.push('makeup');
        if (reasons.length > 0) {
          kept.push({ id: r.id, sessionDate: r.session_date, startTime: r.start_time, reasons });
        } else {
          removable.push(r.id);
        }
      }

      if (removable.length > 0) {
        await db.query('DELETE FROM sessions WHERE id = ANY($1::uuid[]) AND org_id = $2', [
          removable,
          orgId,
        ]);
      }

      // 重產到舊段最後一堂為止：原本排到哪天，新段就接到哪天；舊段一堂都沒產生過就不替使用者產
      let createdCount = 0;
      const horizon = affected.at(-1)?.session_date;
      if (horizon && removable.length > 0) {
        const { rows: existing } = await db.query<{ session_date: string; start_time: string }>(
          `SELECT session_date::text, start_time::text FROM sessions
           WHERE class_id = $1 AND org_id = $2 AND session_date BETWEEN $3::date AND $4::date`,
          [classId, orgId, fromDate, horizon],
        );
        const plan = buildSessionGenerationPlan({
          orgId,
          classId,
          createdBy: input.createdBy,
          from: fromDate,
          to: horizon,
          includeUnassigned: true,
          schedules: [
            {
              id: newScheduleId,
              weekday: input.weekday,
              startTime: input.startTime,
              endTime: input.endTime,
              teacherId: input.teacherId,
              effectiveFrom: fromDate,
              effectiveTo: old.effective_to,
            },
          ],
          existingKeys: new Set(existing.map((s) => `${s.session_date}|${s.start_time}`)),
          excludeDates: new Set(),
        });
        if (plan.toInsert.length > 0) {
          const col = <K extends keyof (typeof plan.toInsert)[number]>(k: K) =>
            plan.toInsert.map((r) => r[k]);
          const { rowCount } = await db.query(
            `INSERT INTO sessions (org_id, class_id, schedule_id, session_date, start_time, end_time,
                                   teacher_id, created_by, status, assignment_status)
             SELECT $1, $2, $3, d, st, et, $4, $5, 'scheduled', $6::session_assignment_status
             FROM unnest($7::date[], $8::time[], $9::time[]) AS t(d, st, et)
             ON CONFLICT (class_id, session_date, start_time) DO NOTHING`,
            [
              orgId,
              classId,
              newScheduleId,
              input.teacherId,
              input.createdBy,
              plan.toInsert[0]!.assignment_status,
              col('session_date'),
              col('start_time'),
              col('end_time'),
            ],
          );
          createdCount = rowCount ?? 0;
        }
      }

      const outcome = {
        status: 'done',
        dryRun: input.dryRun,
        newScheduleId,
        removedCount: removable.length,
        createdCount,
        kept,
      } as const;
      if (input.dryRun) throw new DryRunRollback(outcome);
      return outcome;
    });
  } catch (err) {
    if (err instanceof DryRunRollback) return err.outcome;
    if (isExclusionViolation(err)) return { status: 'overlap' };
    throw err;
  }
}
