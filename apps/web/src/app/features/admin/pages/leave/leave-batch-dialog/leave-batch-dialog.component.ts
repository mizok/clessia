import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';

import { EnrollmentsService } from '@core/enrollments.service';
import { LeaveService } from '@core/leave.service';
import { SessionsService, type Session } from '@core/sessions.service';
import { addDaysToDateString, SystemClockService } from '@core/system-clock.service';

interface Pick {
  id: string;
  name: string;
}

/**
 * 批次請假（#1100 #32，A6 leave.html 的 batchLeave）：選一堂課 → 勾多位學生 → 送出。
 *
 * 後端逐筆處理（一位失敗不擋其他人）。有人沒成功就**不關窗**：列出沒成功的那幾位與原因，
 * 勾選只留他們，可以只對他們重送（計畫席 10-23）；成功的不再列。
 * 關窗時回傳這一窗總共建了幾張（重送的也算），讓列表決定要不要重抓。
 */
@Component({
  selector: 'app-leave-batch-dialog',
  standalone: true,
  imports: [FormsModule, InputTextModule, SelectModule],
  template: `
    <div class="flex flex-col gap-4 py-2">
      <p class="m-0 text-md text-zinc-600">
        同一堂課，一次幫好幾位學生請假。例如全班校外教學、颱風停課補假。
      </p>

      <label class="flex flex-col gap-1 text-md font-semibold text-zinc-700">
        <span>課堂 <span class="text-error-700" aria-hidden="true">*</span></span>
        <p-select
          styleClass="w-full"
          [options]="sessionOptions()"
          optionLabel="label"
          optionValue="value"
          [filter]="true"
          filterBy="label"
          placeholder="選一堂課"
          [ngModel]="sessionId()"
          (ngModelChange)="onSessionChange($event)"
          [appendTo]="'body'"
          ariaLabel="課堂"
        />
      </label>

      <fieldset class="m-0 flex flex-col gap-1 border-0 p-0" data-testid="batch-students">
        <legend class="flex w-full items-center gap-3 p-0 text-md font-semibold text-zinc-700">
          學生
          <button
            type="button"
            class="inline-flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-md font-semibold text-zinc-900 underline underline-offset-[3px]"
            (click)="toggleAll()"
          >
            全選
          </button>
        </legend>
        @if (!sessionId()) {
          <p
            class="m-0 text-md"
            [class.text-warning-800]="nudged()"
            [class.text-zinc-600]="!nudged()"
          >
            {{
              nudged() ? '先選一堂課，才能全選這班的學生。' : '先選一堂課，這裡會列出這班的學生。'
            }}
          </p>
        } @else if (loadingStudents()) {
          <p class="m-0 text-md text-zinc-600">讀取名單中…</p>
        } @else if (students().length === 0) {
          <p class="m-0 text-md text-zinc-600">這班目前沒有在學的學生。</p>
        } @else {
          <div class="grid grid-cols-2 gap-x-3">
            @for (s of students(); track s.id) {
              <label class="flex min-h-11 cursor-pointer items-center gap-2 text-md text-zinc-900">
                <input type="checkbox" [checked]="selected().has(s.id)" (change)="toggle(s.id)" />
                {{ s.name }}
              </label>
            }
          </div>
        }
      </fieldset>

      <label class="flex flex-col gap-1 text-md font-semibold text-zinc-700">
        原因（選填）
        <input
          pInputText
          class="w-full"
          placeholder="例如：校外教學"
          [ngModel]="reason()"
          (ngModelChange)="reason.set($event)"
        />
      </label>

      @if (failures().length > 0) {
        <div class="rounded-md bg-error-50 p-3" role="alert" data-testid="batch-failures">
          <p class="m-0 mb-1 text-md font-semibold text-error-700">
            {{ lastCreated() > 0 ? '已幫 ' + lastCreated() + ' 位請假；' : '' }}以下
            {{ failures().length }} 位沒有成功：
          </p>
          <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
            @for (f of failures(); track f.studentId) {
              <li class="text-md text-zinc-900">{{ nameOf(f.studentId) }}：{{ f.error }}</li>
            }
          </ul>
        </div>
      }

      <div class="flex flex-wrap items-center justify-end gap-2 pt-2">
        <p class="m-0 mr-auto text-md text-zinc-600 max-wide:basis-full" aria-live="polite">
          {{ errorMessage() ?? missingHint() }}
        </p>
        <button
          type="button"
          class="inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-solid border-zinc-300 bg-white px-4 text-md font-semibold whitespace-nowrap text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 wide:h-9"
          [disabled]="saving()"
          (click)="close()"
        >
          {{ failures().length > 0 ? '關閉' : '取消' }}
        </button>
        <button
          type="button"
          class="inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-solid border-accent-vivid bg-accent-vivid px-4 text-md font-semibold whitespace-nowrap text-zinc-900 hover:border-accent-vivid-2 hover:bg-accent-vivid-2 aria-disabled:opacity-55 wide:h-9"
          data-testid="batch-submit"
          [attr.aria-disabled]="!!missingHint() || saving()"
          (click)="submit()"
        >
          {{
            saving()
              ? '送出中…'
              : failures().length > 0
                ? '只重送這 ' + selected().size + ' 位'
                : '送出請假'
          }}
        </button>
      </div>
    </div>
  `,
})
export class LeaveBatchDialogComponent implements OnInit {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly sessionsService = inject(SessionsService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly leaveService = inject(LeaveService);
  private readonly systemClock = inject(SystemClockService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly sessions = signal<Session[]>([]);
  protected readonly sessionId = signal<string | null>(null);
  protected readonly students = signal<Pick[]>([]);
  protected readonly loadingStudents = signal(false);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly reason = signal('');
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly failures = signal<Array<{ studentId: string; error: string }>>([]);
  protected readonly lastCreated = signal(0);
  /** 還沒選課就按全選：說為什麼沒反應（A6，#990 稽核） */
  protected readonly nudged = signal(false);
  /** 這一窗總共建了幾張（含重送） */
  private created = 0;

  /** 今天起 14 天、沒停課的課（A6）。 ponytail: 一頁 100 堂，分校課太多時改成先選日期 */
  protected readonly sessionOptions = computed(() =>
    this.sessions()
      .filter((s) => s.status !== 'cancelled')
      .map((s) => ({
        value: s.id,
        label: `${s.sessionDate.slice(5).replace('-', '/')} ${s.startTime.slice(0, 5)} ${s.className}`,
      })),
  );

  protected readonly missingHint = computed(() =>
    !this.sessionId() ? '還沒選課堂' : this.selected().size === 0 ? '至少勾一位學生' : null,
  );

  ngOnInit(): void {
    const today = this.systemClock.todayTaipei();
    const campusId = (this.config.data as { campusId?: string | null } | undefined)?.campusId;
    this.sessionsService
      .list({
        from: today,
        to: addDaysToDateString(today, 14),
        ...(campusId ? { campusIds: [campusId] } : {}),
        statuses: ['scheduled'],
        pageSize: 100,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.sessions.set(res.data),
        error: () => this.errorMessage.set('沒有讀到課表，請稍後再試'),
      });
  }

  protected onSessionChange(id: string | null): void {
    this.sessionId.set(id);
    this.selected.set(new Set());
    this.failures.set([]);
    this.students.set([]);
    const session = this.sessions().find((s) => s.id === id);
    if (!session) return;
    this.loadingStudents.set(true);
    this.enrollmentsService
      // 報名列表一頁上限 100（API）；一班超過 100 位在學的情況目前沒有
      .list({ classId: session.classId, status: 'active', pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          // 同一位可能有兩筆在學報名（換方案）—— 名單只列一次
          const seen = new Map<string, Pick>();
          for (const e of res.data) seen.set(e.studentId, { id: e.studentId, name: e.studentName });
          this.students.set([...seen.values()]);
          this.loadingStudents.set(false);
        },
        error: () => {
          this.loadingStudents.set(false);
          this.errorMessage.set('沒有讀到這班的名單，請稍後再試');
        },
      });
  }

  protected toggle(id: string): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set(next);
  }

  protected toggleAll(): void {
    const all = this.students();
    if (all.length === 0) {
      this.nudged.set(true);
      return;
    }
    const allOn = all.every((s) => this.selected().has(s.id));
    this.selected.set(allOn ? new Set() : new Set(all.map((s) => s.id)));
  }

  protected nameOf(id: string): string {
    return this.students().find((s) => s.id === id)?.name ?? id;
  }

  protected submit(): void {
    const sessionId = this.sessionId();
    if (this.saving() || !sessionId || this.selected().size === 0) return;
    this.saving.set(true);
    this.errorMessage.set(null);
    this.leaveService
      .batch({
        sessionId,
        studentIds: [...this.selected()],
        reason: this.reason().trim() || null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          this.created += res.created;
          this.lastCreated.set(res.created);
          const failed = res.results
            .filter((r) => r.status === 'failed')
            .map((r) => ({ studentId: r.studentId, error: r.error ?? '新增請假失敗' }));
          if (failed.length === 0) {
            this.ref.close({ created: this.created });
            return;
          }
          // 成功的不再列；勾選只留沒成功的，按一下就只對他們重送
          this.failures.set(failed);
          this.selected.set(new Set(failed.map((f) => f.studentId)));
        },
        error: () => {
          this.saving.set(false);
          this.errorMessage.set('送出失敗，請稍後再試');
        },
      });
  }

  protected close(): void {
    this.ref.close(this.created > 0 ? { created: this.created } : null);
  }
}
