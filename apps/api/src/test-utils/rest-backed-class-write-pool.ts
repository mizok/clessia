/**
 * #2230 ① 的兩支 pool 寫入（`lib/class-batch-active.ts`、`lib/course-cancel-sessions.ts`）單元測試用替身。
 *
 * 同 `rest-backed-leave-pool.ts`：把那幾句 SQL **翻成同一個 supabase 替身上等價的 REST 呼叫**，既有 spec
 * 對範圍（403／404、什麼都沒動）與流水內容的斷言照樣有意義。
 *
 * **SQL 本身的語意（org 條件、同一句的原子性、FOR UPDATE）這裡驗不出來**，由
 * `contract/course-deactivate-batch-active-2230.contract.ts` 對真 Postgres 驗。認不得的語句直接丟錯。
 */

type Chain = Record<string, (...args: unknown[]) => Chain> &
  PromiseLike<{ data: unknown; error: unknown }>;

interface SupabaseLike {
  from(table: string): unknown;
}

export function restBackedClassWritePool(client: SupabaseLike) {
  const from = (table: string) => client.from(table) as Chain;
  const settle = async (q: PromiseLike<{ data: unknown; error: unknown }>) => {
    const { data, error } = await q;
    if (error) throw Object.assign(new Error('fake pool：REST 替身回錯'), { cause: error });
    return (data ?? []) as Array<Record<string, unknown>>;
  };

  const query = async (sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> => {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };

    if (sql.includes('select id, campus_id from public.classes')) {
      const [orgId, ids] = params as [string, string[]];
      const rows = await settle(
        from('classes')['select']!('id, campus_id')['eq']!('org_id', orgId)['in']!('id', ids),
      );
      return { rows };
    }
    if (sql.includes('update public.classes set is_active')) {
      const [orgId, ids, isActive, userId] = params as [string, string[], boolean, string];
      const rows = await settle(
        from('classes')['update']!({ is_active: isActive, updated_by: userId })['eq']!(
          'org_id',
          orgId,
        )['in']!('id', ids)['select']!('id'),
      );
      return { rows };
    }
    if (sql.includes('with cancelled as')) {
      const [orgId, courseId, today, batchId, actorName] = params as Array<string | null>;
      const classIds = (
        await settle(
          from('classes')['select']!('id')['eq']!('org_id', orgId)['eq']!('course_id', courseId),
        )
      ).map((r) => r['id'] as string);
      if (classIds.length === 0) return { rows: [] };
      const sessions = await settle(
        from('sessions')['select']!('id')['eq']!('org_id', orgId)['in']!('class_id', classIds)[
          'gte'
        ]!('session_date', today)['neq']!('status', 'completed'),
      );
      const ids = sessions.map((r) => r['id'] as string);
      if (ids.length === 0) return { rows: [] };
      await settle(from('sessions')['update']!({ status: 'cancelled' })['in']!('id', ids));
      await settle(
        from('schedule_changes')['insert']!(
          ids.map((id) => ({
            org_id: orgId,
            session_id: id,
            operation_source: 'batch',
            batch_id: batchId,
            change_type: 'cancellation',
            reason: '課程停用',
            created_by_name: actorName,
          })),
        ),
      );
      return { rows: ids.map((id) => ({ session_id: id })) };
    }
    throw new Error(`fake pool：認不得的 SQL：${sql.trim().split('\n')[0]}`);
  };

  return {
    query,
    connect: async () => ({ query, release: () => undefined }),
    end: async () => undefined,
  };
}
