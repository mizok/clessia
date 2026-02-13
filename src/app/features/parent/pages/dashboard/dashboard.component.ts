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
    { label: '本月出勤率', value: '100%', icon: 'pi-calendar-plus', color: 'blue' },
    { label: '待繳學費', value: '$0', icon: 'pi-wallet', color: 'green' },
    { label: '最新評量', value: '優', icon: 'pi-star', color: 'purple' },
    { label: '聯絡簿動態', value: '2', icon: 'pi-book', color: 'orange' },
  ]);

  readonly welcomeMessage = computed(() => {
    const hour = this.today().getHours();
    if (hour < 12) return '早安';
    if (hour < 18) return '午安';
    return '晚安';
  });
}
