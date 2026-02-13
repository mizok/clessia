import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { Subscription } from '@supabase/supabase-js';
import { SupabaseService } from '@core/supabase.service';

@Component({
  selector: 'app-reset-password',
  imports: [FormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss',
  host: { class: 'u-centered-flex' },
})
export class ResetPasswordComponent implements OnInit, OnDestroy {
  newPassword = '';
  confirmPassword = '';
  submitting = signal(false);
  done = signal(false);
  error = signal<string | null>(null);
  invalidLink = signal(false);
  sessionReady = signal(false);

  private authSubscription?: Subscription;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly router: Router,
  ) {}

  ngOnInit() {
    const { data } = this.supabase.client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        // email 連結帶 hash 進來 → 合法，清除 hash 防止重整重用
        this.sessionReady.set(true);
        this.invalidLink.set(false);
        // Clean URL (remove hash and query params like 'code')
        history.replaceState(null, '', window.location.pathname);
      }
    });
    this.authSubscription = data.subscription;

    // 若 3 秒後 PASSWORD_RECOVERY 仍未觸發（lazy load 時序），再做一次判斷
    setTimeout(async () => {
      if (this.sessionReady()) return;

      // URL 仍有 hash = 連結剛進來但 listener 晚了；無 hash = 重整
      // PKCE flow uses query params (code) instead of hash
      const hasRecoveryHash =
        window.location.hash.includes('access_token') ||
        window.location.hash.includes('type=recovery');
      const hasRecoveryCode = new URLSearchParams(window.location.search).has('code');

      const { data: sessionData } = await this.supabase.client.auth.getSession();

      if (!sessionData.session) {
        this.invalidLink.set(true);
      } else if (hasRecoveryHash || hasRecoveryCode) {
        // 合法連結（lazy load 時序問題）
        this.sessionReady.set(true);
        // Clean URL
        history.replaceState(null, '', window.location.pathname);
      } else {
        // 有 session 但沒有 hash → 重整 → 強制清除，要求重新點連結
        await this.supabase.client.auth.signOut();
        this.invalidLink.set(true);
      }
    }, 3000);
  }

  ngOnDestroy() {
    this.authSubscription?.unsubscribe();
  }

  async onSubmit() {
    if (this.newPassword !== this.confirmPassword) {
      this.error.set('兩次輸入的密碼不一致');
      return;
    }

    this.error.set(null);
    this.submitting.set(true);

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('請求逾時，請重新整理後再試')), 15000),
      );

      const { error } = await Promise.race([
        this.supabase.client.auth.updateUser({ password: this.newPassword }),
        timeoutPromise,
      ]);

      if (error) {
        this.error.set(error.message);
      } else {
        this.done.set(true);
        await this.supabase.client.auth.signOut();
        setTimeout(() => this.router.navigate(['/login']), 2000);
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : '發生未知錯誤，請重試');
    } finally {
      this.submitting.set(false);
    }
  }
}
