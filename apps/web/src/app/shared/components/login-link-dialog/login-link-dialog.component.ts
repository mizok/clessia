import { Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { QRCodeComponent } from 'angularx-qrcode';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

/**
 * 建立帳號後顯示一次性登入連結的 QR。
 *
 * **櫃檯當場掃是綁定成功率最高的時刻** —— 家長本人在場、有真人可以帶著操作，
 * 長輩不需要看懂連結或自己完成任何步驟。錯過就得事後追。
 *
 * 連結太長（含 token 與 callbackURL），沒有人會用手打，所以：
 * - 主要路徑是 QR
 * - 掃不到就複製連結用 LINE 傳
 * - 「列印」印的是含 QR 的頁面，不是印那串網址
 */
@Component({
  selector: 'app-login-link-dialog',
  standalone: true,
  imports: [ButtonModule, TooltipModule, ToastModule, QRCodeComponent, InlineNoticeComponent],
  providers: [MessageService],
  templateUrl: './login-link-dialog.component.html',
  styleUrl: './login-link-dialog.component.scss',
})
export class LoginLinkDialogComponent {
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly loginUrl = () => (this.config.data?.loginUrl ?? '') as string;
  protected readonly personName = () => (this.config.data?.personName ?? '') as string;

  protected onHide(): void {
    this.ref.close();
  }

  /**
   * 用瀏覽器內建的列印。原本這裡是 pdfmake 產生帳號資訊卡 —— 那在有密碼的年代合理
   * （一張可以帶走的紙），但連結只有配 QR 才有意義，而 QR 已經在畫面上了。
   * 少一個 CommonJS 依賴（pdfmake 是建置時的警告來源之一）。
   */
  protected print(): void {
    window.print();
  }

  protected copyToClipboard(text: string, label: string): void {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        this.messageService.add({
          severity: 'success',
          summary: '已複製',
          detail: `${label} 已複製到剪貼簿`,
          life: 2000,
        });
      })
      .catch(() => {
        this.messageService.add({
          severity: 'error',
          summary: '複製失敗',
          detail: '請手動選取並複製文字',
          life: 3000,
        });
      });
  }
}
