import { MessageService } from 'primeng/api';
import { DialogFrameComponent } from '@shared/components/dialog-frame/dialog-frame.component';
import { DialogService } from 'primeng/dynamicdialog';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '@shared/components/confirm-dialog/confirm-dialog.component';
import { Component, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { AuthService } from '@core/auth.service';
import {
  AuthProvidersService,
  PROVIDER_NAMES,
  type ProviderId,
  isLineInAppBrowser,
} from '@core/auth-providers.service';
import { environment } from '@env/environment';
import { firstValueFrom } from 'rxjs';

/** 個人資料欄（#2396：編輯 → 一顆儲存；取消時回到上次讀到／存好的值，儲存只送改過的） */
interface Profile {
  displayName: string;
  nickname: string;
  birthday: string;
  email: string;
  phone: string;
}

@Component({
  selector: 'app-account-settings-dialog',
  standalone: true,
  imports: [FormsModule, DialogFrameComponent],
  // 確認對話框在這個對話框上面再開一層（同 class-form-dialog）
  providers: [DialogService],
  templateUrl: './account-settings-dialog.component.html',
})
export class AccountSettingsDialogComponent {
  private readonly http = inject(HttpClient);
  private readonly ref = inject(DynamicDialogRef);
  private readonly auth = inject(AuthService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);

  /** A6 `.acset__in`：桌機 36、手機 44（稿自己的 ≤860 規則）；焦點框 zinc-900 */
  protected readonly inputClass =
    'h-11 min-w-0 flex-1 rounded-md border border-solid border-zinc-300 bg-white px-3 text-lg text-zinc-900 focus:border-zinc-900 focus:outline-none disabled:opacity-60 wide:h-9 wide:text-base';

  /** 唯讀檢視 ↔ 編輯（底部列：關閉＋編輯 ↔ 取消＋儲存） */
  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  private readonly injector = inject(Injector);


  protected readonly hasParentRole = computed(() => this.auth.roles().includes('parent'));
  /** 暱稱存在 staff 列上（#1665 Q6′）：只有人員身分看得到這一欄；純家長沒有可寫的地方 */
  protected readonly hasStaffRole = computed(() =>
    this.auth.roles().some((role) => role === 'admin' || role === 'teacher'),
  );

  // ── 登入方式（#1842 G-3）──────────────────────────────────────────────
  /** 這個部署掛了哪些（沒設憑證的 provider 不列） */
  protected readonly providers = inject(AuthProvidersService).providers;
  protected readonly names = PROVIDER_NAMES;
  /** Google 一律擋 LINE 內建瀏覽器：那裡不給「綁定 Google」，改一行提示 */
  protected readonly inLineApp = isLineInAppBrowser();
  /** 綁了哪些（providerId）；null＝還在讀；讀不到另記 */
  protected readonly linked = signal<readonly string[] | null>(null);
  protected readonly linkedLoadFailed = signal(false);
  protected readonly methodBusy = signal<ProviderId | null>(null);
  protected readonly methodError = signal<string | null>(null);
  /**
   * 使用者 11-02：**綁了兩個以上才給「解除綁定」**，只剩一個寫「至少要留一個登入方式」。
   * 數的是伺服器回的全部帳號（伺服器擋最後一個也是這樣數），不是畫面上列的那幾個
   */
  protected readonly canUnlink = computed(() => (this.linked()?.length ?? 0) >= 2);
  protected readonly onlyOneLeft = computed(() => this.linked()?.length === 1);

  protected displayName = this.auth.profile()?.display_name ?? '';
  protected nickname = '';
  protected email = this.auth.user()?.email ?? '';
  protected phone = '';
  /** 原生 date 的值：yyyy-MM-dd；空字串＝沒填（#2390 gate） */
  protected birthday = '';

  constructor() {
    void this.loadMe();
    void this.loadLinked();
  }

  private async loadLinked() {
    try {
      const linked = await this.auth.linkedProviders();
      this.linked.set(linked ?? []);
      this.linkedLoadFailed.set(linked === null);
    } catch {
      this.linked.set([]);
      this.linkedLoadFailed.set(true);
    }
  }

  protected isLinked(provider: ProviderId): boolean {
    return this.linked()?.includes(provider) ?? false;
  }

  /** 綁定：跟綁定頁同一支，瀏覽器會被導去 LINE／Google，成功回 /select-role */
  protected async link(provider: ProviderId) {
    this.methodError.set(null);
    this.methodBusy.set(provider);
    try {
      const msg = await this.auth.linkProvider(provider);
      if (msg) this.methodError.set(msg);
    } catch {
      this.methodError.set(`無法連線到 ${PROVIDER_NAMES[provider]}，請稍後再試`);
    } finally {
      this.methodBusy.set(null);
    }
  }

  protected confirmUnlink(provider: ProviderId) {
    const others = (this.linked() ?? [])
      .filter((p) => p !== provider)
      .map((p) => PROVIDER_NAMES[p as ProviderId] ?? p)
      .join('、');
    this.confirm(
      `解除 ${PROVIDER_NAMES[provider]} 綁定`,
      {
        message: `解除之後就不能用 ${PROVIDER_NAMES[provider]} 登入，之後請用 ${others} 登入。`,
        acceptLabel: '解除綁定',
        rejectLabel: '取消',
      },
      () => void this.unlink(provider),
    );
  }

  private async unlink(provider: ProviderId) {
    this.methodError.set(null);
    this.methodBusy.set(provider);
    try {
      const msg = await this.auth.unlinkProvider(provider);
      if (msg) this.methodError.set(msg);
    } catch {
      this.methodError.set(`解除 ${PROVIDER_NAMES[provider]} 綁定失敗，請稍後再試`);
    } finally {
      this.methodBusy.set(null);
      await this.loadLinked();
    }
  }

  private async loadMe() {
    try {
      const me = await firstValueFrom(
        this.http.get<{
          displayName: string;
          email: string | null;
          phone: string | null;
          birthday: string | null;
          nickname: string | null;
        }>(`${environment.apiUrl}/api/me`, { withCredentials: true }),
      );
      this.displayName = me.displayName ?? '';
      this.email = me.email ?? '';
      this.phone = me.phone ?? '';
      this.birthday = me.birthday ? me.birthday.slice(0, 10) : '';
      this.nickname = me.nickname ?? '';
      this.saved = this.snapshot();
    } catch {
      // silently ignore — 初始值已從 auth.user() 設定
    }
  }

  /** 上次讀到／存好的值（loadMe 回來前是 auth 帶的初值） */
  private saved: Profile = this.snapshot();

  private snapshot(): Profile {
    return {
      displayName: this.displayName.trim(),
      nickname: this.nickname.trim(),
      birthday: this.birthday,
      email: this.email.trim(),
      phone: this.phone.trim(),
    };
  }

  protected startEdit() {
    this.saveError.set(null);
    this.editing.set(true);
    // 「編輯」鈕換成「取消／儲存」後焦點會掉：移到第一個欄位
    afterNextRender(() => document.getElementById('account-name')?.focus(), {
      injector: this.injector,
    });
  }

  protected cancelEdit() {
    Object.assign(this, this.saved);
    this.saveError.set(null);
    this.editing.set(false);
  }

  /** 只送改過的欄位；空字串＝清掉（API 存 null）。暱稱只有人員身分有（存在 staff 列上） */
  private changes(): Record<string, string | null> {
    const now = this.snapshot();
    const was = this.saved;
    const out: Record<string, string | null> = {};
    if (now.displayName !== was.displayName) out['displayName'] = now.displayName;
    if (this.hasStaffRole() && now.nickname !== was.nickname) out['nickname'] = now.nickname || null;
    if (now.birthday !== was.birthday) out['birthday'] = now.birthday || null;
    if (now.email !== was.email) out['email'] = now.email;
    if (now.phone !== was.phone) out['phone'] = now.phone || null;
    return out;
  }

  protected save() {
    if (this.saving()) return;
    if (!this.displayName.trim()) {
      this.saveError.set('顯示名稱不能空白');
      return;
    }
    const payload = this.changes();
    if (Object.keys(payload).length === 0) {
      this.editing.set(false);
      return;
    }
    if ('email' in payload) this.confirmEmail(payload);
    else this.patchMe(payload);
  }

  /**
   * Email 改動要二次確認，但**不是因為它是登入帳號** —— 這個系統沒有帳號密碼登入。
   * 它是產生一次性登入連結時的查人鍵（`scripts/login-link.ts` 與
   * `routes/login-links.ts` 都以 `ba_user.email` 找人），改錯了補習班就找不到你、
   * 也就發不出連結。見 kb/wiki/architecture/line-oauth-login.md
   * 電話**沒有二次確認** —— 它純粹是聯絡資訊，跟登入無關（密碼時代殘留的警告已拿掉）。
   */
  private confirmEmail(payload: Record<string, string | null>) {
    this.confirm(
      '確認修改 Email',
      {
        message: `確定要將 Email 改為「${payload['email']}」嗎？之後補習班要用新的 Email 才能幫你產生登入連結。`,
        acceptLabel: '確定修改',
        rejectLabel: '取消',
      },
      () => this.patchMe(payload),
    );
  }

  private patchMe(payload: Record<string, string | null>) {
    this.saving.set(true);
    this.saveError.set(null);
    this.http.patch(`${environment.apiUrl}/api/me`, payload, { withCredentials: true }).subscribe({
      next: () => {
        this.saving.set(false);
        Object.assign(this, this.snapshot());
        this.saved = this.snapshot();
        this.editing.set(false);
        // A6 data-ok：成功用 toast（#2390 gate）
        this.messageService.add({ severity: 'success', summary: '已儲存' });
        void this.auth.refreshRoles();
      },
      error: (err) => {
        this.saving.set(false);
        const code = (err.error as { code?: string } | null)?.code;
        this.saveError.set(
          code === 'EMAIL_ALREADY_IN_USE' ? '此 Email 已被使用' : '儲存失敗，請稍後再試',
        );
      },
    });
  }

  protected close() {
    this.ref.close();
  }

  /** 確認對話框（#2290：p-confirmdialog 改走共用殼的 ConfirmDialog，同 staff／parents 頁） */
  private confirm(header: string, data: ConfirmDialogData, onAccept: () => void): void {
    this.dialogService
      .open(ConfirmDialogComponent, {
        header,
        width: 'var(--dlg-w-md)',
        modal: true,
        showHeader: false,
        data,
      })
      ?.onClose.subscribe((ok) => {
        if (ok) onAccept();
      });
  }
}
