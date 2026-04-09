import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import type { RouteObj } from '@core/smart-enums/routes-catalog';

interface StatCard {
  label: string;
  value: string;
  sub?: string;
  icon: string;
  routerLink?: string;
  accent?: boolean;
}

interface TodaySession {
  time: string;
  className: string;
  teacher: string;
  room: string;
  status: 'completed' | 'ongoing' | 'upcoming' | 'has_leave';
  statusLabel: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DatePipe, RouterLink, ButtonModule, TagModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  readonly page = input.required<RouteObj>();

  protected readonly today = new Date();

  protected readonly statCards: StatCard[] = [
    { label: '今日課堂', value: '—', icon: 'pi-calendar', routerLink: '/admin/sessions' },
    { label: '待處理', value: '—', sub: '請假 · 報名', icon: 'pi-bell', accent: true },
    { label: '在籍學生', value: '—', icon: 'pi-users', routerLink: '/admin/students' },
    { label: '本月新報名', value: '—', icon: 'pi-user-plus' },
  ];

  protected readonly todaySessions: TodaySession[] = [];
  protected readonly pendingLeaves: { studentName: string; className: string }[] = [];
  protected readonly pendingEnrollments: { studentName: string; className: string }[] = [];

  protected getSessionSeverity(
    status: TodaySession['status'],
  ): 'success' | 'secondary' | 'info' | 'warn' {
    const map: Record<TodaySession['status'], 'success' | 'secondary' | 'info' | 'warn'> = {
      completed: 'success',
      ongoing: 'info',
      upcoming: 'secondary',
      has_leave: 'warn',
    };

    return map[status];
  }
}
