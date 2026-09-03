import { Component, input } from '@angular/core';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

@Component({
  selector: 'app-grades',
  standalone: true,
  imports: [EmptyStateComponent],
  template: `
    <app-empty-state
      icon="pi pi-chart-line"
      [title]="page().label"
      description="這個功能還在準備中，完成後就會出現在這裡。"
    />
  `,
})
export class GradesComponent {
  readonly page = input.required<RouteObj>();
}
