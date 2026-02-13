import { Component, ElementRef, ViewChild, signal, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '@core/auth.service';
import { CaptchaService } from '@core/captcha.service';
import { environment } from '@env/environment';

@Component({
  selector: 'app-forgot-password',
  imports: [FormsModule, RouterLink],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.scss',
  host: { class: 'u-centered-flex' },
})
export class ForgotPasswordComponent implements AfterViewInit {
  @ViewChild('turnstileContainer') turnstileContainer!: ElementRef;

  email = '';
  submitting = signal(false);
  sent = signal(false);
  error = signal<string | null>(null);
  captchaToken = signal<string | null>(null);

  constructor(
    private readonly auth: AuthService,
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

    if (!this.captchaToken()) {
      this.error.set('請完成機器人驗證');
      this.submitting.set(false);
      return;
    }

    const errorMsg = await this.auth.sendPasswordReset(this.email, this.captchaToken()!);
    this.submitting.set(false);

    if (errorMsg) {
      this.error.set(errorMsg);
      return;
    }

    this.sent.set(true);
  }
}
