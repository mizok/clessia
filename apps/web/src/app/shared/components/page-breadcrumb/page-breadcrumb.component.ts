import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface BreadcrumbItem {
  label: string;
  routerLink?: string;
}

@Component({
  selector: 'app-page-breadcrumb',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './page-breadcrumb.component.html',
  styleUrl: './page-breadcrumb.component.scss',
})
export class PageBreadcrumbComponent {
  readonly items = input.required<BreadcrumbItem[]>();
}
