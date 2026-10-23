import type { SupabaseClient } from '@supabase/supabase-js';

import type { AttendanceMode } from './attendance-mode';
import type { CampusScope } from './campus-scope';
import { enrolledEventIds } from './enrolled-events';
import { toSessionRows } from './cancelled-session';
import {
  LEAVE_WINDOW_COLUMNS,
  leaveCoversSession,
  toLeaveWindow,
  type SessionWindow,
} from './leave-covers-session';

export interface DailyCheckinEnrollment {
  class_id: string;
  effective_from: string;
  effective_to: string | null;
}

/**
 * 到班打卡的寫入：一筆 `daily_checkins`，日到班模式再替當天有報名的課堂補 `attendance_records`。
 *
 * **兩個入口共用這一份**：機台／櫃台的 `POST /api/daily-checkins`，以及老師在到班名單上按
 * 「他到了」的 `POST /api/attendance/roster/{eventId}/check-in`（#1314 TS3）。後者是寫出勤的
 * 上游（扣堂），各寫一份的話兩邊對「誰該寫成出席」遲早會有兩個答案。
 *
 * 授權（誰能替誰、哪天、哪個分校打卡）**不在這裡** —— 兩個入口的規則不同，各自在路由裡先擋完。
 * `mode` 也由呼叫端先讀好：讀不到模式時該在任何寫入之前停（見 `resolveAttendanceMode`）。
 */
export async function writeDailyCheckin(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    userId: string;
    studentId: string;
    campusId: string | undefined;
    checkinDate: string;
    /** 沒指名分校時，受限的呼叫者只寫得到自己分校的課堂（#966） */
    campusScope: CampusScope;
    mode: AttendanceMode;
    /**
     * 到班來源（#1100 #52）：`scan`＝掃碼、`manual`＝人工標記。**由呼叫端（伺服器）決定**，不信前端：
     * 機台一律 scan、老師名單「他到了」一律 manual、行政打卡端點照參數（沒帶當 manual）。
     * 重掃不覆寫（ignoreDuplicates），所以留下的是第一次那筆的來源
     */
    source: 'scan' | 'manual';
  },
): Promise<
  | {
      error: null;
      checkin: Record<string, unknown>;
      alreadyCheckedIn: boolean;
      enrollmentRows: DailyCheckinEnrollment[];
      coveredByLeave: (session: SessionWindow) => boolean;
      eventIds: string[];
    }
  | { error: { message?: string } }
> {
  const { orgId, userId, studentId, campusId, checkinDate } = input;

  // 1. 建立打卡紀錄。一天最多一次（specs/public/qr-checkin.md，UNIQUE: student_id, checkin_date）。
  //    **重掃不覆寫**（#1127）：原本沒有 `ignoreDuplicates`，第二張卡會把 `checked_in_at`
  //    改成重掃的時間。衝突時 PostgREST 回空陣列（不能接 `.single()`），讀回第一次那筆。
  const checkinKey = { student_id: studentId, checkin_date: checkinDate };
  const { data: inserted, error: insertError } = await supabase
    .from('daily_checkins')
    .upsert(
      {
        org_id: orgId,
        ...checkinKey,
        campus_id: campusId ?? null,
        checked_in_at: new Date().toISOString(),
        checked_in_by: userId,
        source: input.source,
      },
      { onConflict: 'student_id,checkin_date', ignoreDuplicates: true },
    )
    .select();
  let checkin = inserted?.[0] as Record<string, unknown> | undefined;
  const alreadyCheckedIn = !insertError && !checkin;
  let error = insertError;
  if (!error && !checkin) {
    const existing = await supabase
      .from('daily_checkins')
      .select()
      .eq('org_id', orgId)
      .eq('student_id', checkinKey.student_id)
      .eq('checkin_date', checkinKey.checkin_date)
      .maybeSingle();
    checkin = (existing.data as Record<string, unknown> | null) ?? undefined;
    error = existing.error;
  }

  if (error || !checkin) return { error: { message: error?.message } };

  // 2. 課堂模式（per_session）：打卡只記到班時間，不直接完成課堂出勤，由管理員或老師逐堂點名
  //    （rules/attendance-rules.md 1.2，#1099）。原本整支沒讀模式，兩種模式都替課堂寫 present。
  //    **取消打卡（DELETE）那段不跟著看模式**：它只刪掃碼寫的（`system` + `present`），
  //    課堂模式本來就不會有；當天中途切換模式時，早先日到班寫的那些仍要刪得掉。
  // 在籍條件照抄 roster（`status = 'active'` + 生效區間）—— 掃碼寫得出來的紀錄，
  // 必須是那堂課點名時看得到的人，否則會出現「有出勤紀錄但名單上沒這個人」的鬼影。
  // 兩種模式都要讀：確認畫面的「今日課堂」用同一份（#1127）。
  // 假單同理：寫出勤（#1201）與確認畫面的 `onLeave` 共用這一份、同一支 `coveredByLeave`。
  const [{ data: enrollments }, { data: leaveRows }] = await Promise.all([
    supabase
      .from('enrollments')
      .select('class_id, effective_from, effective_to')
      .eq('org_id', orgId)
      .eq('student_id', studentId)
      .eq('status', 'active'),
    supabase
      .from('leave_requests')
      .select(LEAVE_WINDOW_COLUMNS)
      .eq('org_id', orgId)
      .eq('student_id', studentId)
      .lte('start_date', checkinDate)
      .gte('end_date', checkinDate),
  ]);
  const enrollmentRows = (enrollments ?? []) as DailyCheckinEnrollment[];
  const leaves = ((leaveRows ?? []) as Array<Record<string, unknown>>).map(toLeaveWindow);
  const coveredByLeave = (session: SessionWindow) =>
    leaves.some((leave) => leaveCoversSession(leave, session));

  let eventIds: string[] = [];
  if (input.mode === 'daily_checkin') {
    // 2. 替該學生當天**實際有報名**的課堂建立 attendance_records（present）
    //
    // **原本是「當天這個分校的所有課堂」** —— 包含他根本沒報名的班，於是出勤紀錄裡
    // 會冒出他從來沒上過的課，而那些紀錄會流進扣課與月結（使用者 2026-09-03 裁定）。
    //
    // 到班紀錄（步驟 1）與課堂出勤是**兩層**：人到了就是到了，即使他今天一堂課都沒有。
    // 所以這一段一筆都寫不出來是正常結果，不是失敗。
    //
    // **停課的課堂不寫**（使用者 2026-09-06 裁定 1(a)，issue #485）——
    // 裁的是不寫**課堂出勤**（這一層），**學生本人的到班紀錄（步驟 1）照舊寫**。
    // 兩層在這裡是兩張表、兩段程式碼，所以分得開。
    // `sessions(class_id, status)` —— **`status` 是給停課過濾用的**，漏了它
    // `enrolledEventIds` 會退回「照舊寫」（理由見 `lib/cancelled-session.ts`）。
    // 條件不下在查詢上是刻意的：對 embed 欄位下條件要配 `!inner`，而那會連
    // 「沒有 session 的 event」（**`event_type = 'mock_exam'`**）一起排除掉 ——
    // 那一條規則屬於 `enrolledEventIds`，兩處各判一次遲早會漂。
    //
    // 實測（api-2，2026-09-07）：造一筆 `mock_exam` 事件之後，照原樣回 20 筆、
    // 加上 `!inner` 回 19 筆 —— 那筆確實會被吃掉。
    let eventsQuery = supabase
      .from('events')
      .select('id, start_time, end_time, sessions(id, class_id, status)')
      .eq('org_id', orgId)
      .eq('event_date', checkinDate);

    if (campusId) {
      eventsQuery = eventsQuery.eq('campus_id', campusId);
    } else if (input.campusScope !== null) {
      // 沒指名分校時，受限的呼叫者只寫得到自己分校的課堂（#966）：
      // 跨分校的孩子在 B 校當天的課，不該被 A 校的打卡寫成 present
      eventsQuery = eventsQuery.in('campus_id', [...input.campusScope]);
    }

    const { data: events } = await eventsQuery;

    eventIds = enrolledEventIds(
      (events ?? []) as Array<{
        id: string;
        sessions?:
          | { class_id?: string | null; status?: string | null }
          | Array<{ class_id?: string | null; status?: string | null }>
          | null;
      }>,
      enrollmentRows,
      checkinDate,
    );

    if (eventIds.length > 0) {
      // 被假單蓋到的課堂寫 `on_leave` 不寫 `present`（#1201）。請假連動只寫得到建單當下
      // **已經存在**的 event，而 event 是讀取時才補建的 —— 家長提前請假時那堂還沒有紀錄，
      // 學生到校一掃碼就被寫成出席、流進扣課。
      // 寫 `on_leave` 而不是跳過：點名名單送出時也是替被蓋到的人補寫 `on_leave`（system）。
      const eventById = new Map(
        ((events ?? []) as Array<Record<string, any>>).map((event) => [event['id'], event]),
      );
      const eventOnLeave = (eventId: string) => {
        const event = eventById.get(eventId);
        return coveredByLeave({
          sessionId: toSessionRows<{ id?: string }>(event?.['sessions'])[0]?.id ?? null,
          date: checkinDate,
          startTime: event?.['start_time'] ?? null,
          endTime: event?.['end_time'] ?? null,
        });
      };

      await supabase.from('attendance_records').upsert(
        eventIds.map((eventId: string) => ({
          org_id: orgId,
          student_id: studentId,
          event_id: eventId,
          status: eventOnLeave(eventId) ? 'on_leave' : 'present',
          recorded_by: userId,
          recorded_by_role: 'system',
        })),
        // **只補沒有的，不動已經存在的。** 掃碼是機器讀到一張卡，不該推翻老師的判斷 ——
        // 老師改成缺席、學生事後補掃，原本會被改回 present 而且不留痕跡。
        // 掃碼寫的只有 `present` 與假單推得出的 `on_leave`，所以「跳過已存在的」不會漏掉任何資訊。
        // 取消打卡（DELETE）只刪 `present`：這裡寫的 `on_leave` 跟著假單走，不跟著這次打卡走。
        { onConflict: 'student_id,event_id', ignoreDuplicates: true },
      );
    }
  }

  return { error: null, checkin, alreadyCheckedIn, enrollmentRows, coveredByLeave, eventIds };
}
