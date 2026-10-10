import {
  ENROLLMENT_STATUS_LABELS,
  type Enrollment,
  type EnrollmentEventKind,
} from '@core/enrollments.service';

export type { EnrollmentEventKind };

/**
 * 一筆報名在進出總覽裡是哪一種事件（A6 / #1314 EN5：四種，用產品的狀態詞）。
 *
 * 判準跟 API 的計數同一份（`routes/enrollments/list-query.ts` 的 `eventFilter`，#1507）——
 * 兩邊不一樣，Hero 的數字就會跟列上的 pill 對不上。
 */
export interface EnrollmentEvent {
  readonly kind: EnrollmentEventKind;
  /** 這件事發生的日期：退班／作廢看 effectiveTo、暫停看 statusChangedAt、新報名看 effectiveFrom */
  readonly date: string;
}

type EventFields = Pick<Enrollment, 'status' | 'effectiveFrom' | 'effectiveTo' | 'statusChangedAt'>;

/**
 * 同一列可能兩件事都發生過（當月報名、當月又退掉）：
 * - 有指定事件篩選時，就顯示那件事 —— 篩「新報名」時那列寫「新報名」，不寫「退班」
 * - 沒指定時取最終狀態：作廢 → 作廢；退班或 effective_to 已到（含到期結束）→ 退班；暫停 → 暫停
 */
export function toEnrollmentEvent(
  enrollment: EventFields,
  today: string,
  filtered?: EnrollmentEventKind | null,
): EnrollmentEvent {
  const kind = filtered ?? finalKind(enrollment, today);
  // 理論上退班／作廢一定有 effectiveTo（updateStatus 會寫），但舊資料或手改的不保證
  const endedOn = enrollment.effectiveTo ?? enrollment.statusChangedAt ?? enrollment.effectiveFrom;

  switch (kind) {
    case 'left':
    case 'voided':
      return { kind, date: endedOn };
    // 暫停不寫 effective_to（人還在班上），它唯一的日期是 status_changed_at
    case 'paused':
      return { kind, date: enrollment.statusChangedAt ?? enrollment.effectiveFrom };
    default:
      return { kind, date: enrollment.effectiveFrom };
  }
}

function finalKind(enrollment: EventFields, today: string): EnrollmentEventKind {
  if (enrollment.status === 'void') return 'voided';
  // 同 API 的 left：effective_to 到了就離開名冊（排定日還沒到的在籍生不是退班）
  const ended = enrollment.effectiveTo !== null && enrollment.effectiveTo <= today;
  if (enrollment.status === 'withdrawal' || ended) return 'left';
  if (enrollment.status === 'suspended') return 'paused';
  return 'joined';
}

/** 到期結束：還是 active，但 effective_to 已經過了（當天還在籍，所以是 `<`） */
const expired = (enrollment: EventFields, today: string): boolean =>
  enrollment.status === 'active' &&
  enrollment.effectiveTo !== null &&
  enrollment.effectiveTo < today;

/**
 * 狀態欄顯示的字。到期結束的人 DB 上仍是 active，但已不在名冊上 —— 寫「在學」是對行政說錯話，
 * 所以前端推導成「已結束」，不動 enum（計畫席 10-10 裁 (c)）。
 */
export function statusLabel(enrollment: EventFields, today: string): string {
  return expired(enrollment, today) ? '已結束' : ENROLLMENT_STATUS_LABELS[enrollment.status];
}

/** 「退班」pill 下的副行：A6 只有一種退班 pill，辦理退班與到期結束靠這行分 */
export function leftNote(enrollment: EventFields): string {
  return enrollment.status === 'withdrawal' ? '辦理退班' : '到期結束';
}

export const EVENT_LABELS: Record<EnrollmentEventKind, string> = {
  joined: '新報名',
  left: '退班',
  paused: '暫停',
  voided: '作廢',
};
