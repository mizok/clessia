import { Component, input } from '@angular/core';
import { RouteObj } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [],
  template: `
    <div class="p-4">
      <h2 class="text-2xl font-bold mb-4">{{ page().label }}</h2>
      <p class="text-zinc-500">Sessions management content coming soon...</p>
    </div>
  `,
  styles: ``
})
export class SessionsComponent {
  readonly page = input.required<RouteObj>();
}
