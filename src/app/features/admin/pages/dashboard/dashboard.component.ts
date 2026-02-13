import { Component, computed, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  readonly today = signal(new Date());
  
  readonly stats = signal([
    { label: '在校學生', value: '1,284', icon: 'pi-users', color: 'blue' },
    { label: '今日出勤', value: '98.2%', icon: 'pi-check-circle', color: 'green' },
    { label: '本月營收', value: '$452,100', icon: 'pi-chart-line', color: 'purple' },
    { label: '待處理事項', value: '12', icon: 'pi-bell', color: 'orange' },
  ]);

  readonly welcomeMessage = computed(() => {
    const hour = this.today().getHours();
    if (hour < 12) return '早安';
    if (hour < 18) return '午安';
    return '晚安';
  });
}
