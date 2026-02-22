import { Component, input } from '@angular/core';
import { RouteObj } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-schedule',
  imports: [],
  templateUrl: './schedule.page.html',
  styleUrl: './schedule.page.scss',
})
export class SchedulePage {
  readonly page = input.required<RouteObj>();
}
