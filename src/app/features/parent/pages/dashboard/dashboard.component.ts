import { Component, computed, signal, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouteObj } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  readonly page = input.required<RouteObj>();
}
