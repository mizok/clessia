import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, ChildrenOutletContexts } from '@angular/router';
import { fadeAnimation } from '@shared/animations';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-public-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './public-shell.component.html',
  styleUrl: './public-shell.component.scss',
  animations: [fadeAnimation],
})
export class PublicShellComponent {
  private readonly contexts = inject(ChildrenOutletContexts);
  protected readonly menuOpen = signal(false);

  protected readonly publicRoutes = RoutesCatalog.values.filter(r => !r.role && r.showInMenu);

  protected getRouteAnimationData() {
    return this.contexts.getContext('primary')?.route?.snapshot?.data?.['animation'];
  }

  protected toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }
}
