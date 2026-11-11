import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, from, map, mergeMap, of, tap, toArray } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SelectFieldComponent } from '@shared/components/select-field/select-field.component';
import { DialogFrameComponent } from '@shared/components/dialog-frame/dialog-frame.component';

import { EnrollmentsService } from '@core/enrollments.service';
import { GRADE_LEVEL_LABELS, type GradeLevel } from '@core/students.service';
import { LeaveService } from '@core/leave.service';
import { SessionsService, type Session } from '@core/sessions.service';
import { addDaysToDateString, SystemClockService } from '@core/system-clock.service';

interface Pick {
  id: string;
  name: string;
  /** A6 .pick__o 的 small：年級 */
  grade: string;
}

/**
 * 批次請假（#1100 #32，A6 leave.html 的 batchLeave）：選一堂課 → 勾多位學生 → 送出。
 *
 * **前端逐位呼叫單筆 `POST /leaves`**（計畫席 10-23 裁 c）：單筆已經用掉約 23 個 subrequest，
 * Workers 每請求上限 50，一個請求放不下兩位 —— 所以每位一個請求、各自的額度，並行 3 個
 * （不要更多，免得同時對 DB 打太多）。授權、重疊、出勤連動、通知都跟單筆完全一樣（10 位就 10 則通知）。
 * 一位失敗不擋其他人。有人沒成功就**不關窗**：列出沒成功的那幾位與原因，
 * 勾選只留他們，可以只對他們重送（計畫席 10-23）；成功的不再列。
 * 關窗時回傳這一窗總共建了幾張（重送的也算），讓列表決定要不要重抓。
 */
@Component({
  selector: 'app-leave-batch-dialog',
  standalone: true,
  imports: [DialogFrameComponent, FormsModule, SelectFieldComponent],
  template: `
    <!-- 共用殼（#2290）：標題、副標照 A6 leave.html batchLeave -->
    <app-dialog-frame title="批次請假" (closed)="close()">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <!-- A6 的下拉（#2325）：全站 app-select-field，超過 8 項自動出搜尋框 -->
          <app-select-field
            label="課堂"
            labelSize="md"
            placeholder="選一堂課"
            [required]="true"
            [options]="sessionOptions()"
            [value]="sessionId()"
            (valueChange)="onSessionChange($event)"
          />
          <!-- A6 .acset__hint -->
          <p class="m-0 text-sm text-zinc-600">例如全班校外教學、颱風停課補假</p>
        </div>

        <!--
          A6：p.acset__l「學生」＋「全選」(.tlink)，下面 .pick 容器。語意照行為：一組 checkbox 要有群組（R7），
          所以容器是 role=group、名稱指回標題，不用 fieldset／legend
        -->
        <div class="flex flex-col gap-1" data-testid="batch-students">
          <p class="m-0 text-md font-semibold text-zinc-700" id="batch-students-label">
            學生
            <button
              type="button"
              class="ml-1 inline-flex min-h-11 cursor-pointer items-center gap-1 border-0 border-b-[1.5px] border-solid border-transparent bg-transparent px-0 py-0.5 text-base leading-normal font-medium whitespace-nowrap text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 wide:min-h-0"
              (click)="toggleAll()"
            >
              全選
            </button>
          </p>
          <div class="grid gap-2" role="group" aria-labelledby="batch-students-label">
            @if (!sessionId()) {
              <!-- A6 .pick__none；催促時照 .pick__none.is-warn -->
              <p
                class="m-0 rounded-md bg-zinc-100 p-3 text-md"
                [class.font-semibold]="nudged()"
                [class.text-error-700]="nudged()"
                [class.text-zinc-700]="!nudged()"
              >
                {{
                  nudged()
                    ? '先選一堂課，才能全選這班的學生。'
                    : '先選一堂課，這裡會列出這班的學生。'
                }}
              </p>
            } @else if (loadingStudents()) {
              <p class="m-0 rounded-md bg-zinc-100 p-3 text-md text-zinc-700">讀取名單中…</p>
            } @else if (students().length === 0) {
              <p class="m-0 rounded-md bg-zinc-100 p-3 text-md text-zinc-700">
                這班目前沒有在學的學生。
              </p>
            } @else {
              @for (s of students(); track s.id) {
                <!-- A6 .pick__o：外框選項列，勾了加深；small 寫年級 -->
                <label
                  class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-solid border-zinc-300 bg-white px-3 text-md text-zinc-900 has-checked:border-zinc-900 has-checked:ring-1 has-checked:ring-zinc-900 has-checked:ring-inset"
                >
                  <input
                    type="checkbox"
                    class="m-0 size-[18px] accent-zinc-900"
                    [checked]="selected().has(s.id)"
                    (change)="toggle(s.id)"
                  />
                  {{ s.name }}
                  <small class="ml-auto text-sm text-zinc-600">{{ s.grade }}</small>
                </label>
              }
            }
          </div>
        </div>

        <!-- A6 .acset__l（block）＋.acset__in（手機 44、桌機 40） -->
        <div class="min-w-0">
          <label class="mb-1 block text-md font-semibold text-zinc-700" for="batch-reason"
            >原因（選填）</label
          >
          <input
            id="batch-reason"
            type="text"
            autocomplete="off"
            placeholder="例如：校外教學"
            class="h-10 w-full min-w-0 rounded-md border border-solid border-zinc-300 bg-white px-3 text-base text-zinc-900 [font-family:inherit] hover:border-zinc-500 focus:border-zinc-900 focus:shadow-[0_0_0_3px_rgb(26_22_20/14%)] focus:outline-none max-wide:h-11 max-wide:text-lg"
            [ngModel]="reason()"
            (ngModelChange)="reason.set($event)"
          />
        </div>

        @if (failures().length > 0) {
          <div class="rounded-md bg-error-100 p-3" role="alert" data-testid="batch-failures">
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
      </div>
      <ng-container dialogFoot>
        <p class="form-dialog__why" aria-live="polite">
          {{ errorMessage() ?? missingHint() }}
        </p>
        <button
          type="button"
          class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-zinc-300 bg-white px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 wide:h-9"
          [disabled]="saving()"
          (click)="close()"
        >
          {{ failures().length > 0 ? '關閉' : '取消' }}
        </button>
        <button
          type="button"
          class="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-accent-vivid bg-accent-vivid px-4 text-md leading-normal font-semibold whitespace-nowrap text-zinc-900 hover:border-accent-vivid-2 hover:bg-accent-vivid-2 aria-disabled:opacity-55 wide:h-9"
          data-testid="batch-submit"
          [attr.aria-disabled]="!!missingHint() || saving()"
          (click)="submit()"
        >
          {{
            saving()
              ? '送出中 ' + progress().done + '／' + progress().total
              : failures().length > 0
                ? '只重送這 ' + selected().size + ' 位'
                : '送出請假'
          }}
        </button>
      </ng-container>
    </app-dialog-frame>
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
  /** 送出中 x／n */
  protected readonly progress = signal({ done: 0, total: 0 });
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
          for (const e of res.data)
            seen.set(e.studentId, {
              id: e.studentId,
              name: e.studentName,
              grade: GRADE_LEVEL_LABELS[e.studentGrade as GradeLevel] ?? e.studentGrade ?? '',
            });
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
    const session = this.sessions().find((x) => x.id === sessionId);
    if (this.saving() || !session || this.selected().size === 0) return;
    const ids = [...this.selected()];
    const reason = this.reason().trim() || null;
    this.saving.set(true);
    this.errorMessage.set(null);
    this.progress.set({ done: 0, total: ids.length });
    from(ids)
      .pipe(
        mergeMap(
          (studentId) =>
            this.leaveService
              .create({
                studentId,
                startDate: session.sessionDate,
                endDate: session.sessionDate,
                sessionIds: [session.id],
                reason,
              })
              .pipe(
                map(() => ({ studentId, error: null as string | null })),
                // 後端的錯誤訊息（「該學生在 … 已有請假紀錄」「沒有這個分校的權限」）照轉
                catchError((err: { error?: { message?: string; error?: string } }) =>
                  of({
                    studentId,
                    error: err.error?.message ?? err.error?.error ?? '新增請假失敗',
                  }),
                ),
                tap(() => this.progress.update((p) => ({ ...p, done: p.done + 1 }))),
              ),
          3,
        ),
        toArray(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => {
        this.saving.set(false);
        const failed = results.filter(
          (r): r is { studentId: string; error: string } => r.error !== null,
        );
        const created = results.length - failed.length;
        this.created += created;
        this.lastCreated.set(created);
        if (failed.length === 0) {
          this.ref.close({ created: this.created });
          return;
        }
        // 成功的不再列；勾選只留沒成功的，按一下就只對他們重送
        this.failures.set(failed);
        this.selected.set(new Set(failed.map((f) => f.studentId)));
      });
  }

  protected close(): void {
    this.ref.close(this.created > 0 ? { created: this.created } : null);
  }
}
