import { Component, input } from '@angular/core';
import type { RouteObj } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-academy-exams',
  standalone: true,
  imports: [],
  templateUrl: './academy-exams.component.html',
  styleUrl: './academy-exams.component.scss',
})
export class AcademyExamsComponent {
  readonly page = input.required<RouteObj>();
}
