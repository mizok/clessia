/**
 * 課堂摘要（`lib/session-summary.ts`，#2227）單元測試用的 pg pool 替身。
 *
 * `summariseSessions` 的三支補充讀取改走 pg（`lib/session-list-sql.ts`）。這個替身把那三句 SQL
 * **翻成改寫前的同一條 REST 呼叫鏈**、打在同一個 supabase 替身上，所以既有 spec 對資料與過濾的斷言照樣有意義。
 *
 * **SQL 本身的語意（org 條件、group by、日期區間）這裡驗不出來**，由
 * `contract/session-summary-2227.contract.ts` 對真 Postgres 驗。認不得的語句直接丟錯。
 */

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
    throw new Error(`fake pool：認不得的語句：${sql.trim().slice(0, 80)}`);
  };

  return { query, connect: async () => ({ query, release: () => undefined }) };
}
