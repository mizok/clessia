import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  AttendanceService,
  type AttendanceRoster,
  type RosterStudent,
} from '@core/attendance.service';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { GRADE_LEVEL_LABELS } from '@core/students.service';
import { AuthService } from '@core/auth.service';
import { todayLocal } from '@shared/utils/session-time.util';
import {
  InlineNoticeComponent,
  type InlineNoticeSeverity,
} from '@shared/components/inline-notice/inline-notice.component';
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';

export interface RosterPanelSession {
  eventId: string;
  className: string;
  eventDate: string;
  /**
   * 選填的時間區間（`19:00–21:00`）。同一個班同一天可能有兩堂課，只有日期分不出是哪一堂。
   *
   * 刻意**不收**出勤統計與課程／分校名：呼叫端的列表上就有那些（`session-list` 的
   * 「到 N ・ 請 N ・ 缺 N」），而且開啟時抓的統計在編輯過程中不會更新 ——
   * 一個不同步的數字擺在正在編輯的畫面上，比沒有更糟。
   */
  timeRange?: string;
}

@Component({
  selector: 'app-attendance-roster-panel',
  standalone: true,
  imports: [DataChipComponent, ButtonModule, ProgressSpinnerModule, InlineNoticeComponent],
  templateUrl: './attendance-roster-panel.component.html',
  styleUrl: './attendance-roster-panel.component.scss',
})
export class AttendanceRosterPanelComponent implements OnInit {
  private readonly attendanceService = inject(AttendanceService);
  private readonly auth = inject(AuthService);
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);

  protected readonly session = this.config.data as RosterPanelSession;

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  /** 正在銷假的學生 id —— 逐列 loading，不是整個面板 */
  protected readonly cancelling = signal<string | null>(null);
  protected readonly roster = signal<AttendanceRoster | null>(null);
  /**
   * 只放**老師實際標過**的人。沒有出現在這個 Map 裡就是「還沒標」。
   *
   * 原本這裡把沒有紀錄的人預設成 `absent`，而「缺席」在畫面上是實心（選中態）——
   * 面板一打開，全班看起來已經被標成缺席，直接按儲存就是全班記缺席。
   * 那是把「我還沒點」跟「我點了，他沒來」混成同一件事，而預設倒向了指控。
   */
  protected readonly localStatus = signal<Map<string, 'present' | 'absent'>>(new Map());
  protected readonly notice = signal<{ severity: InlineNoticeSeverity; detail: string } | null>(
    null,
  );

  ngOnInit(): void {
    this.loadRoster();
  }

  private loadRoster(): void {
    this.loading.set(true);
    this.attendanceService.roster(this.session.eventId).subscribe({
      next: (data) => {
        this.roster.set(data);
        // 只帶出**已經有紀錄**的狀態；沒紀錄的留白，不要幫他決定
        const map = new Map<string, 'present' | 'absent'>();
        for (const s of data.students) {
          if (s.status && s.status !== 'on_leave') {
            map.set(s.studentId, s.status);
          }
        }
        this.localStatus.set(map);
        this.loading.set(false);
      },
      error: () => {
        this.notice.set({ severity: 'error', detail: '無法載入點名名單' });
        this.loading.set(false);
      },
    });
  }

  /**
   * 紀錄上就是請假 —— **鎖住的條件只有這一個**。
   *
   * 刻意**不含** `hasLeaveRequest`，雖然工單原本寫的是兩者取 `||` 全鎖：
   *
   * 1. 矛盾態（標了缺席 + 有請假單）本身就滿足 `||`，全鎖會讓老師看到一個他**動不了**
   *    的問題。把注意力引到無法處理的事情上，比不引還糟。
   * 2. `hasLeaveRequest` 是 join 出來的推導值，時間重疊判斷有邊界；誤判一次就鎖死一格，
   *    而銷假出口（老師把請假的人改成出席）目前還不存在。
   * 3. 後端刻意把「紀錄寫了什麼」與「有沒有請假這件事」分成兩欄，
   *    前端用一個 `||` 合回去等於把那個區別又抹掉。
   */
  protected isLocked(student: RosterStudent): boolean {
    return student.status === 'on_leave';
  }

  /** 這個學生今天請假了 —— 不管紀錄套用了沒。用來顯示 chip，不用來鎖 */
  protected hasLeave(student: RosterStudent): boolean {
    return student.status === 'on_leave' || student.hasLeaveRequest;
  }

  /**
   * 請假的人被標成缺席 —— 說的是**誤操作**（點了不該點的人），不是資料矛盾。
   *
   * 標成出席不算：請假的孩子還是來了，那是正常的事，不該報警。
   *
   * ⚠️ **這是 A1 未完成期間的權宜。** 老師目前沒有「標成請假」可以點
   * （`batch` 的 enum 只收 present/absent），所以請假沒來的學生，
   * 老師的正解是「不要標」，而這個旗標就是在抓他標了的情況。
   * A1 落地之後老師有正確的動作可做，這個旗標的必要性要回來重新評估。
   */
  protected isMismarked(student: RosterStudent): boolean {
    return student.hasLeaveRequest && this.getStatus(student.studentId) === 'absent';
  }

  /** `null` = 還沒標。呼叫端要能分辨「沒標」與「標了缺席」 */
  protected getStatus(studentId: string): 'present' | 'absent' | null {
    return this.localStatus().get(studentId) ?? null;
  }

  /**
   * 一鍵全到。最常見的情況是全班都來了，而逐一點過去是 N 次點擊 ——
   * 沒有這顆的話，最常見的情況剛好是最貴的操作。
   *
   * **請假的人不動** —— 那是行政登記的狀態，一鍵到課不該把它蓋掉。
   */
  protected markAllPresent(): void {
    const roster = this.roster();
    if (!roster) return;
    const map = new Map(this.localStatus());
    for (const s of roster.students) {
      // 有請假的一律跳過（含紀錄還沒套用的）—— 一鍵到課不該覆蓋掉請假
      if (!this.hasLeave(s)) map.set(s.studentId, 'present');
    }
    this.localStatus.set(map);
  }

  /** 標過的人數 —— 儲存鈕靠它決定能不能按 */
  protected markedCount(): number {
    return this.localStatus().size;
  }

  /**
   * 還沒標記的人數。**請假的兩種都不算** —— 見下。
   *
   * 這道守衛從 `session-attendance-dialog` 帶過來（#135），理由是後端的行為：
   * `PATCH /api/attendance/batch` 只要收到任何一次批次就會蓋上 `attendance_taken_at`
   * （`apps/api/src/routes/attendance.ts:696`，`if (!ev.attendance_taken_at)`，**不看筆數**）。
   * 半途存下去的話那堂課從此算「已點名」，沒點到的人不會有紀錄、
   * **也不會再出現在漏點名清單裡** —— 比預選缺席更難發現的沉默。
   *
   * **豁免用寬的 `hasLeave()`（兩種請假），鎖定用窄的 `isLocked()`（只有 `on_leave`）。**
   * 這個寬窄之分不是這裡發明的，`markAllPresent` 早就這樣做了：
   * 「這個人別碰」用寬的，「這一格要不要 disable」用窄的。守衛屬於前者。
   *
   * 只豁免 `on_leave` 的話，「只有請假單、紀錄還沒套用」的學生會被鎖進死循環：
   * 沒有「標成請假」可點 → 算 pending → 存不了 → 被迫標缺席 → 觸發誤標旗標 →
   * 只好標出席（說謊）才存得了檔。
   *
   * 代價是 `hasLeaveRequest` 誤判時會漏掉一個人。**接受這個代價的理由是可見性**：
   * 誤判長成「一個明明來上課的學生掛著請假 chip」，就在老師眼前那一列；
   * 而被迫填的那筆假出席寫進 DB 之後跟真的一模一樣，沒有任何地方看得出來。
   */
  protected readonly pendingCount = computed(() => {
    const roster = this.roster();
    if (!roster) return 0;
    const marked = this.localStatus();
    return roster.students.filter((s) => !this.hasLeave(s) && !marked.has(s.studentId)).length;
  });

  /**
   * 名單是空的（班上一個學生都沒有）。
   *
   * **「零人」跟「零個待標記」是兩件事** —— 不分開的話，空名單會落進「全部標記完成」
   * 跟「都在請假中」這兩句，而兩句都是空話：他沒有標完任何東西，也沒有人請假。
   */
  protected readonly rosterEmpty = computed(() => (this.roster()?.students.length ?? 0) === 0);

  /** 因為請假而不需要標記的人數 —— 講出來，讓豁免的結果在按鈕旁邊而不是只躺在列表裡 */
  protected readonly exemptCount = computed(
    () => this.roster()?.students.filter((s) => this.hasLeave(s)).length ?? 0,
  );

  protected setStatus(studentId: string, status: 'present' | 'absent'): void {
    const map = new Map(this.localStatus());
    map.set(studentId, status);
    this.localStatus.set(map);
  }

  protected gradeLabel(grade: string | null): string {
    if (!grade) return '';
    return GRADE_LEVEL_LABELS[grade as keyof typeof GRADE_LEVEL_LABELS] ?? grade;
  }

  /**
   * 這一列現在銷得了假嗎。
   *
   * API 對老師有「**只能銷當天的假**」的限制（403）—— 銷假的依據是「他人就在我面前」，
   * 那只有當天成立；管理員不受限，因為他在處理事後的更正
   * （`routes/attendance.ts` 的 `只能銷當天的假`）。
   *
   * **前端隱藏不構成授權**（c1）—— API 仍然強制。這裡藏掉的是一個
   * 按下去必然失敗的入口：過去的課堂上，老師點「他來了」只會拿到 403。
   * 這是端到端實測才發現的：service 被 mock 的單元測試看不到這條規則。
   */
  protected canCancelLeave(): boolean {
    return this.auth.activeRole() === 'admin' || this.session.eventDate === todayLocal();
  }

  /**
   * 銷假：這個請假的學生今天到了。
   *
   * 成功後**重抓 roster 而不是自己改本地狀態** —— 後端銷假會連帶刪掉 `on_leave`
   * 的出勤紀錄，那位學生會回到 `status: null + hasLeaveRequest: false`
   * 的可標記狀態。自己猜的話，猜錯了要到存檔才發現。
   */
  protected cancelLeave(studentId: string): void {
    this.cancelling.set(studentId);
    this.attendanceService.cancelLeave(this.session.eventId, studentId).subscribe({
      next: (res) => {
        this.cancelling.set(null);
        // 連坐取消不能默默吃掉 —— 老師以為自己只銷了今天
        this.notice.set(
          res.droppedAfter
            ? {
                severity: 'warning',
                detail: `已銷假。${res.droppedAfter} 前的後續日期的請假也一併取消，如需請假請重新申請。`,
              }
            : { severity: 'success', detail: '已銷假，可以標記出席了' },
        );
        this.loadRoster();
      },
      error: (err: { error?: { error?: string } }) => {
        this.cancelling.set(null);
        // 後端的話比「請稍後再試」有用 —— 403 不是暫時性的，重試一百次也一樣
        const detail = err?.error?.error;
        this.notice.set({
          severity: 'error',
          detail: detail ? `銷假失敗：${detail}` : '銷假失敗，請稍後再試',
        });
      },
    });
  }

  protected save(): void {
    const roster = this.roster();
    if (!roster) return;

    if (this.rosterEmpty()) {
      this.notice.set({
        severity: 'info',
        detail: '這堂課沒有學生，沒有出缺席可以記錄。',
      });
      return;
    }

    const pending = this.pendingCount();
    if (pending > 0) {
      this.notice.set({
        severity: 'warning',
        detail: `還有 ${pending} 人沒有標記。存檔會讓這堂課算成已點名，沒標到的人不會有紀錄，也不會再出現在漏點名清單裡。`,
      });
      return;
    }

    this.saving.set(true);

    // 只送標過的人。未標記的不寫入 —— 「還沒點到他」不該變成一筆缺席紀錄
    const updates = roster.students
      .filter((s) => !this.isLocked(s))
      .map((s) => ({ studentId: s.studentId, status: this.getStatus(s.studentId) }))
      .filter((u): u is { studentId: string; status: 'present' | 'absent' } => u.status !== null);

    // 走到這裡 pendingCount 已經是 0，所以「沒東西可送」只剩一種可能：全班都在請假。
    // 說「還沒標記任何學生」會變成指責老師漏做 —— 他沒有東西可標。
    if (updates.length === 0) {
      this.saving.set(false);
      this.notice.set({
        severity: 'info',
        detail: '這堂課的學生都在請假中，沒有出缺席需要記錄。',
      });
      return;
    }

    this.attendanceService.batchUpdate({ eventId: this.session.eventId, updates }).subscribe({
      next: (res) => {
        this.saving.set(false);
        const onLeaveCount = roster.students.filter((s) => s.status === 'on_leave').length;
        const presentCount = updates.filter((u) => u.status === 'present').length;
        const absentCount = updates.filter((u) => u.status === 'absent').length;
        this.ref.close({
          eventId: this.session.eventId,
          takenAt: res.takenAt,
          presentCount,
          absentCount,
          onLeaveCount,
        });
      },
      error: () => {
        this.saving.set(false);
        this.notice.set({ severity: 'error', detail: '儲存失敗，請稍後再試' });
      },
    });
  }

  protected close(): void {
    this.ref.close();
  }
}
