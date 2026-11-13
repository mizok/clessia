import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import type { MenuItem } from 'primeng/api';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import {
  SCHOOL_CALENDAR_KIND_LABELS,
  SchoolsService,
  type School,
  type SchoolCalendarEvent,
  type SchoolCalendarPeriod,
} from '@core/schools.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '@shared/components/confirm-dialog/confirm-dialog.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { LoadFailedComponent } from '@shared/components/load-failed/load-failed.component';
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';
import {
  SelectFieldComponent,
  type SelectFieldOption,
} from '@shared/components/select-field/select-field.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import {
  CalendarEventFormDialogComponent,
  type CalendarEventFormResult,
} from './calendar-event-form-dialog.component';

const WD = ['日', '一', '二', '三', '四', '五', '六'];
const LEVEL_LABELS: Record<string, string> = { elementary: '國小', junior: '國中', senior: '高中' };
/** 「全部」：機構還沒有任何期時唯一的選項 */
const ALL = '';

/** `2026-02-11` → `2/11（三）`；字串直接拆，不經時區 */
export function mdw(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}（${WD[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]}）`;
}

function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

function todayIso(): string {
  // 台北日期（測試在 UTC 跑，不能靠機器時區）
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
}

/** 預設期：涵蓋今天的 → 最近的下一期 → 最近的上一期（periods 依開始日新到舊） */
export function defaultPeriodId(periods: readonly SchoolCalendarPeriod[], today: string): string {
  const covering = periods.find((p) => p.startDate <= today && p.endDate >= today);
  if (covering) return covering.id;
  const next = periods.filter((p) => p.startDate > today).at(-1);
  return next?.id ?? periods[0]?.id ?? ALL;
}

/**
 * 單校整學期視圖（#1160 PR3）。A6 沒畫，沿用 settings#schools 的章節列與 `A2.form`（R5）。
 *
 * 一次抓該校**全部**事件＋期的起訖，切換期在前端篩「重疊即列」。
 * ponytail: 一校一年十幾筆，全抓夠用；真的上百筆再改成帶 from/to 重抓。
 */
@Component({
  selector: 'app-school-calendar-page',
  standalone: true,
  imports: [
    RouterLink,
    SkeletonComponent,
    EmptyStateComponent,
    LoadFailedComponent,
    SelectFieldComponent,
    PopupMenuComponent,
    CalendarEventFormDialogComponent,
  ],
  providers: [DialogService],
  templateUrl: './school-calendar.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchoolCalendarPage {
  /** 路由參數 `:id` */
  readonly id = input.required<string>();

  private readonly schoolsService = inject(SchoolsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly form = viewChild.required(CalendarEventFormDialogComponent);
  private readonly rowMenu = viewChild.required<PopupMenuComponent>('rowMenu');

  protected readonly schoolsHref = RoutesCatalog.ADMIN_SCHOOLS.absolutePath;
  protected readonly kindLabels = SCHOOL_CALENDAR_KIND_LABELS;
  protected readonly mdw = mdw;

  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  private readonly schools = signal<School[]>([]);
  private readonly events = signal<SchoolCalendarEvent[]>([]);
  protected readonly periods = signal<SchoolCalendarPeriod[]>([]);
  protected readonly periodId = signal(ALL);
  protected readonly rowMenuItems = signal<MenuItem[]>([]);

  protected readonly school = computed(() => this.schools().find((s) => s.id === this.id()));
  protected readonly schoolLabel = computed(() => {
    const s = this.school();
    return s ? s.shortName || s.name : '';
  });
  protected readonly levelLabel = computed(() => LEVEL_LABELS[this.school()?.level ?? ''] ?? '');
  protected readonly periodOptions = computed<SelectFieldOption<string>[]>(() =>
    this.periods().length
      ? this.periods().map((p) => ({ value: p.id, label: p.name }))
      : [{ value: ALL, label: '全部' }],
  );
  private readonly period = computed(() => this.periods().find((p) => p.id === this.periodId()));

  /** 跟選定的期重疊即列；依開始日 */
  protected readonly rows = computed(() => {
    const p = this.period();
    return this.events()
      .filter((e) => !p || (e.startDate <= p.endDate && e.endDate >= p.startDate))
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map((e) => ({
        event: e,
        when:
          e.startDate === e.endDate
            ? mdw(e.startDate)
            : `${mdw(e.startDate)}–${mdw(e.endDate)} · ${dayCount(e.startDate, e.endDate)} 天`,
        strong: e.kind === 'semester_start' || e.kind === 'semester_end',
      }));
  });

  /** 摘要：開學 2/11（三）· 休業式 6/30（二）；沒有就 null（模板寫灰字） */
  protected readonly summary = computed(() => {
    const parts: string[] = [];
    for (const kind of ['semester_start', 'semester_end'] as const) {
      const e = this.rows().find((r) => r.event.kind === kind);
      if (e) parts.push(`${this.kindLabels[kind]} ${mdw(e.event.startDate)}`);
    }
    return parts.length ? parts.join(' · ') : null;
  });

  constructor() {
    // 換校（同一個元件、不同 :id）也重抓
    effect(() => {
      this.id();
      untracked(() => this.load());
    });
  }

  protected load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    forkJoin([this.schoolsService.list(), this.schoolsService.calendarEvents(this.id())])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ([schools, cal]) => {
          this.schools.set(schools.data);
          this.events.set(cal.data);
          this.periods.set(cal.meta.periods);
          if (!cal.meta.periods.some((p) => p.id === this.periodId())) {
            this.periodId.set(defaultPeriodId(cal.meta.periods, todayIso()));
          }
          this.loading.set(false);
        },
        error: () => {
          this.loadFailed.set(true);
          this.loading.set(false);
        },
      });
  }

  protected openCreate(): void {
    const me = this.school();
    if (!me) return;
    const others = this.schools().filter((s) => s.id !== me.id && s.isActive);
    this.form().open({ id: me.id, name: me.name }, null, others);
  }

  protected openEdit(event: SchoolCalendarEvent): void {
    const me = this.school();
    if (me) this.form().open({ id: me.id, name: me.name }, event);
  }

  protected openRowMenu(domEvent: Event, event: SchoolCalendarEvent): void {
    this.rowMenuItems.set([
      { label: '編輯', icon: 'pi pi-pencil', command: () => this.openEdit(event) },
      { label: '刪除', icon: 'pi pi-trash', command: () => this.onDelete(event) },
    ]);
    this.rowMenu().toggle(domEvent);
  }

  /** 列表就地更新：新增只插自己這所那一筆（POST 的 data[0]） */
  protected onFormClosed(result: CalendarEventFormResult | null): void {
    if (!result) return;
    const [mine] = result.events;
    if (!mine) return;
    this.events.update((list) =>
      result.mode === 'create' ? [...list, mine] : list.map((e) => (e.id === mine.id ? mine : e)),
    );
  }

  protected onDelete(event: SchoolCalendarEvent): void {
    const data: ConfirmDialogData = {
      message: `確定刪除「${this.kindLabels[event.kind]} ${mdw(event.startDate)}」？`,
      acceptLabel: '刪除',
      rejectLabel: '取消',
    };
    this.dialogService
      .open(ConfirmDialogComponent, {
        header: '確認刪除',
        width: 'var(--dlg-w-md)',
        modal: true,
        showHeader: false,
        data,
      })
      ?.onClose.subscribe((ok) => {
        if (!ok) return;
        this.schoolsService
          .deleteCalendarEvent(this.id(), event.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.events.update((list) => list.filter((e) => e.id !== event.id));
              this.messageService.add({ severity: 'success', summary: '已刪除' });
            },
            error: (err) =>
              this.messageService.add({
                severity: 'error',
                summary: '刪除失敗',
                detail: err?.error?.error ?? '',
              }),
          });
      });
  }
}
