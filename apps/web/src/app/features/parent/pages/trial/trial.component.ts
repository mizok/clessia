import {
  Component,
  computed,
  linkedSignal,
  inject,
  input,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { MessageService } from 'primeng/api';
import { filter, finalize, switchMap } from 'rxjs';
import { format, parseISO } from 'date-fns';

import { RouteObj } from '@core/smart-enums/routes-catalog';
import { ChildScopeService } from '@core/child-scope.service';
import { GRADE_LEVEL_LABELS, type GradeLevel } from '@core/students.service';
import {
  ParentApplicationsService,
  type ParentCatalogClass,
  type ParentTrialRequest,
  type TrialRequestStatus,
} from '@core/parent-applications.service';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { todayLocal } from '@shared/utils/session-time.util';
import { ChildScopeGateComponent } from '../../shared/child-scope-gate/child-scope-gate.component';
import {
  REQUEST_TAG_CLASS,
  RequestRowComponent,
  type RequestTagTone,
} from '../../shared/request-row/request-row.component';
import { effectiveFromSuffix } from '@shared/utils/schedule-effective.util';

/**
 * 家長端試聽申請（#1727 ④，A6 p-trial，設計稿 kb/wiki/specs/parent/applications.md）。
 *
 * - 兩分頁「新增申請／申請紀錄」（`#records`），表單裡選孩子、紀錄混列所有孩子（同報名頁）
 * - **一門課一列**（A6 偏離 R5：稿一列一班、送 cids；API 是 `courseIds`，一門一筆）。
 *   勾了課之後列出這門課各班的時段 chip，勾的寫進 `preferredTimes`，讓行政知道想上哪個時段（計畫席 Q-a）
 * - 孩子已在上的課不出現；同門課已有待處理／已安排的試聽列出但不能選
 * - 額滿也可以申請試聽（Q4 待使用者，未回覆前不擋）
 * - 沒有取消鈕（A6）：待處理、已安排的詳情放分校電話＋複製（#1750 的 `campusPhone`）
 */

type Tab = 'new' | 'records';

const STATUS: Record<TrialRequestStatus, [string, RequestTagTone]> = {
  pending: ['待處理', 'quiet'],
  scheduled: ['已安排', 'line'],
  completed: ['已完成', 'ok'],
  cancelled: ['已取消', 'off'],
};

const WEEKDAY = ['', '一', '二', '三', '四', '五', '六', '日'];
const DAY = ['日', '一', '二', '三', '四', '五', '六'];

interface CourseOption {
  courseId: string;
  name: string;
  subject: string;
  recommended: boolean;
  /** 這門課各班的時段，`國三數學 A 班 週二 18:00–20:00` */
  slots: string[];
  meta: string;
}

@Component({
  selector: 'app-trial',
  standalone: true,
  imports: [PageOpenComponent, ChildScopeGateComponent, RequestRowComponent],
  templateUrl: './trial.component.html',
})
export class TrialComponent {
  readonly page = input.required<RouteObj>();

  private readonly api = inject(ParentApplicationsService);
  private readonly childScope = inject(ChildScopeService);
  private readonly messages = inject(MessageService);

  protected readonly tab = signal<Tab>(
    inject(ActivatedRoute).snapshot.fragment === 'records' ? 'records' : 'new',
  );
  protected readonly kids = this.childScope.children;

  // ── 新增申請 ──
  // linkedSignal：直接打開這頁時孩子名單還沒載完，activeChildId 晚到 —— 跟著它走，家長自己選了才固定
  protected readonly sid = linkedSignal<string>(() => this.childScope.activeChildId() ?? '');
  protected readonly picked = signal<string[]>([]);
  protected readonly times = signal<string[]>([]);
  protected readonly slot = signal('');
  protected readonly note = signal('');
  protected readonly classes = signal<ParentCatalogClass[]>([]);
  protected readonly sending = signal(false);
  protected readonly sendError = signal<string | null>(null);

  // ── 申請紀錄 ──
  protected readonly requests = signal<ParentTrialRequest[]>([]);
  protected readonly detail = signal<ParentTrialRequest | null>(null);
  private readonly detailDialog = viewChild<ElementRef<HTMLDialogElement>>('detailDialog');

  protected readonly status = STATUS;
  protected readonly tagClass = REQUEST_TAG_CLASS;

  /** 排好日期、還沒過的試聽，最早的在前 */
  private readonly upcoming = computed(() => {
    const today = todayLocal();
    return this.requests()
      .filter((r) => r.status === 'scheduled' && r.scheduledDate && r.scheduledDate >= today)
      .sort((a, b) => a.scheduledDate!.localeCompare(b.scheduledDate!));
  });

  protected readonly headline = computed(() => {
    const [next, ...more] = this.upcoming();
    const wait = this.requests().filter((r) => r.status === 'pending').length;
    if (next) {
      const sub = more.length
        ? `另外還有 ${more.length} 筆試聽已排好${wait ? `、${wait} 筆在等安排` : ''}。`
        : wait
          ? `另外 ${wait} 筆在等補習班安排。`
          : '';
      return {
        first: `${next.studentName ?? ''} ${this.mdw(next.scheduledDate)}`,
        second: `去試聽${next.courseName ?? ''}。`,
        sub,
      };
    }
    // 排日期要等 #1747（管理端填日期）；那之前已安排但沒日期的不上頁首
    if (wait) return { first: `${wait} 筆試聽在等補習班安排。`, second: null, sub: '' };
    return { first: '想讓孩子先上一堂看看？', second: null, sub: '' };
  });

  protected readonly sorted = computed(() =>
    [...this.requests()].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
  );

  /** 目錄的班收成課程；孩子已在上的課整門不出現（A6） */
  private readonly courses = computed<CourseOption[]>(() => {
    const list = this.classes().filter((c) => c.courseId);
    const enrolled = new Set(list.filter((c) => c.enrolled).map((c) => c.courseId));
    const byCourse = new Map<string, ParentCatalogClass[]>();
    for (const c of list) {
      if (enrolled.has(c.courseId)) continue;
      byCourse.set(c.courseId!, [...(byCourse.get(c.courseId!) ?? []), c]);
    }
    return [...byCourse].map(([courseId, cs]) => ({
      courseId,
      name: cs[0].courseName ?? cs[0].className,
      subject: cs[0].subject ?? cs[0].courseName ?? '其他',
      recommended: cs.some((c) => c.isRecommended),
      slots: cs.flatMap((c) =>
        c.slots.map(
          (s) =>
            `${c.className} 週${WEEKDAY[s.weekday]} ${s.startTime}–${s.endTime}${effectiveFromSuffix(s.effectiveFrom)}`,
        ),
      ),
      meta: [
        `${cs.length} 個班`,
        ...new Set(cs.flatMap((c) => c.teacherNames).map((t) => `${t} 老師`)),
      ].join(' · '),
    }));
  });

  /** 推薦的一組放最前，其餘依科目（A6） */
  protected readonly groups = computed(() => {
    const all = this.courses();
    const rest = all.filter((c) => !c.recommended);
    const groups = [...new Set(rest.map((c) => c.subject))].map((subject) => ({
      title: subject,
      items: rest.filter((c) => c.subject === subject),
    }));
    const rec = all.filter((c) => c.recommended);
    return rec.length ? [{ title: '推薦加選', items: rec }, ...groups] : groups;
  });

  protected readonly missing = computed(() =>
    [!this.sid() && '孩子', !this.picked().length && '想試聽的課'].filter((m): m is string => !!m),
  );

  constructor() {
    this.childScope.load();
    this.loadRequests();
    // switchMap：快速換孩子時丟掉前一個孩子還沒回來的目錄
    toObservable(this.sid)
      .pipe(
        filter(Boolean),
        switchMap((sid) => this.api.catalog(sid)),
        takeUntilDestroyed(),
      )
      .subscribe({ next: (res) => this.classes.set(res.data) });
  }

  protected gradeLabel(grade: string | null): string {
    return GRADE_LEVEL_LABELS[grade as GradeLevel] ?? grade ?? '';
  }

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
    history.replaceState(null, '', tab === 'records' ? '#records' : location.pathname);
  }

  protected pickKid(id: string): void {
    this.sid.set(id);
    this.picked.set([]);
    this.times.set([]);
  }

  /** 同門課已有進行中的試聽 → 不能選（API 也會回 DUPLICATE_REQUEST） */
  protected busy(c: CourseOption): string | null {
    const open = this.requests().find(
      (r) =>
        r.studentId === this.sid() &&
        r.courseId === c.courseId &&
        (r.status === 'pending' || r.status === 'scheduled'),
    );
    if (!open) return null;
    return open.status === 'scheduled' ? '已安排試聽' : '試聽申請處理中';
  }

  protected toggleCourse(c: CourseOption, on: boolean): void {
    this.picked.update((ids) =>
      on ? [...ids, c.courseId] : ids.filter((id) => id !== c.courseId),
    );
    // 取消勾課，這門課勾過的時段也一起拿掉
    if (!on) this.times.update((ts) => ts.filter((t) => !c.slots.includes(t)));
  }

  protected toggleTime(t: string, on: boolean): void {
    this.times.update((ts) => (on ? [...ts, t] : ts.filter((x) => x !== t)));
  }

  protected submit(): void {
    if (this.sending() || this.missing().length) return;
    const kid = this.kids().find((k) => k.id === this.sid());
    const n = this.picked().length;
    const preferredTimes = [...this.times(), this.slot().trim()].filter(Boolean).join('、');
    this.sending.set(true);
    this.sendError.set(null);
    this.api
      .createTrialRequests({
        studentId: this.sid(),
        courseIds: this.picked(),
        preferredTimes: preferredTimes || undefined,
        note: this.note().trim() || undefined,
      })
      // finalize：成功、失敗都解除「送出中」（kb/wiki/lessons/submit-busy-flag-finalize.md）
      .pipe(finalize(() => this.sending.set(false)))
      .subscribe({
        next: () => {
          this.messages.add({
            severity: 'success',
            summary: `已送出 ${kid?.name ?? ''} 的試聽申請（${n} 門），補習班會打電話跟你約時間`,
          });
          this.picked.set([]);
          this.times.set([]);
          this.slot.set('');
          this.note.set('');
          this.loadRequests();
          this.setTab('records');
        },
        // 錯誤留在表單、填的不清
        error: (err) => this.sendError.set(err?.error?.error ?? '送出失敗，請檢查網路後再試'),
      });
  }

  // ── 紀錄與詳情 ──
  protected meta(r: ParentTrialRequest): string {
    const when =
      r.status === 'scheduled'
        ? r.scheduledDate
          ? [this.mdw(r.scheduledDate), r.scheduledStartTime, '試聽'].filter(Boolean).join(' ')
          : '補習班會跟你聯絡時間'
        : null;
    return [r.studentName ?? '', when, `${this.md(r.createdAt)} 送出`].filter(Boolean).join(' · ');
  }

  /** `10/21（三） 18:30–20:00`，時間沒填就只寫日期 */
  protected arrangement(r: ParentTrialRequest): string {
    const time = r.scheduledStartTime
      ? [r.scheduledStartTime, r.scheduledEndTime].filter(Boolean).join('–')
      : '';
    return [this.mdw(r.scheduledDate), time].filter(Boolean).join(' ');
  }

  protected openDetail(r: ParentTrialRequest): void {
    this.detail.set(r);
    queueMicrotask(() => this.detailDialog()?.nativeElement.showModal());
  }

  protected closeDetail(): void {
    this.detailDialog()?.nativeElement.close();
  }

  protected onDetailBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeDetail();
  }

  protected isOpen(r: ParentTrialRequest): boolean {
    return r.status === 'pending' || r.status === 'scheduled';
  }

  protected copyPhone(phone: string): void {
    navigator.clipboard?.writeText(phone).then(
      () => this.messages.add({ severity: 'success', summary: `已複製電話 ${phone}` }),
      () => this.messages.add({ severity: 'error', summary: '複製失敗，請手動抄下電話' }),
    );
  }

  protected steps(r: ParentTrialRequest): Array<{ text: string; done: boolean; at?: string }> {
    const sent = { text: '送出申請', done: true, at: this.md(r.createdAt) };
    const set = { text: '補習班安排好試聽時間', done: true };
    const todo = (text: string) => ({ text, done: false });
    switch (r.status) {
      case 'pending':
        return [sent, todo('補習班安排試聽時間（會打電話跟你確認）'), todo('試聽')];
      case 'scheduled':
        return [sent, set, todo(r.scheduledDate ? `${this.md(r.scheduledDate)} 試聽` : '試聽')];
      case 'completed':
        return [
          sent,
          set,
          { text: '試聽完成', done: true, at: this.md(r.scheduledDate) || undefined },
        ];
      case 'cancelled':
        return [sent, { text: '已取消', done: true }];
    }
  }

  protected md(iso: string | null): string {
    return iso ? format(parseISO(iso), 'M/d') : '';
  }

  /** `10/21（三）` */
  protected mdw(iso: string | null): string {
    return iso ? `${this.md(iso)}（${DAY[parseISO(iso).getDay()]}）` : '';
  }

  private loadRequests(): void {
    this.api.trialRequests().subscribe({ next: (res) => this.requests.set(res.data) });
  }
}
