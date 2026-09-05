import type { SupabaseClient } from '@supabase/supabase-js';
import type { StudentScope } from './child-scope';

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
export function createChildDb(supabase: SupabaseClient, scope: StudentScope) {
  return {
    /**
     * @param studentIdColumn 這張表存學生 id 的欄位 —— `students` 表本身用 `id`，
     *   其餘多半是 `student_id`。不同表欄位不同，所以由呼叫端指名（跟
     *   `applyCampusFilter` 的 `column` 參數同一個理由）。
     */
    from(table: string, studentIdColumn: string) {
      return {
        select(
          columns: string,
          options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean },
        ) {
          const query = supabase.from(table).select(columns, options);

          // `scope === null` 理論上不該發生在家長端 route（角色層已經擋掉非家長），
          // 但保留這個分支而不是假設它不會發生 —— 跟 `applyCampusFilter` 同一個判準。
          if (scope === null) return query;

          // 空陣列一樣要送進 `.in()`：沒綁小孩的家長要查到「什麼都沒有」，
          // 不是略過條件查到全部。這跟 `applyCampusFilter` 對空 campusScope 的處理一致。
          return query.in(studentIdColumn, [...scope]);
        },
      };
    },
  };
}

export type ChildDb = ReturnType<typeof createChildDb>;
