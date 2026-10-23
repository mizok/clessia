import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import { resolveAttendanceMode } from './attendance-mode';
import type { Queryable } from './identity-sql';
import type { StudentScope } from './child-scope';
import { findConflictingLeaveViaSql, insertLeave, lockStudentLeaves } from './leave-write';
import type { LeaveWindow } from './leave-covers-session';
import { notifyLeaveStreaks } from './leave-streak';
import { withTx } from './pg-tx';
import { notifyNewApplication } from './notify-events';
import { notifyLeaveForAdmins, notifyLeaveForTeachers } from './notify-leave';
import { logAudit } from '../utils/audit';

/**
 * 只能由這支檔案自己的 `pluck()` 產生的 id 清單。
 *
 * **為什麼要品牌化，不能只收 `readonly string[]`**：`class_logs` 這類表沒有
 * `student_id` 欄位，查它們得先從有 `student_id` 的表（`enrollments`）撈出
 * `class_id` 清單，再拿那份清單去查。如果 `fromScopedIds` 收裸的
 * `readonly string[]`，一個合法呼叫（清單來自 `pluck()`）跟一個災難呼叫
 * （清單是隨便組出來的、甚至是別的家長的）在型別上長得一模一樣——
 * 「呼叫端必須自己證明清單合法」只活在註解裡，審查看不到、A19 也擋不住。
 *
 * 品牌型別把這句話從註解變成編譯錯誤：想塞一個不是從 `pluck()` 來的清單
 * 進 `fromScopedIds`，唯一的路是寫一個看得見的 `as unknown as ScopedIds`——
 * 那正是這個設計要的效果，錯的寫法比對的寫法還顯眼。
 *
 * 見 kb/wiki/architecture/parent-class-logs-read.md 第三節。
 */
declare const scopedIdsBrand: unique symbol;
export type ScopedIds = readonly string[] & { readonly [scopedIdsBrand]: true };

/**
 * 家長端專用的查詢入口。
 *
 * 家長端的 route **拿不到 context 上的原始 `supabase`**，只拿得到這個 ——
 * 由 `authMiddleware` 建好放進 context（`c.get('childDb')`），每一次 `from()`
 * 都已經帶上這個家長的 `studentScope` 條件。
 *
 * 這比「查詢走一個強制吃 scope 的 helper」強：那種做法的必填參數只守得住
 * 「呼叫時不能不給 scope」，守不住「根本沒呼叫」—— route 裡直接寫
 * `c.get('supabase').from('scores')…` 照樣編得過。這裡是**拿不到那個工具**，
 * 不是「工具比較難用錯」。gate（A19）只負責收尾：禁止家長端檔案出現
 * `c.get('supabase')`，抓的是那個看得見的繞過動作。
 *
 * 見 kb/wiki/architecture/parent-data-scope.md 第二節。
 *
 * **A19 的能力邊界**：那道 gate 只掃 `routes/parent/**`，不掃這裡。**這支檔案
 * 本身當然要用原始 `supabase`** 才建得出綁好 scope 的查詢入口 —— A19 綠燈的
 * 意思是「家長端 route 檔案沒有繞過 childDb」，不是「這個 codebase 沒有任何
 * 地方碰得到原始 supabase」。
 */
export function createChildDb(
  supabase: SupabaseClient,
  scope: StudentScope,
  orgId: string,
  /** 只給 `createLeave` 用（#1970）；家長端 route 拿不到它，只拿得到綁好 scope 的能力 */
  pool?: Pool,
) {
  /** 寫入用：`null`（不是家長）在寫入面一律 fail-closed，跟讀取面的「不加條件」刻意不同 */
  const writableIds = scope === null ? [] : [...scope];

  /** 這張假是不是 scope 內孩子的（同 org、student_id 在 scope）。不是就回 null —— notifyLeave／recordLeave 的共同前提 */
  const ownLeave = async (leaveId: string, columns: string): Promise<unknown> => {
    if (writableIds.length === 0) return null;
    const { data } = await supabase
      .from('leave_requests')
      .select(columns)
      .eq('id', leaveId)
      .eq('org_id', orgId)
      .in('student_id', writableIds)
      .maybeSingle();
    return data ?? null;
  };

  return {
    /**
     * @param studentIdColumn 這張表存學生 id 的欄位 —— `students` 表本身用 `id`，
     *   其餘多半是 `student_id`。不同表欄位不同，所以由呼叫端指名（跟
     *   `applyCampusFilter` 的 `column` 參數同一個理由）。
     */
    from(table: string, studentIdColumn: string) {
      const scopedSelect = (
        columns: string,
        options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean },
      ) => {
        const query = supabase.from(table).select(columns, options);

        // `scope === null` 理論上不該發生在家長端 route（角色層已經擋掉非家長），
        // 但保留這個分支而不是假設它不會發生 —— 跟 `applyCampusFilter` 同一個判準。
        if (scope === null) return query;

        // 空陣列一樣要送進 `.in()`：沒綁小孩的家長要查到「什麼都沒有」，
        // 不是略過條件查到全部。這跟 `applyCampusFilter` 對空 campusScope 的處理一致。
        return query.in(studentIdColumn, [...scope]);
      };

      return {
        select: scopedSelect,
        /**
         * 查這張表，**一次拿到完整列與品牌化的 `ScopedIds`**（某一欄去重後的值）。
         *
         * 兩樣一起回是刻意的：呼叫端往往兩樣都要（完整列做進一步的業務判斷，
         * `ids` 拿去查另一張沒有 `student_id` 的表），分成兩次查詢還得保證
         * 「後面那次的 ids 真的是從前面那次算出來的」——這裡直接用同一個
         * scoped 查詢的結果算兩種輸出，不留那個縫。
         *
         * `studentId` **必填**（#1116）：scope 是「這個家長的所有孩子」，只靠它查
         * `enrollments` 會把兄弟姊妹的班一起拿回來，而家長端的路由一次只看一個孩子。
         * 跟 scope 是 AND —— 傳 scope 外的 id 只會查到空，不會放寬範圍。
         */
        async pluck(
          columns: string,
          idColumn: string,
          studentId: string,
        ): Promise<{ rows: Record<string, unknown>[]; ids: ScopedIds; error: unknown }> {
          const { data, error } = await scopedSelect(columns).eq(studentIdColumn, studentId);
          if (error) return { rows: [], ids: [] as unknown as ScopedIds, error };

          const rows = (data ?? []) as unknown as Record<string, unknown>[];
          const ids = [...new Set(rows.map((row) => row[idColumn] as string))];
          return { rows, ids: ids as unknown as ScopedIds, error: null };
        },

        /**
         * 寫一筆（#1119，家長端第一次寫入）。**範圍檢查在送 DB 之前**：這一列的學生 id
         * 不在 scope（或根本不是家長）就不送，回 `outOfScope`，呼叫端回 403。
         * `org_id` 一律蓋成 session 的 —— 呼叫端塞什麼都不算數。
         */
        async insert(
          row: Record<string, unknown>,
          columns = '*',
        ): Promise<{ data: unknown; error: unknown; outOfScope: boolean }> {
          const studentId = row[studentIdColumn];
          if (typeof studentId !== 'string' || !writableIds.includes(studentId)) {
            return { data: null, error: null, outOfScope: true };
          }
          const { data, error } = await supabase
            .from(table)
            .insert({ ...row, org_id: orgId })
            .select(columns)
            .single();
          return { data, error, outOfScope: false };
        },

        /**
         * 一批寫入（#1120 試聽一次多門課）。**任一列的學生不在 scope 就整批不送** ——
         * 部分寫入比全拒更難收拾。規則同 `insert`；空陣列當成拒絕，不送一個空 insert。
         */
        async insertMany(
          rows: Record<string, unknown>[],
          columns = '*',
        ): Promise<{ data: unknown[] | null; error: unknown; outOfScope: boolean }> {
          const allowed = rows.every((row) => {
            const studentId = row[studentIdColumn];
            return typeof studentId === 'string' && writableIds.includes(studentId);
          });
          if (rows.length === 0 || !allowed) return { data: null, error: null, outOfScope: true };
          const { data, error } = await supabase
            .from(table)
            .insert(rows.map((row) => ({ ...row, org_id: orgId })))
            .select(columns);
          return { data: (data as unknown[] | null) ?? null, error, outOfScope: false };
        },

        /**
         * 一批 upsert（#1695 家長請假寫 `on_leave`）。範圍檢查照 `insertMany`：
         * **任一列的學生不在 scope 就整批不送**；空陣列當成拒絕；`org_id` 一律蓋成 session 的。
         */
        async upsert(
          rows: Record<string, unknown>[],
          onConflict: string,
        ): Promise<{ error: unknown; outOfScope: boolean }> {
          const allowed = rows.every((row) => {
            const studentId = row[studentIdColumn];
            return typeof studentId === 'string' && writableIds.includes(studentId);
          });
          if (rows.length === 0 || !allowed) return { error: null, outOfScope: true };
          const { error } = await supabase.from(table).upsert(
            rows.map((row) => ({ ...row, org_id: orgId })),
            { onConflict },
          );
          return { error, outOfScope: false };
        },

        /**
         * 改資料。回傳的 builder **已經帶 `org_id` 與 scope 條件**，scope 外的列根本選不到。
         * 學生欄位與 `org_id` 不允許被改（把一筆申請「過戶」給別的學生或別的 org）。
         */
        update(values: Record<string, unknown>) {
          const safe = { ...values };
          delete safe['org_id'];
          delete safe[studentIdColumn];
          return supabase
            .from(table)
            .update(safe)
            .eq('org_id', orgId)
            .in(studentIdColumn, writableIds);
        },
      };
    },

    /**
     * 家長簽收聯絡簿（#1100 #26）。**走 pg 一句 SQL，不走 `from().update()`**：`signed_at = now()`
     * 跟 `updated_at` trigger 的 `now()` 是同一個交易時間，兩欄相等 —— 之後老師一改內容，
     * `updated_at` 才會大於 `signed_at`，「簽收後有修改」就靠這個判。用 JS 的時間的話，
     * trigger 的時間一定略晚（或因時鐘差略早），每一筆都會誤判。
     *
     * - 範圍：同 org、`student_id` 在 scope；不是 → `not-found`（不分「不存在」與「別人的」）
     * - **已簽過不覆蓋**（第一位簽收者留著）：`signed_at IS NULL` 寫在 UPDATE 的條件裡，
     *   兩位家長同時按，第二位在列鎖之後重新判條件、改不到 → `already`
     */
    async signContactBookEntry(
      pool: Queryable,
      entryId: string,
      userId: string,
    ): Promise<'signed' | 'already' | 'not-found'> {
      if (writableIds.length === 0) return 'not-found';
      const { rows } = await pool.query(
        `with target as (
           select id from public.contact_book_entries
           where id = $1 and org_id = $2 and student_id = any($3::uuid[])
         ), signed as (
           update public.contact_book_entries e
           set signed_by = $4, signed_at = now()
           from target
           where e.id = target.id and e.signed_at is null
           returning e.id
         )
         select (select count(*) from target)::int as found,
                (select count(*) from signed)::int as signed`,
        [entryId, orgId, writableIds, userId],
      );
      const row = rows[0] as { found: number; signed: number } | undefined;
      if (!row || row.found === 0) return 'not-found';
      return row.signed > 0 ? 'signed' : 'already';
    },

    /**
     * 家長請假之後通知老師（#1695）。通知是寫**別人**（老師、管理員）的 `notifications` 列，
     * 走不了 scope 寫入，所以做成一個窄能力：家長端路由拿不到原始 client，只能叫這一支。
     *
     * **先確認這張假屬於 scope 內的孩子**（同 org、`student_id` 在 scope），不是就什麼都不發、回 false ——
     * 帶別人的 leaveId 進來不會替別的孩子發通知。`sessionIds` 只是提示，收件人由
     * `notifyLeaveForTeachers` 自己從堂次推導（c1）；學生名也由這裡讀，不吃呼叫端給的。
     * 失敗只記 log（通知不擋請假）。
     *
     * 同一支也發管理員那則（`leave_received`，分校範圍＋`basic_operations`，`notifyLeaveForAdmins` 自己推導）；
     * 原因從 DB 的假單讀。`retroactive` 是路由算好的「蓋到的課有一堂已經開始」，只影響標題的「補請」。
     */
    async notifyLeave(
      leaveId: string,
      sessionIds: readonly string[],
      actorUserId: string,
      retroactive: boolean,
    ): Promise<boolean> {
      const leave = await ownLeave(leaveId, 'id, reason, students(name)');
      if (!leave) return false;
      const row = leave as { reason?: string | null; students?: { name?: string } | null };
      const studentName = row.students?.name ?? '';
      await Promise.all([
        notifyLeaveForTeachers(supabase, { orgId, actorUserId, leaveId, studentName, sessionIds }),
        notifyLeaveForAdmins(supabase, {
          orgId,
          leaveId,
          studentName,
          reason: row.reason ?? null,
          sessionIds,
          retroactive,
        }),
      ]);
      return true;
    },

    /**
     * 家長請假的稽核（#1695，計畫席 10-17）。家長補請會把缺席改成請假、沒有人核對，
     * 事後要查得到是誰、什麼時候、改了哪幾堂。`audit_logs` 不是孩子的資料、走不了 scope 寫入，
     * 所以跟 `notifyLeave` 一樣是窄能力：**先確認這張假屬於 scope 內的孩子**，不是就不寫、回 false。
     *
     * - actor 是 session 的使用者（呼叫端傳 `c.get('userId')`）
     * - 日期從 DB 的假單讀，不吃呼叫端
     * - **不帶個資全文**：`resourceName` 只有「家長請假／日期」，不寫學生或家長的名字；
     *   details 只有身分、改成請假的堂數、其中補請的堂數、略過的已點名堂數
     */
    /**
     * 家長在 App 送出報名／試聽申請之後通知分校管理員（#1731，規則照 #1711：班或課程所在分校、`manage_students`）。
     * 通知寫的是**別人**的 `notifications` 列，走不了 scope 寫入，所以跟 `notifyLeave` 一樣是窄能力：
     * **這次送出的每一筆都要是 scope 內孩子的、同 org 的**，少一筆對不上就整批不發、回 false。
     *
     * - 班／課程與學生名從 DB 的申請讀，不吃呼叫端
     * - 同一次送出（試聽一次多門課＝多筆）合成一則；識別碼取 id 最小的那筆，重送同一批是同一個去重鍵
     * - 失敗只記 log（`notifyNewApplication` 不丟例外）
     */
    async notifyRequests(
      kind: 'enrollment' | 'trial',
      requestIds: readonly string[],
    ): Promise<boolean> {
      const ids = [...new Set(requestIds)];
      if (writableIds.length === 0 || ids.length === 0) return false;
      const target = kind === 'enrollment' ? 'class_id' : 'course_id';
      const { data, error } = await supabase
        .from(kind === 'enrollment' ? 'enrollment_requests' : 'trial_requests')
        .select(`id, ${target}, students(name)`)
        .eq('org_id', orgId)
        .in('id', ids)
        .in('student_id', writableIds);
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
      if (error || rows.length !== ids.length) return false;
      rows.sort((a, b) => String(a['id']).localeCompare(String(b['id'])));
      const student = rows[0]!['students'] as { name?: string } | null;
      const targets = rows.map((r) => r[target] as string);
      await notifyNewApplication(supabase, {
        orgId,
        applicationId: rows[0]!['id'] as string,
        source: 'parent',
        kind,
        studentName: student?.name ?? '',
        ...(kind === 'enrollment' ? { classIds: targets } : { courseIds: targets }),
        requestCount: rows.length,
      });
      return true;
    },

    /**
     * 家長請假的寫入（#1970）：**跟管理端同一把鎖**（`lockStudentLeaves`，鍵＝org＋學生）、同一支重疊判準，
     * 一筆交易裡「取鎖 → 查重疊 → 寫假單」—— 家長連點、或家長和行政同時請同一段，只會有一張。
     *
     * 為什麼是 childDb 的能力、不是 route 自己拿 pool：pool 是沒綁 scope 的原始連線，
     * 給了家長端 route 就繞過了「拿不到錯的工具」（parent-data-scope.md 第二節）。這裡先驗孩子在 scope 內才動手。
     */
    async createLeave(input: {
      studentId: string;
      window: LeaveWindow;
      reason: string | null;
      userId: string;
    }): Promise<
      | { kind: 'created'; leave: Record<string, unknown> }
      | { kind: 'overlap' }
      | { kind: 'out-of-scope' }
      | { kind: 'failed' }
    > {
      if (!writableIds.includes(input.studentId)) return { kind: 'out-of-scope' };
      if (!pool) {
        console.error('[child-db] 沒有 pg pool，不建家長請假');
        return { kind: 'failed' };
      }
      try {
        return await withTx(pool, async (tx) => {
          await lockStudentLeaves(tx, orgId, input.studentId);
          if (await findConflictingLeaveViaSql(tx, orgId, input.studentId, input.window)) {
            return { kind: 'overlap' as const };
          }
          const leave = await insertLeave(tx, { orgId, ...input, role: 'parent' });
          return { kind: 'created' as const, leave };
        });
      } catch (err) {
        console.error(
          '[child-db] 家長請假寫入失敗（已回滾）:',
          err instanceof Error ? err.message : err,
        );
        return { kind: 'failed' };
      }
    },

    async recordLeave(
      leaveId: string,
      counts: {
        readonly sessionCount: number;
        readonly retroactiveSessionCount: number;
        readonly skippedAttendedCount: number;
      },
      actorUserId: string,
      waitUntil?: (promise: Promise<unknown>) => void,
    ): Promise<boolean> {
      const leave = (await ownLeave(leaveId, 'id, start_date, end_date')) as {
        start_date?: string;
        end_date?: string;
      } | null;
      if (!leave) return false;
      logAudit(
        supabase,
        {
          orgId,
          userId: actorUserId,
          resourceType: 'leave',
          resourceId: leaveId,
          resourceName: `家長請假 / ${leave.start_date} ~ ${leave.end_date}`,
          action: 'create',
          details: {
            submittedByRole: 'parent',
            sessionCount: counts.sessionCount,
            retroactiveSessionCount: counts.retroactiveSessionCount,
            skippedAttendedCount: counts.skippedAttendedCount,
          },
        },
        waitUntil,
      );
      return true;
    },

    /**
     * **機構層級的參考資料**（#1119 B）：班級目錄、課程、機構的期（#1076，成績的學期篩選）。
     * 不是孩子的資料，所以不套 scope，只帶 `org_id`。**白名單寫死、只讀** —— 不在這份清單的表
     * 傳不進來（型別錯誤）。
     * `enrollments` 不在這裡：家長只該知道「還有沒有位子」，見 `activeEnrollmentCount`。
     */
    orgRef(table: 'classes' | 'courses' | 'billing_periods' | 'campuses') {
      return {
        select(columns: string) {
          return supabase.from(table).select(columns).eq('org_id', orgId);
        },
      };
    },

    /**
     * 機構的帳戶資訊（#1073，家長待付款要看）。`organizations` 沒有 `org_id` 欄，走不了 `orgRef`；
     * **只回這一欄** —— 不把整份機構設定（財務設定等）開給家長。
     */
    async orgPaymentInfo(): Promise<{ paymentInfo: string | null; error: unknown }> {
      const { data, error } = await supabase
        .from('organizations')
        .select('payment_info')
        .eq('id', orgId)
        .maybeSingle();
      return {
        paymentInfo: (data as { payment_info?: string | null } | null)?.payment_info ?? null,
        error,
      };
    },

    /**
     * 這些分校裡，生效出勤模式是日到班的那些（#1075，家長到班頁決定要不要畫到班行）。
     * 判斷走 `resolveAttendanceMode`（分校設定優先、null 沿用機構預設）—— 家長端 route 碰不到原始
     * `supabase`，所以在這裡呼叫。**只回 id**，不把分校或機構的其他設定開給家長。
     */
    async dailyCheckinCampusIds(
      campusIds: readonly string[],
    ): Promise<{ ids: string[]; error: { message: string } | null }> {
      const modes = await Promise.all(
        campusIds.map((id) => resolveAttendanceMode(supabase, orgId, id)),
      );
      const failed = modes.find((m) => m.error);
      if (failed) return { ids: [], error: failed.error };
      return { ids: campusIds.filter((_, i) => modes[i]!.mode === 'daily_checkin'), error: null };
    },

    /**
     * 某班佔名額的人數（在籍＋待繳費，跟 `enrollments/validation.ts` 的額滿判斷同一組狀態）。
     * **只回數字**（head 查詢），不回任何別的學生的列。
     */
    async activeEnrollmentCount(classId: string): Promise<{ count: number; error: unknown }> {
      const { count, error } = await supabase
        .from('enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('class_id', classId)
        .in('status', ['active', 'pending_payment']);
      return { count: count ?? 0, error };
    },

    /**
     * 多班的佔名額人數（#1118 目錄）。**在這裡聚合成數字才交出去** —— 查詢只撈 `class_id`，
     * route 拿到的是 `Map<classId, number>`，碰不到任何報名列。單班版是 N 次 head 查詢，目錄不適用。
     */
    async activeEnrollmentCounts(
      classIds: readonly string[],
    ): Promise<{ counts: Map<string, number>; error: unknown }> {
      const counts = new Map<string, number>();
      if (classIds.length === 0) return { counts, error: null };
      const { data, error } = await supabase
        .from('enrollments')
        .select('class_id')
        .eq('org_id', orgId)
        .in('class_id', [...classIds])
        .in('status', ['active', 'pending_payment']);
      for (const row of (data ?? []) as Array<{ class_id: string }>) {
        counts.set(row.class_id, (counts.get(row.class_id) ?? 0) + 1);
      }
      return { counts, error };
    },

    /**
     * 查一張**沒有 `student_id` 欄位**的表，範圍靠 `ids` 是不是 `ScopedIds`
     * 型別在編譯期擋，不靠這裡再驗一次資料。
     */
    fromScopedIds(table: string, column: string, ids: ScopedIds) {
      return {
        select(
          columns: string,
          options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean },
        ) {
          return supabase.from(table).select(columns, options).in(column, ids);
        },
      };
    },

    /**
     * 家長請假之後的連續請假偵測（#1732，設計稿 kb/wiki/specs/admin/finance/leave-streak-waiver.md §3）。
     * 偵測要讀這個孩子的課表與出勤、通知要寫**別人**（財務管理員）的列，走不了 scope，所以跟
     * `notifyLeave` 一樣是窄能力：**先確認這張假屬於 scope 內的孩子**，不是就回 false。
     * 學生與日期從 DB 的假單讀，不吃呼叫端。失敗只記 log（`notifyLeaveStreaks` 不丟例外）。
     */
    async checkLeaveStreak(leaveId: string): Promise<boolean> {
      const leave = (await ownLeave(leaveId, 'id, student_id, start_date, end_date')) as {
        student_id: string;
        start_date: string;
        end_date: string;
      } | null;
      if (!leave) return false;
      await notifyLeaveStreaks(supabase, {
        orgId,
        studentId: leave.student_id,
        from: leave.start_date,
        to: leave.end_date,
      });
      return true;
    },
  };
}

export type ChildDb = ReturnType<typeof createChildDb>;
