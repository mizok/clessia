import { Component, OnInit, inject, signal, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { SkeletonModule } from 'primeng/skeleton';
import { MessageService } from 'primeng/api';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import {
  OrgSettingsService,
  type AttendanceMode,
  type OrgSettings,
} from '@core/org-settings.service';
import { LoadFailedComponent } from '@shared/components/load-failed/load-failed.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    FormsModule,
    SelectButtonModule,
    ButtonModule,
    ToastModule,
    SkeletonModule,
    LoadFailedComponent,
  ],
  providers: [MessageService],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly orgSettingsService = inject(OrgSettingsService);
  private readonly messageService = inject(MessageService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly settings = signal<OrgSettings | null>(null);
  protected readonly loadFailed = signal(false);
  /**
   * ngModel 需要一個初始值，而這個值**只在取數回來之前存在** ——
   * 模板的失敗態不渲染表單，所以它不再有機會被當成「讀到的值」存回去（#805）。
   */
  protected attendanceModeValue: AttendanceMode = 'per_session';

  protected readonly attendanceModeOptions = [
    { label: '隨堂點名', value: 'per_session' },
    { label: '日到班', value: 'daily_checkin' },
  ];

  ngOnInit(): void {
    this.loadSettings();
  }

  protected loadSettings(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.orgSettingsService.getSettings().subscribe({
      next: (s) => {
        this.settings.set(s);
        this.attendanceModeValue = s.attendanceMode;
        this.loading.set(false);
      },
      // **不發 toast** —— 主體現在有常駐的失敗狀態；會消失的 toast + 留著的錯誤畫面
      // 是兩個互相矛盾的訊號（#788 的裁定，照 /admin/parents 的形狀）。
      error: () => {
        this.loadFailed.set(true);
        this.loading.set(false);
      },
    });
  }

  protected saveAttendanceMode(): void {
    this.saving.set(true);
    this.orgSettingsService.updateSettings({ attendanceMode: this.attendanceModeValue }).subscribe({
      next: (s) => {
        this.settings.set(s);
        this.saving.set(false);
        this.messageService.add({
          severity: 'success',
          summary: '已儲存',
          detail: '出勤模式已更新',
        });
      },
      error: () => {
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '錯誤',
          detail: '儲存失敗，請稍後再試',
        });
      },
    });
  }
}
