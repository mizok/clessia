import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { FlowFieldComponent } from '@shared/components/flow-field/flow-field.component';

const pathOf = (url: string) => url.split(/[?#]/)[0];

@Component({
  selector: 'app-public-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FlowFieldComponent],
  templateUrl: './public-shell.component.html',
})
export class PublicShellComponent {
  private readonly router = inject(Router);
  protected readonly publicRoutes = RoutesCatalog.values.filter((r) => !r.role && r.showInMenu);

  /** 登入頁手機首屏：橘面板撐滿視窗高（A6），表單在下方捲動；其他公開頁維持短橘頭 */
  protected readonly isLogin = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => pathOf(this.router.url) === '/login'),
      startWith(pathOf(this.router.url) === '/login'),
    ),
    { requireSync: true },
  );

  protected scrollToForm(): void {
    document.getElementById('public-form')?.scrollIntoView({ behavior: 'smooth' });
  }
}
