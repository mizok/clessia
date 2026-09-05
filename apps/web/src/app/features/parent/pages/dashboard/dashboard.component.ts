import { Component, OnInit, inject, input } from '@angular/core';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import { ChildScopeService } from '@core/child-scope.service';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { PageBandComponent } from '@shared/components/page-band/page-band.component';
import { ChildSwitcherComponent } from '../../shared/child-switcher/child-switcher.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [EmptyStateComponent, PageBandComponent, ChildSwitcherComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly childScope = inject(ChildScopeService);

  ngOnInit(): void {
    // 這裡是家長端授權模型的第一個消費端試點——證明孩子切換器的機制跑得動，
    // 後面 03 片（出缺席/成績/繳費）直接複用同一支 ChildScopeService，不用重寫。
    this.childScope.load();
  }
}
