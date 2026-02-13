import { Component, ElementRef, ViewChild, signal, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
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
  @ViewChild('turnstileContainer') turnstileContainer!: ElementRef;

  email = '';
  password = '';
  rememberMe = false;
  error = signal<string | null>(null);
  submitting = signal(false);
  captchaToken = signal<string | null>(null);

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly captcha: CaptchaService,
  ) {}

  ngAfterViewInit() {
    this.captcha.render(
      this.turnstileContainer.nativeElement,
      environment.turnstileSiteKey,
      (token) => {
        this.captchaToken.set(token);
      },
      {
        appearance: 'always',
        size: 'invisible',
      },
    );
  }

  async onSubmit() {
    this.error.set(null);
    this.submitting.set(true);

    this.auth.setRememberMe(this.rememberMe);
    const errorMsg = await this.auth.signIn(this.email, this.password, this.captchaToken() ?? undefined);
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
