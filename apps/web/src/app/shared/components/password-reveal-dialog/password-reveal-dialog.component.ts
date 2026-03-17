import { Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';

@Component({
  selector: 'app-password-reveal-dialog',
  standalone: true,
  imports: [ButtonModule, TooltipModule, ToastModule],
  providers: [MessageService],
  templateUrl: './password-reveal-dialog.component.html',
  styleUrl: './password-reveal-dialog.component.scss',
})
export class PasswordRevealDialogComponent {
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly account = () => (this.config.data?.account ?? '') as string;
  protected readonly password = () => (this.config.data?.password ?? '') as string;
  protected readonly parentName = () => (this.config.data?.parentName ?? '') as string;
  protected readonly orgName = () => (this.config.data?.orgName ?? '') as string;

  protected onHide(): void {
    this.ref.close();
  }

  protected copyToClipboard(text: string, label: string): void {
    navigator.clipboard.writeText(text).then(() => {
      this.messageService.add({
        severity: 'success',
        summary: '已複製',
        detail: `${label} 已複製到剪貼簿`,
        life: 2000,
      });
    });
  }

  protected generateAccountCard(): void {
    import('pdfmake/build/pdfmake').then((pdfMakeModule) => {
      import('pdfmake/build/vfs_fonts').then((vfsFontsModule) => {
        const pdfMake = (pdfMakeModule.default ?? pdfMakeModule) as any;
        const vfsFonts = (vfsFontsModule.default ?? vfsFontsModule) as any;

        pdfMake.vfs = vfsFonts.pdfMake?.vfs ?? vfsFonts;

        const now = new Date().toLocaleDateString('zh-TW', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });

        const docDefinition = {
          pageSize: { width: 302, height: 200 },
          pageMargins: [20, 20, 20, 20],
          content: [
            {
              text: this.orgName() || '補習班',
              fontSize: 14,
              bold: true,
              color: '#18181b',
              margin: [0, 0, 0, 4],
            },
            {
              text: '家長帳號資訊卡',
              fontSize: 10,
              color: '#71717a',
              margin: [0, 0, 0, 12],
            },
            {
              columns: [
                { text: '家長姓名', fontSize: 9, color: '#71717a', width: 80 },
                { text: this.parentName(), fontSize: 9, bold: true, color: '#18181b' },
              ],
              margin: [0, 0, 0, 4],
            },
            {
              columns: [
                { text: '登入帳號', fontSize: 9, color: '#71717a', width: 80 },
                { text: this.account(), fontSize: 9, bold: true, color: '#18181b' },
              ],
              margin: [0, 0, 0, 4],
            },
            {
              columns: [
                { text: '登入密碼', fontSize: 9, color: '#71717a', width: 80 },
                { text: this.password(), fontSize: 9, bold: true, color: '#18181b' },
              ],
              margin: [0, 0, 0, 12],
            },
            {
              canvas: [
                {
                  type: 'line',
                  x1: 0,
                  y1: 0,
                  x2: 262,
                  y2: 0,
                  lineWidth: 0.5,
                  lineColor: '#e4e4e7',
                },
              ],
              margin: [0, 0, 0, 8],
            },
            {
              text: '請妥善保管，如需重設密碼請洽管理員',
              fontSize: 8,
              color: '#a1a1aa',
            },
            {
              text: `建立日期：${now}`,
              fontSize: 7,
              color: '#d4d4d8',
              margin: [0, 4, 0, 0],
            },
          ],
        };

        pdfMake.createPdf(docDefinition).download(`${this.parentName()}_帳號資訊卡.pdf`);
      });
    });
  }
}
