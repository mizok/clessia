import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { Class } from '@core/classes.service';
import { Course } from '@core/courses.service';

@Component({
  selector: 'app-class-detail-dialog',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  templateUrl: './class-detail-dialog.component.html',
  styleUrl: './class-detail-dialog.component.scss',
})
export class ClassDetailDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly cls = signal<Class | null>(this.config.data?.cls ?? null);
  protected readonly course = signal<Course | null>(this.config.data?.course ?? null);
  protected readonly campuses = signal<any[]>(this.config.data?.campuses ?? []);

  protected readonly campusName = computed(() => {
    const c = this.cls();
    if (!c) return '未知分校';
    return this.campuses().find((cp) => cp.id === c.campusId)?.name ?? '未知分校';
  });

  protected getWeekdayLabel(weekday: number): string {
    return ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'][weekday] ?? '';
  }

  protected close(): void {
    this.ref.close();
  }
}
