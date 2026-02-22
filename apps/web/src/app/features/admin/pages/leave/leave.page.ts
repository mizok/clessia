import { Component, input } from '@angular/core';
import { RouteObj } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-leave',
  imports: [],
  templateUrl: './leave.page.html',
  styleUrl: './leave.page.scss',
})
export class LeavePage {
  readonly page = input.required<RouteObj>();
}
