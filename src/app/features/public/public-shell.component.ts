import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, ChildrenOutletContexts } from '@angular/router';
import { fadeAnimation } from '@shared/animations';

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

  protected getRouteAnimationData() {
    return this.contexts.getContext('primary')?.route?.snapshot?.data?.['animation'];
  }

  protected toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }
}
