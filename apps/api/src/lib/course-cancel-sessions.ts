import type { Queryable } from './identity-sql';

/**
 * 停用課程時，把這門課所有班「今天起、還沒結束」的課堂取消，同時每堂寫一筆 `schedule_changes`（#2230 ①）。
 *
 * **一句 data-modifying CTE**：取消與流水在同一句裡，單句就是一個交易 —— 不用再「流水寫失敗就手動改回
 * scheduled」（原本那支 rollback 的錯誤被吞，失敗時課堂留在 cancelled、沒有流水）。
 *
 * 原本先 `select id` 撈要取消的課堂（**沒分頁 → max_rows 1000 截斷：超過 1000 堂時只取消前 1000 堂，
 * 其餘靜默留在 scheduled**），再把 id 清單塞進 `update … .in('id', …)`（幾百堂就 414）。
 * 條件照舊：`status <> 'completed'`（已取消的也會再記一筆，行為不變）。每句帶 `org_id`（c1）。
 * 回傳取消的課堂 id（通知與回應的筆數用）。失敗丟例外（路由回 500）。
 */
export async function cancelCourseFutureSessions(
  db: Queryable,
  input: {
    readonly orgId: string;
    readonly courseId: string;
    /** 台北的今天（YYYY-MM-DD） */
    readonly today: string;
    readonly batchId: string;
    readonly actorName: string | null;
  },
): Promise<string[]> {
  const { rows } = await db.query(
    `with cancelled as (
       update public.sessions s
          set status = 'cancelled'
        where s.org_id = $1::uuid
          and s.class_id in (
            select c.id from public.classes c where c.org_id = $1::uuid and c.course_id = $2::uuid)
          and s.session_date >= $3::date
          and s.status <> 'completed'
       returning s.id
     )
     insert into public.schedule_changes
       (org_id, session_id, operation_source, batch_id, change_type, reason, created_by_name)
     select $1::uuid, cancelled.id, 'batch', $4::uuid, 'cancellation'::public.schedule_change_type,
            '課程停用', $5::text
       from cancelled
     returning session_id`,
    [input.orgId, input.courseId, input.today, input.batchId, input.actorName],
  );
  return (rows as Array<{ session_id: string }>).map((row) => row.session_id);
}
