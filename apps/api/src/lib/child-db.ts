import type { SupabaseClient } from '@supabase/supabase-js';
import type { StudentScope } from './child-scope';

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
export function createChildDb(supabase: SupabaseClient, scope: StudentScope, orgId: string) {
  /** 寫入用：`null`（不是家長）在寫入面一律 fail-closed，跟讀取面的「不加條件」刻意不同 */
  const writableIds = scope === null ? [] : [...scope];

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
     * **機構層級的參考資料**（#1119 B）：班級目錄、課程、機構的期（#1076，成績的學期篩選）。
     * 不是孩子的資料，所以不套 scope，只帶 `org_id`。**白名單寫死、只讀** —— 不在這份清單的表
     * 傳不進來（型別錯誤）。
     * `enrollments` 不在這裡：家長只該知道「還有沒有位子」，見 `activeEnrollmentCount`。
     */
    orgRef(table: 'classes' | 'courses' | 'billing_periods') {
      return {
        select(columns: string) {
          return supabase.from(table).select(columns).eq('org_id', orgId);
        },
      };
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
  };
}

export type ChildDb = ReturnType<typeof createChildDb>;
