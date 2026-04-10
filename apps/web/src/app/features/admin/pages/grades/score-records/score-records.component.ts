import { Component, input } from '@angular/core';
import type { RouteObj } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-score-records',
  standalone: true,
  imports: [],
  templateUrl: './score-records.component.html',
  styleUrl: './score-records.component.scss',
})
export class ScoreRecordsComponent {
  readonly page = input.required<RouteObj>();
}
