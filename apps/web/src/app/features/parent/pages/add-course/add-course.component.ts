import { Component, input } from '@angular/core';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

@Component({
  selector: 'app-add-course',
  standalone: true,
  imports: [EmptyStateComponent],
  template: `
    <app-empty-state
      icon="pi pi-plus-circle"
      [title]="page().label"
      description="這個功能還在準備中，完成後就會出現在這裡。"
    />
  `,
})
export class AddCourseComponent {
  readonly page = input.required<RouteObj>();
}
