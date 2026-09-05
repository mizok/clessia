import type { AppEnv } from '../index';
import { applyCampusFilter, type CampusScope } from './campus-scope';

/**
 * 出勤事件是懶生成的 —— **唯一定義**，`routes/attendance.ts`（`/api/attendance/sessions`）
 * 與 `routes/sessions.ts`（`/api/sessions` 的 `attendanceTaken` 篩選）共用，形狀照
 * `lib/session-summary.ts` 的先例：查詢條件可以不一樣，形狀不行。
 *
 * 兩支端點都要對「有沒有點名」下條件，而條件下在 embed 的 `events` 欄位上
 * 必須配 `!inner` join（見 `lib/session-summary.ts` 的表格）—— 沒有 event 的
 * 課堂（懶生成還沒補建、或停課刻意不補）會被 inner join 排除，這正是「未點名」
 * 篩選要的效果。但**要下這個條件之前**，scheduled/completed 的課堂如果連 event
 * 都還沒生出來，會被誤判成「不存在」而不是「未點名」——所以查詢前要先呼叫這支
 * 補齊缺的 event。
 */
export type AttendanceSessionStatus = 'scheduled' | 'completed' | 'cancelled';

/**
 * 需要 `!inner` join 才篩得動的那個 select 片段要不要換上 `!inner`。
 *
 * `requireEvent` 對齊 `sessionSummarySelect({ requireEvent })` 的參數名 ——
 * 同一個判準（有沒有要對 `attendance_taken_at` 下條件）決定要不要加 `!inner`。
 */
export function eventsJoinModifier(requireEvent: boolean): string {
  return requireEvent ? '!event_id!inner' : '!event_id';
}

/**
 * 「有沒有點名」的過濾條件 —— **`/api/attendance/sessions` 與 `/api/sessions` 的
 * `attendanceTaken` 共用同一份判定**，不是兩支各自實作再靠測試比對。這樣兩支
 * 要嘛一起對、要嘛一起錯，不會出現「同一個概念兩支端點各算一次然後漂移」。
 *
 * 呼叫端要先把 select 換成 `!inner`（見 `eventsJoinModifier`）——這支只負責
 * 下條件，不驗證有沒有配對的 join，那個前提由呼叫端保證。
 */
export function applyAttendanceTakenFilter<
  T extends { is(...args: any[]): T; not(...args: any[]): T },
>(query: T, attendanceTaken: boolean | undefined): T {
  if (attendanceTaken === false) return query.is('events.attendance_taken_at', null);
  if (attendanceTaken === true) return query.not('events.attendance_taken_at', 'is', null);
  return query;
}

export async function ensureAttendanceSessionEvents(input: {
  readonly supabase: AppEnv['Variables']['supabase'];
  readonly orgId: string;
  /**
   * 呼叫者看得到的分校。**這支會「補建」出勤事件（寫入），所以範圍不能只靠讀取端過濾**
   * —— 少了它，A 校的管理員查詢時會替 B 校的課堂建立 event。
   */
  readonly campusScope: CampusScope;
  readonly campusId?: string;
  readonly courseIdList: readonly string[];
  readonly classIdList: readonly string[];
  readonly statusList: readonly AttendanceSessionStatus[];
  readonly dateFromValue?: string;
  readonly dateToValue?: string;
}): Promise<{ readonly created: number; readonly error: string | null }> {
  const {
    supabase,
    orgId,
    campusScope,
    campusId,
    courseIdList,
    classIdList,
    statusList,
    dateFromValue,
    dateToValue,
  } = input;

  let missingSessionsQuery = supabase
    .from('sessions')
    .select(
      `
      id,
      event_id,
      session_date,
      start_time,
      end_time,
      status,
      class_id,
      classes!inner(name, course_id, campus_id, courses(name))
    `,
    )
    .eq('org_id', orgId)
    .is('event_id', null)
    .in('status', [...statusList]);

  if (dateFromValue) {
    missingSessionsQuery = missingSessionsQuery.gte('session_date', dateFromValue);
    missingSessionsQuery = missingSessionsQuery.lte('session_date', dateToValue ?? dateFromValue);
  }

  missingSessionsQuery = applyCampusFilter(
    missingSessionsQuery,
    'classes.campus_id',
    campusScope,
    campusId,
  );
  if (courseIdList.length > 0) {
    missingSessionsQuery = missingSessionsQuery.in('classes.course_id', [...courseIdList]);
  }
  if (classIdList.length > 0) {
    missingSessionsQuery = missingSessionsQuery.in('class_id', [...classIdList]);
  }

  const { data: missingSessions, error: missingSessionsError } = await missingSessionsQuery;
  if (missingSessionsError) {
    return { created: 0, error: missingSessionsError.message };
  }

  if (!missingSessions || missingSessions.length === 0) {
    return { created: 0, error: null };
  }

  const eventsToInsert = missingSessions.map((session: any) => {
    const classRow = Array.isArray(session.classes) ? session.classes[0] : session.classes;

    return {
      id: crypto.randomUUID(),
      org_id: orgId,
      event_type: 'session' as const,
      title: classRow?.name ?? '課堂',
      campus_id: classRow?.campus_id ?? null,
      event_date: session.session_date,
      start_time: session.start_time,
      end_time: session.end_time,
    };
  });

  const { error: insertEventsError } = await supabase.from('events').insert(eventsToInsert);
  if (insertEventsError) {
    return { created: 0, error: insertEventsError.message };
  }

  const sessionUpdateResults = await Promise.all(
    missingSessions.map((session: any, index) =>
      supabase
        .from('sessions')
        .update({ event_id: eventsToInsert[index]?.id ?? null })
        .eq('id', session.id),
    ),
  );

  const updateError = sessionUpdateResults.find((result) => result.error)?.error;
  if (updateError) {
    return { created: 0, error: updateError.message };
  }

  return { created: missingSessions.length, error: null };
}
