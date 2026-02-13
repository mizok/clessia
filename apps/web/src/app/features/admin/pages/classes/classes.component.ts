import { Component, input } from '@angular/core';
import { RouteObj } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-admin-classes',
  standalone: true,
  template: `
    <div class="p-4">
      <h2 class="text-2xl font-bold mb-4">{{ page().label }}</h2>
      <p class="text-zinc-500">Classes management coming soon...</p>
    </div>
  `,
  styles: ``
})
export class ClassesComponent {
  readonly page = input.required<RouteObj>();
}
