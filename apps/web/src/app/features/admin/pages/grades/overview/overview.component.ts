import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import {
  PageBreadcrumbComponent,
  type BreadcrumbItem,
} from '@shared/components/page-breadcrumb/page-breadcrumb.component';
import type { RouteObj } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [PageBreadcrumbComponent],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewComponent {
  readonly page = input<RouteObj>();
  private readonly router = inject(Router);

  protected readonly breadcrumbs: BreadcrumbItem[] = [{ label: '成績總覽' }];

  protected goTo(view: 'student' | 'class'): void {
    this.router.navigate(['/admin/grades/overview', view]);
  }
}
