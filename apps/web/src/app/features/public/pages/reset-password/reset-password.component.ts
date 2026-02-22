import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '@core/auth.service';

@Component({
  selector: 'app-reset-password',
  imports: [FormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss',
  host: { class: 'u-centered-flex' },
})
export class ResetPasswordComponent implements OnInit {
  newPassword = '';
  confirmPassword = '';
  submitting = signal(false);
  done = signal(false);
  error = signal<string | null>(null);
  invalidLink = signal(false);
  sessionReady = signal(false);

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly token = signal<string | null>(null);

  ngOnInit() {
    const token = new URLSearchParams(window.location.search).get('token');
    this.token.set(token);

    if (token) {
      this.sessionReady.set(true);
      return;
    }

    this.invalidLink.set(true);
  }

  async onSubmit() {
    if (this.newPassword !== this.confirmPassword) {
      this.error.set('兩次輸入的密碼不一致');
      return;
    }

    const token = this.token();
    if (!token) {
      this.invalidLink.set(true);
      this.error.set('重設連結無效，請重新申請');
      return;
    }

    this.error.set(null);
    this.submitting.set(true);

    try {
      const updateError = await this.auth.updatePassword(this.newPassword, token);

      if (updateError) {
        this.error.set(updateError);
      } else {
        this.done.set(true);
        await this.router.navigate(['/login']);
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : '發生未知錯誤，請重試');
    } finally {
      this.submitting.set(false);
    }
  }
}
