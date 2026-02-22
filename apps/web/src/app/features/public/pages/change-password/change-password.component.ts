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
    // Supabase client 有 detectSessionInUrl: true 預設值
    // 會在初始化時自動從 URL hash 中提取並建立 session（邀請連結會帶 #access_token=...）
    const { data } = await this.supabaseService.client.auth.getSession();

    if (!data.session) {
      this.tokenError.set('連結已失效或已過期，請聯繫管理員重新發送邀請');
    }

    // 清除 URL hash，避免 token 留在網址列
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    this.processing.set(false);
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
