import { Component, ElementRef, signal, AfterViewInit, inject, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '@core/auth.service';
import { CaptchaService } from '@core/captcha.service';
import { environment } from '@env/environment';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  host: { class: 'u-centered-flex' },
})
export class LoginComponent implements AfterViewInit {
  private readonly turnstileContainer = viewChild.required<ElementRef>('turnstileContainer');
  private readonly captchaToken = signal<string | null>(null);
  private readonly auth = inject(AuthService);
  private readonly captcha = inject(CaptchaService);

  protected account = '';
  protected password = '';
  protected rememberMe = false;
  protected readonly loginMode = signal<'email' | 'phone'>('email');
  protected readonly error = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly showPassword = signal(false);

  ngAfterViewInit() {
    this.captcha.render(
      this.turnstileContainer().nativeElement,
      environment.turnstileSiteKey,
      (token) => this.captchaToken.set(token),
      { appearance: 'always', size: 'invisible' },
    );
  }

  protected setLoginMode(mode: 'email' | 'phone') {
    this.loginMode.set(mode);
    this.account = '';
    this.error.set(null);
  }

  protected async onSubmit() {
    this.error.set(null);
    this.submitting.set(true);

    this.auth.setRememberMe(this.rememberMe);
    const errorMsg = await this.auth.signIn(
      this.account,
      this.password,
      this.captchaToken() ?? undefined,
      this.loginMode(),
    );
    this.submitting.set(false);

    if (errorMsg) {
      this.error.set(errorMsg);
      return;
    }

    const roles = this.auth.roles();
    if (roles.length === 0) {
      this.error.set('此帳號尚未被指派角色，請聯繫管理員');
      return;
    }

    this.auth.navigateToRoleShell(roles[0]);
  }
}
