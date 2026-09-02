import { Component, input } from '@angular/core';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [EmptyStateComponent],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  readonly page = input.required<RouteObj>();
}
