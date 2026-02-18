import { Component, signal, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '@core/auth.service';
import { SupabaseService } from '@core/supabase.service';

@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './change-password.component.html',
  styleUrl: './change-password.component.scss',
  host: { class: 'u-centered-flex' },
})
export class ChangePasswordComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly supabaseService = inject(SupabaseService);

  newPassword = '';
  confirmPassword = '';
  submitting = signal(false);
  error = signal<string | null>(null);
  success = signal(false);
  processing = signal(true); // 處理邀請 token 中
  tokenError = signal<string | null>(null);

  async ngOnInit() {
    // 檢查 URL 是否有 hash fragment（邀請連結會帶 access_token）
    const hash = window.location.hash;

    if (hash && hash.includes('access_token')) {
      // 邀請連結：讓 Supabase 處理 hash 中的 token
      try {
        const { data, error } = await this.supabaseService.client.auth.getSession();

        if (error) {
          this.tokenError.set('連結已失效或格式錯誤，請重新申請邀請');
          this.processing.set(false);
          return;
        }

        if (!data.session) {
          // 可能需要等待 onAuthStateChange 處理
          // 給一點時間讓 Supabase 處理 token
          await new Promise((resolve) => setTimeout(resolve, 1000));

          const { data: retryData } = await this.supabaseService.client.auth.getSession();
          if (!retryData.session) {
            this.tokenError.set('連結已失效，請聯繫管理員重新發送邀請');
            this.processing.set(false);
            return;
          }
        }

        // 清除 URL hash
        window.history.replaceState(null, '', window.location.pathname);
        this.processing.set(false);
      } catch {
        this.tokenError.set('處理邀請連結時發生錯誤');
        this.processing.set(false);
      }
    } else {
      // 不是邀請連結，檢查是否已登入
      const { data } = await this.supabaseService.client.auth.getSession();
      if (!data.session) {
        this.tokenError.set('請先登入後再修改密碼');
      }
      this.processing.set(false);
    }
  }

  async onSubmit() {
    if (!this.newPassword) {
      this.error.set('請輸入新密碼');
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.error.set('兩次輸入的密碼不一致');
      return;
    }

    if (this.newPassword.length < 6) {
      this.error.set('密碼長度至少需要 6 位元組');
      return;
    }

    this.error.set(null);
    this.submitting.set(true);

    try {
      const errorMsg = await this.auth.updatePassword(this.newPassword);
      if (errorMsg) {
        this.error.set(errorMsg);
      } else {
        this.success.set(true);
        // Navigate back after 2 seconds
        setTimeout(() => {
          this.goBack();
        }, 2000);
      }
    } catch (e) {
      this.error.set('發生未知錯誤，請重試');
    } finally {
      this.submitting.set(false);
    }
  }

  goBack() {
    // Navigate back to the active role's shell
    const role = this.auth.activeRole();
    if (role) {
      this.router.navigate([`/${role}`]);
    } else {
      this.router.navigate(['/select-role']);
    }
  }
}
