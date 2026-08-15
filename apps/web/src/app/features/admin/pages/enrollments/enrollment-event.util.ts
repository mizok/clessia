import type { Enrollment, EnrollmentStatus } from '@core/enrollments.service';

/**
 * 一筆報名在進出總覽裡算「新報名」還是「退班」。
 *
 * 同一列可能兩件事都發生過（當月報名、當月又退掉），所以這不是查事實而是選一個要顯示的
 * 面向 —— 取最終狀態：退掉了就是退班。
 */
export type EnrollmentEventKind = 'joined' | 'left';

/** 只有終態算退出。`suspended` 不寫 effective_to，排定未來結束日的在籍生也還沒離開 */
const TERMINAL_STATUSES: ReadonlySet<EnrollmentStatus> = new Set(['withdrawal', 'void']);

export interface EnrollmentEvent {
  readonly kind: EnrollmentEventKind;
  /** 這件事發生的日期：退班看 effectiveTo、新報名看 effectiveFrom */
  readonly date: string;
}

export function toEnrollmentEvent(
  enrollment: Pick<Enrollment, 'status' | 'effectiveFrom' | 'effectiveTo'>,
): EnrollmentEvent {
  if (TERMINAL_STATUSES.has(enrollment.status)) {
    // 理論上退班一定有 effectiveTo（updateStatus 會寫），但舊資料或手改的不保證
    return { kind: 'left', date: enrollment.effectiveTo ?? enrollment.effectiveFrom };
  }

  return { kind: 'joined', date: enrollment.effectiveFrom };
}

export const EVENT_LABELS: Record<EnrollmentEventKind, string> = {
  joined: '新報名',
  left: '退班',
};
