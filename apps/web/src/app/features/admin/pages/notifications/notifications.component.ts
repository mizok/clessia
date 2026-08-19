import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';

import {
  AUDIENCE_LABELS,
  AnnouncementsService,
  type Announcement,
  type AnnouncementAudience,
} from '@core/announcements.service';
import { CampusesService, type Campus } from '@core/campuses.service';
import { RouteObj } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-notifications',
  imports: [DatePipe, FormsModule, ButtonModule, SelectModule],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsComponent {
  readonly page = input.required<RouteObj>();

  private readonly announcementsService = inject(AnnouncementsService);
  private readonly campusesService = inject(CampusesService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly AUDIENCE_LABELS = AUDIENCE_LABELS;

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly announcements = signal<Announcement[]>([]);
  protected readonly campuses = signal<Campus[]>([]);

  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly campusId = signal<string | null>(null);

  /**
   * 只放「全體老師」。家長端 11 個頁面全是空殼，發給家長的公告不會有人看得到 ——
   * 選得到但沒人收，比選不到更糟。schema 已經支援，等家長端接上再開。
   */
  protected readonly audience: AnnouncementAudience = 'all_teachers';

  protected readonly campusOptions = computed(() => [
    { label: '全部分校', value: null as string | null },
    ...this.campuses().map((c) => ({ label: c.name, value: c.id as string | null })),
  ]);

  protected readonly canSubmit = computed(
    () => this.title().trim().length > 0 && this.body().trim().length > 0 && !this.submitting(),
  );

  constructor() {
    this.campusesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.campuses.set(res.data),
        error: () => this.campuses.set([]),
      });

    this.load();
  }

  protected submit(): void {
    if (!this.canSubmit()) return;

    this.submitting.set(true);
    this.submitError.set(null);

    this.announcementsService
      .create({
        title: this.title().trim(),
        body: this.body().trim(),
        audience: this.audience,
        campusId: this.campusId(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.title.set('');
          this.body.set('');
          this.submitting.set(false);
          this.load();
        },
        error: () => {
          this.submitting.set(false);
          this.submitError.set('發布失敗，請稍後再試');
        },
      });
  }

  private load(): void {
    this.loading.set(true);
    this.loadError.set(false);

    this.announcementsService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.announcements.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.announcements.set([]);
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }
}
