import type { Queryable } from './identity-sql';

/**
 * 課務異動列表（`GET /api/sessions/changes`）改走 pg、**分頁單位是「一則」**（#1314 S3，計畫席 11-13 gate）。
 *
 * 原本一列一筆、依 `created_at` 分頁，前端在當頁內把同一批收成一則 —— 一批 30 堂的停課剛好落在
 * 分頁交界時，兩頁各出現一則「停課 N 堂」，兩邊的 N 都不對。這裡先把符合條件的列分組
 * （分組鍵見 `grp`），對**組**分頁，再回那幾組的**全部**列。回應形狀不變（仍是列陣列），
 * 前端 `groupChanges` 照舊在頁內分組，只是每頁拿到的一定是完整的批。
 *
 * 分組鍵跟前端 `change-log.util.ts` 的 `groupChanges` 一致：有 `batch_id` 用它；舊批次（#1195 之前）
 * 退回「類型＋原因＋操作者＋建立時間到秒（UTC）」—— 同 `batchKey`；單堂用自己的 id。
 *
 * **範圍條件在這裡**（保留類：授權範圍）：`org_id`（c1）＋分校（`campusIds`：null＝不限）。
 * 舊的 REST 版沒有套 campusScope（受限管理員看得到別校的異動），改寫時一併補上。
 *
 * 結果在 Postgres 組成 JSON，形狀＝`ChangeLogRow`（`routes/sessions/change-log.ts` 的 `describeChange` 吃）：
 * `pg` 會把 date／timestamptz 轉成 JS Date，跟 PostgREST 的字串不同。失敗丟例外（呼叫端回 500）。
 */
export async function changeLogViaSql(
  db: Queryable,
  params: {
    orgId: string;
    from: string;
    to: string;
    changeType: string | null;
    /** null＝不限分校（不受限的管理員、也沒指定 campusId） */
    campusIds: readonly string[] | null;
    /** 已剝掉保留字元的搜尋字；null＝不搜 */
    term: string | null;
    page: number;
    pageSize: number;
  },
): Promise<{ rows: Record<string, unknown>[]; total: number; rowTotal: number }> {
  const { rows } = await db.query(
    `with f as (
       select sc.*, s.session_date as s_date, s.start_time as s_start,
              cl.name as class_name, st.display_name as sub_name,
              coalesce(sc.batch_id::text,
                case when sc.operation_source = 'batch'
                  -- 同前端 [...].join('|')：null 寫成空欄、不略過 —— concat_ws 會略過 null，
                  -- (原因 null, 操作者 X) 跟 (原因 X, 操作者 null) 就撞成同一組
                  then sc.change_type::text || '|' || coalesce(sc.reason, '') || '|'
                       || coalesce(sc.created_by_name, '') || '|'
                       || to_char(sc.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
                  else sc.id::text end) as grp
         from public.schedule_changes sc
         join public.sessions s on s.id = sc.session_id and s.org_id = sc.org_id
         join public.classes cl on cl.id = s.class_id and cl.org_id = sc.org_id
         left join public.staff st on st.id = sc.substitute_teacher_id and st.org_id = sc.org_id
        where sc.org_id = $1::uuid
          and s.session_date between $2::date and $3::date
          and ($4::text is null or sc.change_type::text = $4::text)
          and ($5::uuid[] is null or cl.campus_id = any($5::uuid[]))
          and ($6::text is null
               or cl.name ilike '%' || $6::text || '%'
               or sc.original_teacher_name ilike '%' || $6::text || '%'
               or st.display_name ilike '%' || $6::text || '%')
     ), g as (
       select grp, max(created_at) as last_at from f group by grp
     ), page as (
       select grp from g order by last_at desc, grp limit $7::int offset $8::int
     )
     select (select count(*) from g)::int as total, (select count(*) from f)::int as row_total,
            coalesce((
              select json_agg(json_build_object(
                'id', f.id, 'session_id', f.session_id, 'change_type', f.change_type,
                'operation_source', f.operation_source, 'batch_id', f.batch_id,
                'reason', f.reason, 'created_by_name', f.created_by_name, 'created_at', f.created_at,
                'original_session_date', f.original_session_date,
                'original_start_time', f.original_start_time, 'original_end_time', f.original_end_time,
                'new_session_date', f.new_session_date,
                'new_start_time', f.new_start_time, 'new_end_time', f.new_end_time,
                'original_teacher_name', f.original_teacher_name,
                'sessions', json_build_object('session_date', f.s_date, 'start_time', f.s_start,
                                              'classes', json_build_object('name', f.class_name)),
                'staff', case when f.sub_name is null then null
                              else json_build_object('display_name', f.sub_name) end
              ) order by f.created_at desc, f.id)
                from f join page using (grp)
            ), '[]'::json) as result`,
    [
      params.orgId,
      params.from,
      params.to,
      params.changeType,
      params.campusIds,
      params.term,
      params.pageSize,
      (params.page - 1) * params.pageSize,
    ],
  );
  const row = rows[0] as { total?: unknown; row_total?: unknown; result?: unknown } | undefined;
  if (
    rows.length !== 1 ||
    !Array.isArray(row?.result) ||
    typeof row?.total !== 'number' ||
    typeof row?.row_total !== 'number'
  ) {
    throw new Error('[change-log-sql] 結果形狀不對');
  }
  return {
    rows: row.result as Record<string, unknown>[],
    total: row.total,
    rowTotal: row.row_total,
  };
}
