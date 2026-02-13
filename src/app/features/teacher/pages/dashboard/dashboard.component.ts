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
    { label: '今日課程', value: '4', icon: 'pi-calendar', color: 'blue' },
    { label: '平均點名率', value: '96%', icon: 'pi-user-check', color: 'green' },
    { label: '待回覆訊息', value: '3', icon: 'pi-comments', color: 'purple' },
    { label: '欠交作業數', value: '15', icon: 'pi-exclamation-triangle', color: 'orange' },
  ]);

  readonly welcomeMessage = computed(() => {
    const hour = this.today().getHours();
    if (hour < 12) return '早安';
    if (hour < 18) return '午安';
    return '晚安';
  });
}
