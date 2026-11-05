/**
 * 課堂摘要（`lib/session-summary.ts`，#2227）、作業台與日到班（#1595 P2 ①）單元測試用的 pg pool 替身。
 *
 * `summariseSessions` 的三支補充讀取改走 pg（`lib/session-list-sql.ts`）。這個替身把那三句 SQL
 * **翻成改寫前的同一條 REST 呼叫鏈**、打在同一個 supabase 替身上，所以既有 spec 對資料與過濾的斷言照樣有意義。
 *
 * 學生名冊那句不逐支翻，直接交給 `loadStudentListViaBuilder`（route 沒有 pool 時用的同一份）。
 *
 * **SQL 本身的語意（org 條件、group by、日期區間）這裡驗不出來**，由
 * `contract/session-summary-2227.contract.ts` 對真 Postgres 驗。認不得的語句直接丟錯。
 */

import { LEAVE_WINDOW_COLUMNS } from '../lib/leave-covers-session';
import { SESSION_SUMMARY_SELECT } from '../lib/session-summary';
import { loadStudentListViaBuilder } from '../lib/student-list-builder';
import { STUDENT_LIST_SQL, studentListParamsFromArgs } from '../lib/student-list-sql';

type Chain = Record<string, (...args: unknown[]) => Chain> &
  PromiseLike<{ data: unknown; error: unknown }>;

interface SupabaseLike {
  from(table: string): unknown;
}

type Row = Record<string, unknown>;

export function restBackedSummaryPool(client: SupabaseLike) {
  const from = (table: string) => client.from(table) as Chain;
  const settle = async (q: PromiseLike<{ data: unknown; error: unknown }>) => {
    const { data, error } = await q;
    if (error) throw Object.assign(new Error('fake pool：REST 替身回錯'), { cause: error });
    return (data ?? []) as Row[];
  };
  const result = (rows: unknown[]) => ({ rows: [{ result: rows }] });

  const query = async (sql: string, params: unknown[] = []) => {
    // 學生名冊（`lib/student-list-sql.ts`，#1595 P2 ②）：同一組參數交給 builder 版（`lib/student-list-builder.ts`），
    // 就是改寫前的那條 REST 鏈。參數順序見 `STUDENT_LIST_SQL` 的註解
    if (sql === STUDENT_LIST_SQL) {
      const result = await loadStudentListViaBuilder(
        client as never,
        studentListParamsFromArgs(params),
      );
      return { rows: [{ result }] };
    }
    // 新的兩支放最前面：日到班的 SQL 含 `from public.enrollments en`，會被下面摘要的 `enrollments e` 分支誤認
    // 作業台第一波（`lib/workbench-today-sql.ts`，#1595 P2 ①）：點名模式＋當天課堂。翻成改寫前的三支 REST
    if (sql.includes("'orgMode'")) {
      const [orgId, date, campusIds, singleCampus] = params as [
        string,
        string,
        string[] | null,
        string | null,
      ];
      // 同 `resolveAttendanceMode`：`.maybeSingle()` 回單一物件
      const single = async (q: Chain) => {
        const { data, error } = await (q['maybeSingle']!() as unknown as PromiseLike<{
          data: Row | null;
          error: unknown;
        }>);
        if (error) throw Object.assign(new Error('fake pool：REST 替身回錯'), { cause: error });
        return data;
      };
      const org = await single(
        from('organizations')['select']!('attendance_mode')['eq']!('id', orgId),
      );
      const campus = singleCampus
        ? await single(
            from('campuses')['select']!('attendance_mode')['eq']!('id', singleCampus)['eq']!(
              'org_id',
              orgId,
            ),
          )
        : null;
      let q = from('sessions')['select']!(SESSION_SUMMARY_SELECT)['eq']!('org_id', orgId)['eq']!(
        'session_date',
        date,
      )['order']!('start_time', { ascending: true });
      if (campusIds) q = q['in']!('classes.campus_id', campusIds);
      return {
        rows: [
          {
            result: {
              orgMode: org?.['attendance_mode'] ?? null,
              campusMode: campus?.['attendance_mode'] ?? null,
              sessions: await settle(q),
            },
          },
        ],
      };
    }
    // 日到班的原料（`lib/today-attendance.ts` 的 DAILY_ATTENDANCE_SQL，#1595 P2 ①）：在籍、打卡、請假
    if (sql.includes('from public.daily_checkins dc')) {
      const [orgId, date, campusIds, classIds] = params as [
        string,
        string,
        string[] | null,
        string[] | null,
      ];
      let en = from('enrollments')['select']!(
        'id, student_id, class_id, students(name, grade), classes!inner(sessions!inner(session_date, status))',
      )['eq']!('org_id', orgId)['eq']!('status', 'active')['eq']!(
        'classes.sessions.session_date',
        date,
      )['neq']!('classes.sessions.status', 'cancelled')['lte']!('effective_from', date)['or']!(
        `effective_to.is.null,effective_to.gte.${date}`,
      );
      if (campusIds) en = en['in']!('classes.campus_id', campusIds);
      if (classIds)
        en = en['in']!(
          'class_id',
          classIds.length > 0 ? classIds : ['00000000-0000-0000-0000-000000000000'],
        );
      const checkins = await settle(
        from('daily_checkins')['select']!('id, student_id, checked_in_at')['eq']!('org_id', orgId)[
          'eq'
        ]!('checkin_date', date)['order']!('id'),
      );
      const leaves = await settle(
        from('leave_requests')['select']!(
          `student_id, submitted_by_role, reason, ${LEAVE_WINDOW_COLUMNS}`,
        )['eq']!('org_id', orgId)['lte']!('start_date', date)['gte']!('end_date', date),
      );
      return {
        rows: [{ result: { enrollments: await settle(en['order']!('id')), checkins, leaves } }],
      };
    }
    if (sql.includes('from public.attendance_records ar')) {
      const [orgId, eventIds] = params as [string, string[]];
      const data = await settle(
        from('attendance_records')['select']!('event_id, status')['eq']!('org_id', orgId)['in']!(
          'event_id',
          eventIds,
        ),
      );
      const counts = new Map<string, { eventId: string; status: string; count: number }>();
      for (const r of data) {
        const key = `${r['event_id']}|${r['status']}`;
        const hit = counts.get(key);
        if (hit) hit.count += 1;
        else
          counts.set(key, {
            eventId: r['event_id'] as string,
            status: r['status'] as string,
            count: 1,
          });
      }
      return result([...counts.values()]);
    }
    if (sql.includes('from public.enrollments e')) {
      const [orgId, classIds] = params as [string, string[]];
      return result(
        await settle(
          from('enrollments')['select']!('class_id, effective_from, effective_to')['eq']!(
            'org_id',
            orgId,
          )['eq']!('status', 'active')['in']!('class_id', classIds),
        ),
      );
    }
    if (sql.includes('from public.academy_exam_classes aec')) {
      const [orgId, classIds, start, end] = params as [string, string[], string, string];
      const data = await settle(
        from('academy_exam_classes')['select']!('class_id, academy_exams!inner(exam_date, org_id)')[
          'eq'
        ]!('academy_exams.org_id', orgId)['in']!('class_id', classIds)['gte']!(
          'academy_exams.exam_date',
          start,
        )['lte']!('academy_exams.exam_date', end),
      );
      return result(
        data.map((r) => {
          const exam = (
            Array.isArray(r['academy_exams']) ? r['academy_exams'][0] : r['academy_exams']
          ) as { exam_date?: string } | null;
          return { class_id: r['class_id'], exam_date: exam?.exam_date ?? '' };
        }),
      );
    }
    // 工作台（`routes/workbench.ts`，#2230 ③）：主要家長＋電話、今日最近聯絡。翻成改寫前的 REST 鏈
    if (sql.includes('from public.parent_student_relations r')) {
      const [orgId, studentIds] = params as [string, string[]];
      const rels = await settle(
        from('parent_student_relations')['select']!(
          'student_id, relation, is_primary, parents!inner(name, user_id, org_id)',
        )['in']!('student_id', studentIds)['eq']!('parents.org_id', orgId),
      );
      const userIds = rels.flatMap((r) => {
        const p = r['parents'] as Row | null;
        return p?.['user_id'] ? [p['user_id'] as string] : [];
      });
      const users =
        userIds.length === 0
          ? []
          : await settle(from('ba_user')['select']!('id, phone')['in']!('id', userIds));
      const phone = new Map(users.map((u) => [u['id'], u['phone'] ?? null]));
      return {
        rows: rels.map((r) => {
          const p = (r['parents'] as Row | null) ?? {};
          return {
            student_id: r['student_id'],
            relation: r['relation'] ?? null,
            is_primary: r['is_primary'] ?? null,
            name: p['name'] ?? null,
            phone: p['user_id'] ? (phone.get(p['user_id']) ?? null) : null,
          };
        }),
      };
    }
    if (sql.includes('from public.contact_logs c')) {
      const [orgId, studentIds, from_, to] = params as [string, string[], string, string];
      const logs = await settle(
        from('contact_logs')['select']!('student_id, channel, created_at')['eq']!('org_id', orgId)[
          'in'
        ]!('student_id', studentIds)['gte']!('created_at', from_)['lt']!('created_at', to)[
          'order'
        ]!('created_at', { ascending: false }),
      );
      const seen = new Set<unknown>();
      return {
        rows: logs.filter((r) => !seen.has(r['student_id']) && seen.add(r['student_id'])),
      };
    }
    throw new Error(`fake pool：認不得的語句：${sql.trim().slice(0, 80)}`);
  };

  return { query, connect: async () => ({ query, release: () => undefined }) };
}
