import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-public-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './public-shell.component.html',
  styleUrl: './public-shell.component.scss',
})
export class PublicShellComponent {
  protected readonly menuOpen = signal(false);

  protected readonly publicRoutes = RoutesCatalog.values.filter(r => !r.role && r.showInMenu);

  protected toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }
}
