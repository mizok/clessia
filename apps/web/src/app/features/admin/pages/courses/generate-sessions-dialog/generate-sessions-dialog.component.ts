import { DialogFrameComponent } from '@shared/components/dialog-frame/dialog-frame.component';
import { Component, inject, signal, computed } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import {
  ClassesService,
  Class,
  SessionPreview,
  type GenerateSessionsResult,
} from '@core/classes.service';
import { SystemClockService } from '@core/system-clock.service';

/** 預覽清單的一列：**一天一列**（API 的排除是按日，同一天兩個時段不能各自排除，R7） */
interface PreviewDay {
  date: string;
  /** 「11/12（三） 18:00–19:30、19:40–21:00 · 王老師」 */
  label: string;
  sessions: number;
}

const WD = ['', '一', '二', '三', '四', '五', '六', '日'];
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** 稿的預覽清單上限（class.html genDialog `out.length < 200`） */
const MAX_DAYS = 200;

/**
 * 產生課堂（#2361，內容照 A6 class.html:198-237 genDialog）：
 * 說明句 → 開始／結束日期（原生 date）→「預覽課堂」→ 一天一列的勾選清單（取消勾選＝排除那一天）→
 * 「確認產生 N 堂」。改了日期就回到第一段。完成照稿 toast＋關窗；有待指派老師的堂時保留結果頁與
 * 「前往指派老師」（舊有新無，R2）。API 照舊收 excludeDates。
 */
@Component({
  selector: 'app-generate-sessions-dialog',
  standalone: true,
  imports: [DialogFrameComponent, ButtonModule],
  templateUrl: './generate-sessions-dialog.component.html',
})
export class GenerateSessionsDialogComponent {
  private readonly classesService = inject(ClassesService);
  private readonly messageService = inject(MessageService);
  private readonly systemClock = inject(SystemClockService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly loading = signal(false);
  protected readonly cls = signal<Class | null>(this.config.data?.cls ?? null);
  protected readonly step = signal<'input' | 'preview' | 'result'>('input');
  protected readonly generationResult = signal<GenerateSessionsResult | null>(null);

  /** 預填班級期間；開始日已過就從今天起（不產生過去的課堂） */
  protected readonly generateFrom = signal<string>(this.initialFrom());
  protected readonly generateTo = signal<string>(this.cls()?.endDate ?? '');
  protected readonly previewSessions = signal<SessionPreview[]>([]);
  protected readonly excluded = signal<ReadonlySet<string>>(new Set());
  /** 底部「還差什麼」（A6 `.fdlg__why`）：按了才出現的原因 */
  private readonly reason = signal<string | null>(null);

  protected readonly minDate = computed(() => this.cls()?.startDate ?? '');
  protected readonly maxDate = computed(() => this.cls()?.endDate ?? '');

  protected readonly breadcrumb = computed(() => {
    const c = this.cls();
    if (!c) return '';
    // 麵包屑當副標（A6 class.html genDialog：`.fdlg__sub`「分校 › 課程 › 班名」）
    return `${c.campusName ?? ''} › ${c.courseName ?? ''} › ${c.name}`;
  });

  /** 要新建的堂（已存在的不進清單：稿「已經存在的課堂不會重複建立」） */
  private readonly newSessions = computed(() => this.previewSessions().filter((s) => !s.exists));
  protected readonly existingCount = computed(
    () => this.previewSessions().filter((s) => s.exists).length,
  );
  protected readonly days = computed<PreviewDay[]>(() => {
    const byDate = new Map<string, SessionPreview[]>();
    for (const s of this.newSessions()) {
      byDate.set(s.sessionDate, [...(byDate.get(s.sessionDate) ?? []), s]);
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, MAX_DAYS)
      .map(([date, list]) => {
        const times = list.map((s) => `${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`);
        const teachers = [...new Set(list.map((s) => s.teacherName).filter(Boolean))];
        return {
          date,
          label: `${md(date)}（${WD[list[0]!.weekday] ?? ''}） ${times.join('、')}${teachers.length ? ` · ${teachers.join('、')}` : ''}`,
          sessions: list.length,
        };
      });
  });
  protected readonly includedCount = computed(() =>
    this.days()
      .filter((d) => !this.excluded().has(d.date))
      .reduce((n, d) => n + d.sessions, 0),
  );
  protected readonly excludedCount = computed(() =>
    this.days()
      .filter((d) => this.excluded().has(d.date))
      .reduce((n, d) => n + d.sessions, 0),
  );

  protected readonly why = computed(() => {
    if (this.reason()) return this.reason();
    if (this.step() === 'preview' && this.includedCount() === 0) {
      return '全部都排除了，沒有要產生的課堂';
    }
    return null;
  });

  private initialFrom(): string {
    const start = this.cls()?.startDate;
    const today = this.systemClock.todayTaipei();
    if (!start) return today;
    return start < today ? today : start;
  }

  /** 改了日期就回到第一段（稿：預覽之後改日期要重新預覽） */
  protected setDate(which: 'from' | 'to', value: string): void {
    (which === 'from' ? this.generateFrom : this.generateTo).set(value);
    this.reason.set(null);
    if (this.step() === 'preview') {
      this.step.set('input');
      this.previewSessions.set([]);
      this.excluded.set(new Set());
    }
  }

  protected toggleDay(date: string, included: boolean): void {
    const next = new Set(this.excluded());
    if (included) next.delete(date);
    else next.add(date);
    this.excluded.set(next);
  }

  /** 底部主鈕：第一段預覽、第二段確認 */
  protected next(): void {
    if (this.loading()) return;
    if (this.step() === 'preview') this.confirm();
    else this.preview();
  }

  private preview(): void {
    const c = this.cls();
    const from = this.generateFrom();
    const to = this.generateTo();
    if (!c) return;
    if (!from || !to || from > to) {
      this.reason.set('結束日期要晚於開始日期');
      return;
    }
    this.loading.set(true);
    this.classesService.previewSessions(c.id, from, to, []).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.previewSessions.set(res.data);
        if (res.data.length === 0) {
          this.reason.set('這段期間沒有任何上課日');
          return;
        }
        if (this.newSessions().length === 0) {
          this.reason.set('這段期間的課堂都已經存在，不會重複建立');
          return;
        }
        this.excluded.set(new Set());
        this.step.set('preview');
      },
      error: (err) => {
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '預覽失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  private confirm(): void {
    const c = this.cls();
    if (!c || this.includedCount() === 0) return;
    this.loading.set(true);
    const firstDay = this.days().find((d) => !this.excluded().has(d.date))?.date;
    this.classesService
      .generateSessions(c.id, this.generateFrom(), this.generateTo(), [...this.excluded()])
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          this.generationResult.set(res);
          // 有待指派老師的堂：留結果頁與「前往指派老師」（舊有新無，R2）
          if (res.createdUnassigned > 0) {
            this.step.set('result');
            return;
          }
          const created = res.createdAssigned + res.createdUnassigned;
          this.messageService.add({
            severity: 'success',
            summary: `已產生 ${created} 堂課堂${firstDay ? `，下一堂 ${md(firstDay)}` : ''}`,
            detail: res.skippedExisting > 0 ? `${res.skippedExisting} 堂已存在，已略過` : undefined,
          });
          this.ref.close('refresh');
        },
        error: (err) => {
          this.loading.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '產生失敗',
            detail: err.error?.error || '請稍後再試',
          });
        },
      });
  }

  protected closeDone(): void {
    this.ref.close('refresh');
  }

  protected goToSessionsList(): void {
    const c = this.cls();
    this.ref.close({
      action: 'navigate-sessions',
      classId: c?.id,
      campusId: c?.campusId,
      courseId: c?.courseId,
      from: this.generateFrom() || undefined,
      to: this.generateTo() || undefined,
    });
  }

  protected cancel(): void {
    this.ref.close(this.generationResult() ? 'refresh' : undefined);
  }
}
