import type { Enrollment } from '@core/enrollments.service';

/**
 * 一筆報名在進出總覽裡是哪一種事件（A6 / #1314 EN5：四種，用產品的狀態詞）。
 *
 * 同一列可能兩件事都發生過（當月報名、當月又退掉），所以這不是查事實而是選一個要顯示的
 * 面向 —— 取最終狀態：退掉了就是退班、暫停了就是暫停。
 */
export type EnrollmentEventKind = 'joined' | 'left' | 'paused' | 'voided';

export interface EnrollmentEvent {
  readonly kind: EnrollmentEventKind;
  /** 這件事發生的日期：退班／作廢看 effectiveTo、暫停看 statusChangedAt、新報名看 effectiveFrom */
  readonly date: string;
}

export function toEnrollmentEvent(
  enrollment: Pick<Enrollment, 'status' | 'effectiveFrom' | 'effectiveTo' | 'statusChangedAt'>,
): EnrollmentEvent {
  // 理論上退班／作廢一定有 effectiveTo（updateStatus 會寫），但舊資料或手改的不保證
  const endedOn = enrollment.effectiveTo ?? enrollment.statusChangedAt ?? enrollment.effectiveFrom;

  switch (enrollment.status) {
    case 'withdrawal':
      return { kind: 'left', date: endedOn };
    case 'void':
      return { kind: 'voided', date: endedOn };
    // 暫停不寫 effective_to（人還在班上、排定的結束日也還沒到），它唯一的日期是 status_changed_at
    case 'suspended':
      return { kind: 'paused', date: enrollment.statusChangedAt ?? enrollment.effectiveFrom };
    default:
      return { kind: 'joined', date: enrollment.effectiveFrom };
  }
}

export const EVENT_LABELS: Record<EnrollmentEventKind, string> = {
  joined: '新報名',
  left: '退班',
  paused: '暫停',
  voided: '作廢',
};
