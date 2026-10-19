import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentApplicationsService,
  type ParentCatalogClass,
  type ParentEnrollmentRequest,
} from '@core/parent-applications.service';
import { EnrollmentComponent } from './enrollment.component';

/** #1727 ③：家長端報名申請（A6 p-enrollment）—— 新增申請／申請紀錄兩分頁 */

const PAGE = {
  label: '報名申請',
  relativePath: '',
  absolutePath: '',
  role: undefined,
  icon: '',
  showInMenu: true,
};

const KID = { id: 'kid-1', name: '林子晴', grade: 'junior_3', school: null };

const cls = (over: Partial<ParentCatalogClass> = {}): ParentCatalogClass => ({
  classId: 'c-open',
  className: '國三數學 A 班',
  gradeLevels: [],
  courseId: 'co-1',
  courseName: '國三數學',
  subject: '數學',
  courseDescription: null,
  campusName: '本校',
  slots: [{ weekday: 2, startTime: '18:00', endTime: '20:00' }],
  maxStudents: 20,
  remainingSeats: 8,
  fee: { amount: 4800, billingMode: 'monthly' },
  isRecommended: false,
  teacherNames: ['王老師'],
  matchesGrade: true,
  enrolled: false,
  conflictsWith: null,
  ...over,
});

const req = (over: Partial<ParentEnrollmentRequest> = {}): ParentEnrollmentRequest => ({
  id: 'r-1',
  studentId: KID.id,
  studentName: KID.name,
  classId: 'c-x',
  className: '國三理化 A 班',
  status: 'pending',
  preferredStartDate: '2026-11-01',
  note: null,
  rejectReason: null,
  billingMode: null,
  createdAt: '2026-10-18T02:00:00Z',
  ...over,
});

describe('EnrollmentComponent（家長端報名申請）', () => {
  let fixture: ComponentFixture<EnrollmentComponent>;
  let api: {
    enrollmentRequests: ReturnType<typeof vi.fn>;
    createEnrollmentRequest: ReturnType<typeof vi.fn>;
    cancelEnrollmentRequest: ReturnType<typeof vi.fn>;
    catalog: ReturnType<typeof vi.fn>;
  };
  let toast: ReturnType<typeof vi.fn>;

  const dialogProto = HTMLDialogElement.prototype;
  const originalDialog = { showModal: dialogProto.showModal, close: dialogProto.close };
  beforeEach(() => {
    dialogProto.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    dialogProto.close = function (this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  });
  afterEach(() => Object.assign(dialogProto, originalDialog));

  async function setup(
    opts: {
      classes?: ParentCatalogClass[];
      requests?: ParentEnrollmentRequest[];
      fragment?: string;
    } = {},
  ) {
    api = {
      enrollmentRequests: vi.fn(() => of({ data: opts.requests ?? [] })),
      createEnrollmentRequest: vi.fn(() => of(req({ id: 'r-new' }))),
      cancelEnrollmentRequest: vi.fn(() => of({ success: true })),
      catalog: vi.fn(() => of({ data: opts.classes ?? [cls()] })),
    };
    toast = vi.fn();
    await TestBed.configureTestingModule({
      imports: [EnrollmentComponent],
      providers: [
        provideRouter([]),
        { provide: ParentApplicationsService, useValue: api },
        { provide: MessageService, useValue: { add: toast } },
        {
          provide: ChildScopeService,
          useValue: {
            children: signal([KID]).asReadonly(),
            activeChildId: signal(KID.id).asReadonly(),
            activeChild: signal(KID).asReadonly(),
            status: () => 'ready' as const,
            canSwitch: () => false,
            setActiveChild: vi.fn(),
            load: vi.fn(),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(EnrollmentComponent);
    fixture.componentRef.setInput('page', PAGE);
    if (opts.fragment === 'records') (fixture.componentInstance as any).tab.set('records');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent!.replace(/\s+/g, ' ');
  const btn = (label: RegExp) =>
    [...el().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      label.test(b.textContent ?? ''),
    );
  const pick = (classId: string) =>
    el().querySelector<HTMLInputElement>(`input[name="cid"][value="${classId}"]`)!;
  const setDate = (v: string) => {
    const input = el().querySelector<HTMLInputElement>('input[type="date"]')!;
    input.value = v;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  describe('新增申請', () => {
    it('依科目分組；已在班上、申請中、已登記候補的列出但不能選，寫原因；剩 3 位以下紅字', async () => {
      await setup({
        classes: [
          cls({ classId: 'c-open' }),
          cls({ classId: 'c-in', className: '國三英文 A 班', subject: '英文', enrolled: true }),
          cls({ classId: 'c-req', className: '國三理化 A 班', subject: '理化' }),
          cls({ classId: 'c-wl', className: '國三國文 A 班', subject: '國文' }),
          cls({ classId: 'c-low', className: '國三數學 B 班', remainingSeats: 2 }),
          cls({ classId: 'c-pay', className: '國三數學 C 班' }),
        ],
        requests: [
          req({ id: 'r-a', classId: 'c-req', status: 'pending' }),
          req({ id: 'r-b', classId: 'c-wl', status: 'waitlist' }),
          // 已核准待繳費也算「申請中」
          req({ id: 'r-c', classId: 'c-pay', status: 'awaiting_payment' }),
          // 別的孩子的申請不影響這個孩子能不能選
          req({ id: 'r-d', classId: 'c-open', status: 'pending', studentId: 'kid-2' }),
        ],
      });
      expect([...el().querySelectorAll('h3')].map((h) => h.textContent!.trim())).toEqual(
        expect.arrayContaining(['數學', '英文', '理化', '國文']),
      );
      expect(pick('c-open').disabled).toBe(false);
      expect(pick('c-in').disabled).toBe(true);
      expect(pick('c-req').disabled).toBe(true);
      expect(pick('c-wl').disabled).toBe(true);
      expect(pick('c-pay').disabled).toBe(true);
      expect(text()).toContain('已在班上');
      expect(text()).toContain('申請中');
      expect(text()).toContain('已登記候補');
      expect(
        pick('c-low').closest('label')!.querySelector('.text-error-700')!.textContent,
      ).toContain('剩 2 位');
    });

    it('搜尋課程或班名', async () => {
      await setup({
        classes: [cls(), cls({ classId: 'c-eng', className: '國三英文 A 班', subject: '英文' })],
      });
      const q = el().querySelector<HTMLInputElement>('input[type="search"]')!;
      q.value = '英文';
      q.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(el().querySelector('input[value="c-open"]')).toBeNull();
      expect(el().querySelector('input[value="c-eng"]')).not.toBeNull();
    });

    it('還沒填：開課班、開始日期（孩子只有一個時預設選好）', async () => {
      await setup();
      expect(text()).toContain('還沒填：開課班、開始日期');
      expect(btn(/送出申請/)!.getAttribute('aria-disabled')).toBe('true');
    });

    it('送出：帶孩子、班、日期、備註；成功 → toast、切到申請紀錄、重抓', async () => {
      await setup();
      pick('c-open').click();
      setDate('2026-11-01');
      const note = el().querySelector<HTMLTextAreaElement>('textarea')!;
      note.value = '週六上午可以';
      note.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      api.enrollmentRequests.mockClear();
      btn(/送出申請/)!.click();
      fixture.detectChanges();
      expect(api.createEnrollmentRequest).toHaveBeenCalledWith({
        studentId: KID.id,
        classId: 'c-open',
        preferredStartDate: '2026-11-01',
        note: '週六上午可以',
        waitlist: false,
      });
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: '已送出 林子晴「國三數學 A 班」的申請，補習班審核後會通知你',
        }),
      );
      expect(api.enrollmentRequests).toHaveBeenCalled();
      expect((fixture.componentInstance as any).tab()).toBe('records');
    });

    it('選了額滿的班：按鈕變「登記候補」，送 waitlist: true，toast 寫已登記候補', async () => {
      await setup({ classes: [cls({ classId: 'c-full', remainingSeats: 0 })] });
      expect(text()).toContain('已額滿 · 可登記候補');
      pick('c-full').click();
      setDate('2026-11-01');
      btn(/登記候補/)!.click();
      expect(api.createEnrollmentRequest).toHaveBeenCalledWith(
        expect.objectContaining({ classId: 'c-full', waitlist: true }),
      );
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ summary: '已額滿，已為您登記候補，補習班會主動聯絡' }),
      );
    });

    it('送出失敗：錯誤留在表單、填的不清', async () => {
      await setup();
      api.createEnrollmentRequest.mockReturnValue(
        throwError(() => ({
          status: 409,
          error: { error: '這個班已經有一筆申請在處理中', code: 'DUPLICATE_REQUEST' },
        })),
      );
      pick('c-open').click();
      setDate('2026-11-01');
      btn(/送出申請/)!.click();
      fixture.detectChanges();
      expect(text()).toContain('這個班已經有一筆申請在處理中');
      expect(pick('c-open').checked).toBe(true);
      expect((fixture.componentInstance as any).tab()).toBe('new');
    });
  });

  describe('申請紀錄', () => {
    const records = [
      req({
        id: 'r-pay',
        status: 'awaiting_payment',
        className: '國一國文 A 班',
        createdAt: '2026-10-15T02:00:00Z',
      }),
      req({
        id: 'r-pend',
        status: 'pending',
        className: '國三理化 A 班',
        createdAt: '2026-10-18T02:00:00Z',
      }),
      req({
        id: 'r-rej',
        status: 'rejected',
        rejectReason: '程度還沒到',
        createdAt: '2026-10-08T02:00:00Z',
      }),
    ];

    it('新到舊；狀態標籤；頁首寫等繳費與等審核的筆數', async () => {
      await setup({ requests: records, fragment: 'records' });
      const rows = [...el().querySelectorAll('[data-request]')].map((r) =>
        r.getAttribute('data-request'),
      );
      expect(rows).toEqual(['r-pend', 'r-pay', 'r-rej']);
      expect(text()).toContain('待付款');
      expect(text()).toContain('已拒絕');
      expect(text()).toContain('1 筆等你繳費');
      expect(text()).toContain('1 筆在等補習班審核');
    });

    it('詳情：已拒絕顯示補習班的說明；待付款寫「已核准，請到繳費頁付款」並連到繳費頁（Q3 (a) 過渡）', async () => {
      await setup({ requests: records, fragment: 'records' });
      el().querySelector<HTMLButtonElement>('[data-request="r-rej"]')!.click();
      fixture.detectChanges();
      expect(el().querySelector('dialog')!.textContent).toContain('程度還沒到');
      (fixture.componentInstance as any).closeDetail();
      el().querySelector<HTMLButtonElement>('[data-request="r-pay"]')!.click();
      fixture.detectChanges();
      const dialog = el().querySelector('dialog')!;
      expect(dialog.textContent).toContain('已核准，請到繳費頁付款');
      expect(dialog.querySelector('a[href="/parent/payments"]')).not.toBeNull();
    });

    it('待審核、候補可以取消（Q8）；其他狀態沒有取消鈕', async () => {
      await setup({
        requests: [...records, req({ id: 'r-wl', status: 'waitlist' })],
        fragment: 'records',
      });
      el().querySelector<HTMLButtonElement>('[data-request="r-rej"]')!.click();
      fixture.detectChanges();
      expect(btn(/取消這筆申請/)).toBeUndefined();
      (fixture.componentInstance as any).closeDetail();
      el().querySelector<HTMLButtonElement>('[data-request="r-wl"]')!.click();
      fixture.detectChanges();
      btn(/取消這筆申請/)!.click();
      fixture.detectChanges();
      expect(api.cancelEnrollmentRequest).toHaveBeenCalledWith('r-wl');
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ summary: '已取消 國三理化 A 班 的申請' }),
      );
    });
  });
});
