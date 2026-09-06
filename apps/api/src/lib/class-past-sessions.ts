import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentTaipeiDateString } from './taipei-date';

/**
 * 這些班級裡，哪些有「過去日期的課堂」—— **唯一定義**，`routes/classes.ts` 的列表
 * 顯示（`hasPastSessionsSet`）、單筆刪除守門、批次刪除守門三處共用，不是三份各自
 * 判斷。
 *
 * 這三處原本各自寫一次 `.lt('session_date', new Date().toISOString().slice(0, 10))`
 * ——不只是重複，**是不同層級的重複**：一處是顯示用，兩處是刪除守門。顯示用的那份
 * 跟守門用的那份如果各自漂移，畫面會說「這個班沒有過去課堂」而守門說有（或反過來），
 * 而使用者只看得到前者。收斂成一份之後，這種漂移在結構上不可能發生。
 *
 * 時區也修了：`new Date().toISOString()` 是 UTC，在台北時間 00:00–08:00 之間會
 * 算成前一天。一個班有「台北昨天」的課堂，在那個窗口會被判定成「沒有過去課堂」，
 * 可以被刪除——跟 #402 leaves.ts 的根因同一族，但這裡的後果是**帶著真實出勤紀錄
 * 的班級被級聯刪除**，是 M8 稽核那個家族（#371 的 session_packs 守門）的鄰居。
 *
 * 查詢失敗一律回 `check-failed`：**顯示用**的呼叫端可以接受退回空集合（跟現況
 * 一致，不是這次要動的風險），**刪除守門**的呼叫端必須 fail closed（查不到答案
 * 不准刪），這是刻意分開兩種呼叫端行為，不是遺漏。
 */
export type ClassesPastSessionsCheck =
  | { readonly status: 'ok'; readonly classIdsWithPastSessions: ReadonlySet<string> }
  | { readonly status: 'check-failed'; readonly message: string };

export async function checkClassesPastSessions(
  supabase: SupabaseClient,
  classIds: readonly string[],
): Promise<ClassesPastSessionsCheck> {
  if (classIds.length === 0) {
    return { status: 'ok', classIdsWithPastSessions: new Set() };
  }

  const { data, error } = await supabase
    .from('sessions')
    .select('class_id')
    .in('class_id', classIds)
    .lt('session_date', getCurrentTaipeiDateString());

  if (error) {
    return { status: 'check-failed', message: error.message };
  }

  return {
    status: 'ok',
    classIdsWithPastSessions: new Set(
      (data ?? []).map((row) => (row as { class_id: string }).class_id),
    ),
  };
}
