import { HttpErrorResponse } from '@angular/common/http';

import type { DailyCheckinConfirmation } from '@core/daily-checkins.service';

/**
 * 打卡結果要對學生講的話（#1127，設計稿 b6 pub-qr-checkin）。純函式：元件只管流程與倒數。
 *
 * **每一句都照實際紀錄講**（`attendance` 是寫完之後讀回的）—— 「已記出席」說錯了，
 * 學生會以為不用再做什麼；「這次沒有記到」不說，學生會以為打過了。
 */
export interface CheckinView {
  tone: 'ok' | 'leave';
  headline: string;
  summary: string;
  note: string | null;
  rows: Array<{ sessionId: string; time: string; className: string; label: string }>;
}

export interface CheckinFailure {
  title: string;
  note: string;
  /** 離線：同一張卡再掃一次就好，按鈕叫「再掃一次」不叫「下一位」 */
  retry: boolean;
}

const hhmm = (time: string) => time.slice(0, 5);

/** 打卡時間用台北時鐘講（機台可能是任何時區設定的平板） */
export function taipeiClock(iso: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

type Session = DailyCheckinConfirmation['todaySessions'][number];

function rowLabel(s: Session): string {
  switch (s.attendance) {
    case 'present':
      return '已記出席';
    case 'on_leave':
      return '請假（不變）';
    case 'absent':
      return '已記缺席';
    default:
      return s.onLeave ? '請假' : '等老師點名';
  }
}

export function checkinView(r: DailyCheckinConfirmation): CheckinView {
  const name = r.student.name;
  const at = taipeiClock(r.checkedInAt);
  const sessions = r.todaySessions;
  const rows = sessions.map((s) => ({
    sessionId: s.sessionId,
    time: `${hhmm(s.startTime)}–${hhmm(s.endTime)}`,
    className: s.className,
    label: rowLabel(s),
  }));
  const allOnLeave = sessions.length > 0 && sessions.every((s) => s.onLeave);
  const allPresent = sessions.length > 0 && sessions.every((s) => s.attendance === 'present');

  if (r.alreadyCheckedIn) {
    return {
      tone: 'ok',
      headline: `${name} 今天 ${at} 已經打過卡了`,
      summary: '不用再打。',
      note: null,
      rows,
    };
  }

  const headline = `${name}，${at} 到班`;
  if (sessions.length === 0) {
    return {
      tone: 'ok',
      headline,
      summary: '今天沒有你的課。',
      note: '到班時間記下來了，但不會記任何一堂出席。來補課或自習的話，請找櫃台。',
      rows,
    };
  }
  if (allOnLeave) {
    return {
      tone: 'leave',
      headline,
      summary: '你今天請假了，請假的課不會改成出席。',
      note: '要來上課的話，請找櫃台銷假。',
      rows,
    };
  }
  if (r.attendanceMode === 'per_session') {
    return {
      tone: 'ok',
      headline,
      summary: '到班時間記下來了，出席由老師上課時點名。',
      note: null,
      rows,
    };
  }
  return {
    tone: 'ok',
    headline,
    // 日到班但有堂沒記到（當天課堂還沒生成、或請假）—— 不說「都記出席了」
    summary: allPresent ? '今天的課都記出席了。' : '到班時間記下來了。',
    note: sessions.some((s) => s.onLeave)
      ? '請假的課不會改成出席；要來上課的話，請找櫃台銷假。'
      : null,
    rows,
  };
}

export function checkinFailure(err: unknown): CheckinFailure {
  const status = err instanceof HttpErrorResponse ? err.status : -1;
  if (status === 0) {
    return {
      title: '這次沒有記到',
      note: '這台裝置沒有網路。請確認 Wi-Fi 後再掃一次；一直不行就請找櫃台登記到班。',
      retry: true,
    };
  }
  if (status === 400 || status === 404) {
    return {
      title: '這張卡讀不到學生',
      note: '不是本補習班的學生證，或卡已經停用。請找櫃台確認，櫃台可以先幫你登記到班。',
      retry: false,
    };
  }
  if (status === 403) {
    return {
      title: '這張卡不能在這裡打卡',
      note: '可能是別的分校的學生。請找櫃台確認，櫃台可以先幫你登記到班。',
      retry: false,
    };
  }
  if (status === 401) {
    return { title: '機台已登出', note: '請通知櫃台重新登入這台機台。', retry: false };
  }
  return {
    title: '這次沒有記到',
    note: '打卡失敗，請再掃一次；一直不行就請找櫃台登記到班。',
    retry: true,
  };
}
