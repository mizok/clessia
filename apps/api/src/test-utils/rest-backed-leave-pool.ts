/**
 * 請假寫入（`lib/leave-write.ts`，#1957）單元測試用的 pg pool 替身。
 *
 * 請假的「取鎖 → 查重疊 → 寫入」改成經 pool 的一筆交易。這個替身把那幾句 SQL **翻成同一個 supabase 替身上
 * 等價的 REST 呼叫**（查重疊＝原本 `findConflictingLeave` 那條 `eq/neq/lte/gte` 鏈），所以既有 spec
 * 對過濾條件、寫入內容的斷言照樣有意義。
 *
 * **SQL 本身的語意（org 條件、端點日、綁定 embed、鎖）這裡驗不出來**，由
 * `contract/leave-write.contract.ts` 對真 Postgres 驗、並跟 REST 路徑逐案比對。
 * 認不得的語句直接丟錯，免得新加的 SQL 被靜靜吞掉。
 */

type Chain = Record<string, (...args: unknown[]) => Chain> &
  PromiseLike<{ data: unknown; error: unknown }>;

interface SupabaseLike {
  from(table: string): unknown;
}

const ROW_SELECT =
  '*, leave_request_sessions(session_id, sessions(session_date)), students(name), ba_user!submitted_by(name)';

export interface RestBackedLeavePool {
  readonly query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  readonly connect: () => Promise<{
    query: RestBackedLeavePool['query'];
    release: (err?: unknown) => void;
  }>;
  readonly end: () => Promise<void>;
  /** 每一句經過 pool 的 SQL 第一行（含 BEGIN／COMMIT／ROLLBACK） */
  readonly statements: string[];
}

export function restBackedLeavePool(client: SupabaseLike): RestBackedLeavePool {
  const statements: string[] = [];
  const from = (table: string) => client.from(table) as Chain;
  const settle = async (q: PromiseLike<{ data: unknown; error: unknown }>) => {
    const { data, error } = await q;
    if (error) throw Object.assign(new Error('fake pool：REST 替身回錯'), { cause: error });
    return data;
  };

  const query = async (sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> => {
    statements.push(sql.trim().split('\n')[0]!);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };

    if (sql.includes('from public.leave_requests l\n')) {
      const [orgId, studentId, excludeId, end, start] = params as Array<string | null>;
      let q = from('leave_requests')['select']!(
        'id, start_date, end_date, start_time, end_time, leave_request_sessions(session_id, sessions(session_date))',
      )['eq']!('org_id', orgId)['eq']!('student_id', studentId);
      if (excludeId) q = q['neq']!('id', excludeId);
      const data = await settle(q['lte']!('start_date', end)['gte']!('end_date', start));
      return { rows: (data ?? []) as unknown[] };
    }
    if (sql.includes('insert into public.leave_requests')) {
      const [orgId, studentId, startDate, endDate, startTime, endTime, reason, userId] = params;
      const row = await settle(
        from('leave_requests')['insert']!({
          org_id: orgId,
          student_id: studentId,
          start_date: startDate,
          end_date: endDate,
          start_time: startTime,
          end_time: endTime,
          reason,
          submitted_by: userId,
          submitted_by_role: 'admin',
        })['select']!(ROW_SELECT)['single']!() as never,
      );
      return { rows: [{ row }] };
    }
    if (sql.includes('insert into public.leave_request_sessions')) {
      const [leaveId, orgId, sessionIds] = params as [string, string, string[]];
      await settle(
        from('leave_request_sessions')['insert']!(
          sessionIds.map((sessionId) => ({
            leave_request_id: leaveId,
            session_id: sessionId,
            org_id: orgId,
          })),
        ),
      );
      return { rows: [] };
    }
    if (sql.includes('delete from public.leave_request_sessions')) {
      const [orgId, leaveId, sessionIds] = params as [string, string, string[]];
      await settle(
        from('leave_request_sessions')['delete']!()['eq']!('org_id', orgId)['eq']!(
          'leave_request_id',
          leaveId,
        )['in']!('session_id', sessionIds),
      );
      return { rows: [] };
    }
    if (sql.includes('update public.leave_requests set')) {
      const [orgId, leaveId] = params as [string, string];
      const payload: Record<string, unknown> = {};
      const setPart = sql.slice(sql.indexOf(' set ') + 5, sql.indexOf('where'));
      for (const m of setPart.matchAll(/(\w+) = \$(\d+)/g))
        payload[m[1]!] = params[Number(m[2]) - 1];
      const { data, error } = await (from('leave_requests')['update']!(payload)['eq']!(
        'id',
        leaveId,
      )['eq']!('org_id', orgId)['select']!(ROW_SELECT)['single']!() as PromiseLike<{
        data: unknown;
        error: unknown;
      }>);
      if (error && (error as { code?: string }).code !== 'PGRST116') {
        throw Object.assign(new Error('fake pool：REST 替身回錯'), { cause: error });
      }
      return { rows: data ? [{ row: data }] : [] };
    }
    throw new Error(`fake pool：認不得的語句：${sql.trim().slice(0, 80)}`);
  };

  return {
    query,
    connect: async () => ({ query, release: () => undefined }),
    end: async () => undefined,
    statements,
  };
}
