import { Component, input } from '@angular/core';
import type { RouteObj } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-term-exam-entry',
  standalone: true,
  imports: [],
  templateUrl: './term-exam-entry.component.html',
  styleUrl: './term-exam-entry.component.scss',
})
export class TermExamEntryComponent {
  readonly page = input.required<RouteObj>();
}
