import { Component, input } from '@angular/core';
import { RouteObj } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-courses',
  standalone: true,
  imports: [],
  template: `
    <div class="p-4">
      <h2 class="text-2xl font-bold mb-4">{{ page().label }}</h2>
      <p class="text-zinc-500">Courses management coming soon...</p>
    </div>
  `,
  styles: ``
})
export class CoursesPage {
  readonly page = input.required<RouteObj>();
}
