import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';
import { format, parseISO } from 'date-fns';

import { type MakeupCandidate, type Session, SessionsService } from '@core/sessions.service';

/**
 * 「這堂課補的是哪一堂停課」——**指定，不是新增**。
 *
 * 這個系統做不出額外的單堂課（沒有 `POST /sessions`，唯一建立路徑是照班級
 * `schedules` 產生），所以整個對話框的用詞都必須是「指定既有課堂」。
 * 寫「安排」「新增」的代價不是用詞不精確，是**使用者會去找那個不存在的流程，
 * 然後以為是自己不會用**（issue #592 裁定）。
 */
@Component({
  selector: 'app-session-makeup-dialog',
  imports: [FormsModule, ButtonModule, SelectModule],
  // 沒有自己的 SCSS —— 版面全部用全域的 `session-op-form`（`styles.scss:1424`），
  // 跟其他課堂操作對話框一致。空的 SCSS 檔留著只會變成孤兒。
  templateUrl: './session-makeup-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionMakeupDialogComponent implements OnInit {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly sessionsService = inject(SessionsService);
  private readonly messageService = inject(MessageService);

  protected readonly session = signal<Session | null>(null);
  protected readonly candidates = signal<MakeupCandidate[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly submitting = signal(false);
  protected readonly selectedId = signal<string | null>(null);

  /** 已經指定過的話，對話框變成「改指定或解除」 */
  protected readonly existingLink = computed(() => this.session()?.makeupFor ?? null);

  protected readonly options = computed(() =>
    this.candidates().map((c) => ({ label: this.describe(c), value: c.id })),
  );

  ngOnInit(): void {
    const s = this.config.data?.session as Session | undefined;
    if (!s) return;
    this.session.set(s);
    this.selectedId.set(s.makeupFor?.id ?? null);
    this.loadCandidates(s.id);
  }

  /**
   * 清單**不再自己過濾一次**。
   *
   * 「還沒被補過」的排除條件在後端，而後端是重用 `mapSessionMakeup` 得到的——
   * 跟 DB 那道 partial unique index 是同一份判定。前端再寫一份就是第三個載體，
   * 而那支 migration 正上方寫著這三者漂移的後果：
   * **清單會列出一個索引會拒絕的選項，或藏起一個其實補得成的。**
   */
  private loadCandidates(sessionId: string): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.sessionsService.listMakeupCandidates(sessionId).subscribe({
      next: (res) => {
        this.candidates.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.candidates.set([]);
        this.loadFailed.set(true);
        this.loading.set(false);
      },
    });
  }

  protected describe(c: MakeupCandidate): string {
    const day = format(parseISO(c.sessionDate), 'MM/dd');
    return `${day} ${c.startTime}–${c.endTime}`;
  }

  protected closeDialog(): void {
    this.ref.close();
  }

  protected submit(): void {
    const s = this.session();
    const target = this.selectedId();
    if (!s || !target) return;
    this.save(s.id, target, '已指定補課');
  }

  /** 解除連結 —— 後端把 `null` 當成清除，且**不寫流水**（舊的那筆就是歷史） */
  protected clearLink(): void {
    const s = this.session();
    if (!s) return;
    this.save(s.id, null, '已解除補課連結');
  }

  private save(sessionId: string, target: string | null, successDetail: string): void {
    this.submitting.set(true);
    this.sessionsService.setMakeup(sessionId, target).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: '成功', detail: successDetail });
        this.ref.close('refresh');
      },
      error: (error: { status?: number; error?: { error?: string; code?: string } }) => {
        this.submitting.set(false);

        // **409 在正常流程裡看起來永遠不會發生，但它不是死碼。**
        //
        // 清單已經隱藏了「已經被補過的」，所以使用者選不到那種選項 ——
        // 那正是這個分支看起來進不去的原因。它防的是**時間差**：
        // 兩個人同時對同一堂停課指定補課，兩邊的清單都顯示它可補（取清單的那一刻
        // 都還沒被補），先送出的成功、**後送出的撞上 DB 的 partial unique index**。
        //
        // 1:1 是**資料層**強制的，清單只是「取的那一刻」的快照 ——
        // 所以這個訊息必須承接後端的 409，**不能由前端自己判斷**（前端判斷不出來）。
        // 重新載入清單，讓那個已經被別人補走的選項消失。
        if (error.status === 409) {
          this.messageService.add({
            severity: 'warn',
            summary: '這堂停課已經有補課了',
            detail: '可能是其他人剛剛指定的。清單已更新，請重新選擇。',
            life: 6000,
          });
          this.selectedId.set(null);
          this.loadCandidates(sessionId);
          return;
        }

        this.messageService.add({
          severity: 'error',
          summary: '錯誤',
          detail: error.error?.error ?? '設定補課失敗，請稍後再試',
        });
      },
    });
  }
}
