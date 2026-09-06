import type { AppEnv } from '../index';
import { applyCampusFilter, type CampusScope } from './campus-scope';

/**
 * 出勤事件是懶生成的 —— **唯一定義**，`routes/attendance.ts`（`/api/attendance/sessions`）
 * 與 `routes/sessions.ts`（`/api/sessions` 的 `attendanceTaken` 篩選）共用，形狀照
 * `lib/session-summary.ts` 的先例：查詢條件可以不一樣，形狀不行。
 *
 * 兩支端點都要對「有沒有點名」下條件，而條件下在 embed 的 `events` 欄位上
 * 必須配 `!inner` join（見 `lib/session-summary.ts` 的表格）—— 沒有 event 的
 * 課堂（懶生成還沒補建、或停課刻意不補）會被 inner join 排除，這正是「未點名」
 * 篩選要的效果。但**要下這個條件之前**，scheduled/completed 的課堂如果連 event
 * 都還沒生出來，會被誤判成「不存在」而不是「未點名」——所以查詢前要先呼叫這支
 * 補齊缺的 event。
 *
 * ## 為什麼補建在讀取路徑上（一支 GET 會寫入）
 *
 * **懶生成不是偷懶，是為了讓「停課」不必負責清理。**
 *
 * 課堂只有一條產生路徑（`POST /api/classes/:id/sessions`，`routes/classes.ts`
 * 的 upsert，而且它本身已經 race-safe），把 event 一併建在那裡結構上更乾淨。
 * **但那會打破一個刻意的不變量**：停課的課堂不補建出勤事件。
 *
 * #123 的原始理由是**機制上的**：只查停課時整段跳過，**一次讀取不該觸發寫入**。
 * 代價是那些課堂的 `eventId` 是 null，所以回應 schema 明著標成 nullable。
 *
 * > ⚠️ 這條理由在 2026-09-06 之前被**四處註解轉述成「補了行事曆會多出一筆不
 * > 存在的課」——那個版本是錯的**（本 repo 沒有行事曆畫面，`events` 也從來不被
 * > 直接列出：沒有 `/api/events`，其餘讀取端要嘛用已知 id 查、要嘛配 `!inner`）。
 * > 訂正見 issue #481。**正確的決定，理由在轉述中被換成了更好講的那個。**
 *
 * 產生時全部是 `scheduled`，所以全部會有 event；之後停課就得決定那筆 event
 * 怎麼辦，而那是新的寫入路徑與新的失敗模式（刪一半、event 上已經有點名記錄
 * 怎麼辦 —— 而 `attendance_records.event_id` 有外鍵，刪不掉）。
 *
 * **搬過去的真正代價**（#481 查出來的，不是「畫面會多一筆」）：停課的課堂
 * 一旦都有 event，**#485 那條缺陷的適用範圍會從「碰巧被補建過的那些」擴大到
 * 全部** —— 到班掃碼（`routes/daily-checkins.ts`）與扣堂數（`routes/session-packs.ts`）
 * 撈 event 時**都沒有 session status 過濾**。
 *
 * 所以**下一個為了「乾淨」想把補建搬到產生路徑的人：那個方向是對的，
 * 但你要先答「停課的課堂那筆 event 怎麼辦」**，而且要先確認 #485 已經修掉。
 * 重新評估的觸發條件就是那兩件，不是「哪天有空」。（分析全文見 #469 與 #481。）
 */
export type AttendanceSessionStatus = 'scheduled' | 'completed' | 'cancelled';

/**
 * 需要 `!inner` join 才篩得動的那個 select 片段要不要換上 `!inner`。
 *
 * `requireEvent` 對齊 `sessionSummarySelect({ requireEvent })` 的參數名 ——
 * 同一個判準（有沒有要對 `attendance_taken_at` 下條件）決定要不要加 `!inner`。
 */
/**
 * 剛插入的那批 event 裡，**沒有任何 session 指著的**（＝孤兒）。
 *
 * 補建是兩個非原子的步驟（`insert` 一批 event → 逐筆 CAS 認領），
 * **而第二步失敗時沒有補償的話，已插進去的那批會永遠留著**（#582）。
 * infra 實測：孤兒數 = 失敗數 × 該日課堂數，逐格吻合。
 *
 * ⚠️ **不能直接刪「我剛插入的全部」**：認領步驟「失敗」不等於「沒寫進去」——
 * 連線在 commit 之後斷掉的話，session 其實已經指著那個 event 了。
 * 刪掉它 FK 會 `SET NULL`（不報錯），那堂課**悄悄回到「沒有 event」**，
 * 而掛在上面的出勤紀錄從課堂就查不到了。
 *
 * 所以補償只刪**查得到沒人指著**的那些。
 */
export function unreferencedEventIds(
  insertedEventIds: readonly string[],
  claimedEventIds: readonly (string | null)[],
): string[] {
  const claimed = new Set(claimedEventIds.filter((id): id is string => !!id));
  return insertedEventIds.filter((id) => !claimed.has(id));
}

/**
 * 認領步驟失敗時的補償 —— 把這一批沒有被任何人認領到的 event 刪掉。
 *
 * **刪失敗不讓請求失敗**（同 CAS 成功路徑的處置）：孤兒對使用者不可見，
 * 為了清一筆看不見的垃圾而讓整份課表 400，代價完全不對等。
 *
 * ### ⚠️ 這不是一個 transaction
 *
 * PostgREST 沒有跨語句 transaction，所以「插 event」與「認領」之間**永遠**有一個
 * 失敗態。補償是盡力而為的，補償自己也可能失敗。**失敗態長這樣**：
 * `events` 裡有一列 `event_type = 'session'`，而沒有任何 `sessions.event_id` 指著它。
 *
 * **可以直接貼上去跑的不變量查詢**（找出所有孤兒）：
 *
 * ```sql
 * SELECT e.id, e.event_date, e.title
 * FROM events e
 * WHERE e.event_type = 'session'
 *   AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.event_id = e.id)
 * ORDER BY e.event_date DESC;
 * ```
 *
 * **刻意不做成 gate**：它的輸入是整個 DB 的狀態不是改動，放在分支上沒有意義
 * （infra 判斷、計畫席同意，#582）。
 */
async function compensateUnclaimedEvents(
  supabase: AppEnv['Variables']['supabase'],
  insertedEventIds: readonly string[],
): Promise<void> {
  if (insertedEventIds.length === 0) return;

  const { data: claimedRows, error: claimedError } = await supabase
    .from('sessions')
    .select('event_id')
    .in('event_id', [...insertedEventIds]);

  if (claimedError) {
    console.warn('[attendance-events] 補償查詢失敗，可能留下孤兒 event', claimedError.message);
    return;
  }

  const orphanIds = unreferencedEventIds(
    insertedEventIds,
    ((claimedRows ?? []) as Array<{ event_id: string | null }>).map((row) => row.event_id),
  );

  if (orphanIds.length === 0) return;

  const { error: deleteError } = await supabase.from('events').delete().in('id', orphanIds);
  if (deleteError) {
    console.warn('[attendance-events] 補償刪除失敗，留下孤兒 event', deleteError.message);
  }
}

export function eventsJoinModifier(requireEvent: boolean): string {
  return requireEvent ? '!event_id!inner' : '!event_id';
}

/**
 * 「有沒有點名」的過濾條件 —— **`/api/attendance/sessions` 與 `/api/sessions` 的
 * `attendanceTaken` 共用同一份判定**，不是兩支各自實作再靠測試比對。這樣兩支
 * 要嘛一起對、要嘛一起錯，不會出現「同一個概念兩支端點各算一次然後漂移」。
 *
 * 呼叫端要先把 select 換成 `!inner`（見 `eventsJoinModifier`）——這支只負責
 * 下條件，不驗證有沒有配對的 join，那個前提由呼叫端保證。
 */
export function applyAttendanceTakenFilter<
  T extends { is(...args: any[]): T; not(...args: any[]): T },
>(query: T, attendanceTaken: boolean | undefined): T {
  if (attendanceTaken === false) return query.is('events.attendance_taken_at', null);
  if (attendanceTaken === true) return query.not('events.attendance_taken_at', 'is', null);
  return query;
}

export async function ensureAttendanceSessionEvents(input: {
  readonly supabase: AppEnv['Variables']['supabase'];
  readonly orgId: string;
  /**
   * 呼叫者看得到的分校。**這支會「補建」出勤事件（寫入），所以範圍不能只靠讀取端過濾**
   * —— 少了它，A 校的管理員查詢時會替 B 校的課堂建立 event。
   */
  readonly campusScope: CampusScope;
  readonly campusId?: string;
  readonly courseIdList: readonly string[];
  readonly classIdList: readonly string[];
  readonly statusList: readonly AttendanceSessionStatus[];
  readonly dateFromValue?: string;
  readonly dateToValue?: string;
}): Promise<{ readonly created: number; readonly error: string | null }> {
  const {
    supabase,
    orgId,
    campusScope,
    campusId,
    courseIdList,
    classIdList,
    statusList,
    dateFromValue,
    dateToValue,
  } = input;

  let missingSessionsQuery = supabase
    .from('sessions')
    .select(
      `
      id,
      event_id,
      session_date,
      start_time,
      end_time,
      status,
      class_id,
      classes!inner(name, course_id, campus_id, courses(name))
    `,
    )
    .eq('org_id', orgId)
    .is('event_id', null)
    .in('status', [...statusList]);

  if (dateFromValue) {
    missingSessionsQuery = missingSessionsQuery.gte('session_date', dateFromValue);
    missingSessionsQuery = missingSessionsQuery.lte('session_date', dateToValue ?? dateFromValue);
  }

  missingSessionsQuery = applyCampusFilter(
    missingSessionsQuery,
    'classes.campus_id',
    campusScope,
    campusId,
  );
  if (courseIdList.length > 0) {
    missingSessionsQuery = missingSessionsQuery.in('classes.course_id', [...courseIdList]);
  }
  if (classIdList.length > 0) {
    missingSessionsQuery = missingSessionsQuery.in('class_id', [...classIdList]);
  }

  const { data: missingSessions, error: missingSessionsError } = await missingSessionsQuery;
  if (missingSessionsError) {
    return { created: 0, error: missingSessionsError.message };
  }

  if (!missingSessions || missingSessions.length === 0) {
    return { created: 0, error: null };
  }

  const eventsToInsert = missingSessions.map((session: any) => {
    const classRow = Array.isArray(session.classes) ? session.classes[0] : session.classes;

    return {
      id: crypto.randomUUID(),
      org_id: orgId,
      event_type: 'session' as const,
      title: classRow?.name ?? '課堂',
      campus_id: classRow?.campus_id ?? null,
      event_date: session.session_date,
      start_time: session.start_time,
      end_time: session.end_time,
    };
  });

  const { error: insertEventsError } = await supabase.from('events').insert(eventsToInsert);
  if (insertEventsError) {
    return { created: 0, error: insertEventsError.message };
  }

  // **認領是 compare-and-set，不是無條件覆寫。**
  //
  // 這三步（讀缺的 → 建 event → 寫回 `sessions.event_id`）之間沒有鎖，而
  // `events` 表只有 `id PRIMARY KEY`、id 又是 `crypto.randomUUID()` 生的
  // —— **兩個並行請求生的 id 必然不同，所以不可能撞到任何約束**。少了
  // `is('event_id', null)`，晚到的請求會把先到的請求已經寫好的 event_id 蓋掉。
  //
  // 最壞的後果不是多一列垃圾：如果在兩次覆寫之間有人在舊 event 上點過名，
  // **那次點名會從課堂查不到**（記錄掛在舊 event 上，而課堂已經指向新的）——
  // 而它不會報錯，只是消失。
  //
  // **這個併發不是理論的。** 缺 event 的集合在剛排完課那一刻最大
  //（`POST /api/classes/:id/sessions` 一次產生一整期、全部 `event_id IS NULL`），
  // 而那正好是好幾個人會去看課表的時間點 —— **風險最高的時刻與人最多的時刻重疊**。
  // 兩個行政同時載入儀表板、或一個人重新整理兩次就夠了。
  const sessionUpdateResults = await Promise.all(
    missingSessions.map((session: any, index) =>
      supabase
        .from('sessions')
        .update({ event_id: eventsToInsert[index]?.id ?? null })
        .eq('id', session.id)
        .is('event_id', null)
        .select('id'),
    ),
  );

  const updateError = sessionUpdateResults.find((result) => result.error)?.error;
  if (updateError) {
    // **補償**：認領失敗就把這一批沒人認領到的 event 收回去（#582）。
    // 少了這一步，已插進去的那批會永遠留著 —— infra 實測孤兒數 = 失敗數 × 該日課堂數。
    await compensateUnclaimedEvents(
      supabase,
      eventsToInsert.map((event) => event.id),
    );
    return { created: 0, error: updateError.message };
  }

  // 沒搶到的那些，把自己剛建的 event 收回去 —— 不留孤兒
  const unclaimedEventIds = sessionUpdateResults
    .map((result, index) =>
      ((result.data ?? []) as unknown[]).length === 0 ? eventsToInsert[index]?.id : undefined,
    )
    .filter((id): id is string => Boolean(id));

  if (unclaimedEventIds.length > 0) {
    // **刪失敗不讓請求失敗。** 孤兒 event 對使用者不可見（沒有 `/api/events`；
    // 其餘讀取端要嘛用已知 id 查、要嘛配 `!inner` 排除掉沒有 session 的列），
    // 為了清一筆看不見的垃圾而讓整份課表 400，代價完全不對等。
    await supabase.from('events').delete().in('id', unclaimedEventIds);
  }

  // 回**真的認領到幾筆**，不是「本來想建幾筆」—— 後者在有競爭時會誇大
  return { created: missingSessions.length - unclaimedEventIds.length, error: null };
}
