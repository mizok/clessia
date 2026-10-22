import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { Subject, of, throwError } from 'rxjs';
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

const KID = { id: 'kid-1', name: '林子晴', grade: 'J3', school: null };
const KID2 = { id: 'kid-2', name: '林子安', grade: 'J1', school: null };

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
  invoice: null,
  paymentInfo: null,
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
  let kidsSig: ReturnType<typeof signal<Array<typeof KID>>>;
  let activeSig: ReturnType<typeof signal<string | null>>;

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
      kids?: Array<typeof KID>;
      /** 孩子名單晚到（直接打開這頁）：一開始 activeChildId 是 null */
      lateKids?: boolean;
    } = {},
  ) {
    api = {
      enrollmentRequests: vi.fn(() => of({ data: opts.requests ?? [] })),
      createEnrollmentRequest: vi.fn(() => of(req({ id: 'r-new' }))),
      cancelEnrollmentRequest: vi.fn(() => of({ success: true })),
      catalog: vi.fn(() => of({ data: opts.classes ?? [cls()] })),
    };
    toast = vi.fn();
    kidsSig = signal(opts.lateKids ? [] : (opts.kids ?? [KID]));
    activeSig = signal<string | null>(opts.lateKids ? null : KID.id);
    await TestBed.configureTestingModule({
      imports: [EnrollmentComponent],
      providers: [
        provideRouter([]),
        { provide: ParentApplicationsService, useValue: api },
        { provide: MessageService, useValue: { add: toast } },
        {
          provide: ChildScopeService,
          useValue: {
            children: kidsSig.asReadonly(),
            activeChildId: activeSig.asReadonly(),
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

    // 班名裡沒有「英文」「會話」：只有比對科目／課程名才搜得到（審核席突變：只比班名）
    it('搜尋班名、科目、課程名', async () => {
      await setup({
        classes: [
          cls(),
          cls({ classId: 'c-eng', className: 'A 班', subject: '英文', courseName: '國三課程' }),
          cls({ classId: 'c-talk', className: 'B 班', subject: null, courseName: '英語會話' }),
        ],
      });
      const search = (v: string) => {
        const q = el().querySelector<HTMLInputElement>('input[type="search"]')!;
        q.value = v;
        q.dispatchEvent(new Event('input'));
        fixture.detectChanges();
      };
      search('英文');
      expect(el().querySelector('input[value="c-open"]')).toBeNull();
      expect(el().querySelector('input[value="c-eng"]')).not.toBeNull();
      search('會話');
      expect(el().querySelector('input[value="c-talk"]')).not.toBeNull();
      expect(el().querySelector('input[value="c-eng"]')).toBeNull();
    });

    it('換孩子：清掉已選的班、重抓那個孩子的目錄', async () => {
      await setup({ kids: [KID, KID2] });
      pick('c-open').click();
      setDate('2026-11-01');
      expect(text()).not.toContain('還沒填');
      el().querySelector<HTMLInputElement>('input[name="sid"][value="kid-2"]')!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(api.catalog).toHaveBeenLastCalledWith('kid-2');
      expect(pick('c-open').checked).toBe(false);
      expect(text()).toContain('還沒填：開課班');
    });

    // 審核席：effect 直接 subscribe 時，慢回來的舊孩子目錄會蓋掉新孩子的
    it('快速換孩子：先 A 再 B、A 晚回來 → 畫面是 B 的目錄', async () => {
      await setup({ kids: [KID, KID2] });
      const replies: Record<string, Subject<{ data: ParentCatalogClass[] }>> = {
        'kid-1': new Subject(),
        'kid-2': new Subject(),
      };
      api.catalog.mockImplementation((sid: string) => replies[sid]);
      const choose = async (id: string) => {
        el().querySelector<HTMLInputElement>(`input[name="sid"][value="${id}"]`)!.click();
        fixture.detectChanges();
        await fixture.whenStable();
      };
      await choose('kid-2');
      await choose('kid-1');
      await choose('kid-2');
      replies['kid-2'].next({ data: [cls({ classId: 'c-b', className: '國一數學 B 班' })] });
      replies['kid-1'].next({ data: [cls({ classId: 'c-a', className: '國三數學 A 班' })] });
      fixture.detectChanges();
      expect(el().querySelector('input[value="c-b"]')).not.toBeNull();
      expect(el().querySelector('input[value="c-a"]')).toBeNull();
    });

    // 瀏覽器實測抓到：直接打開這頁時孩子名單晚到，孩子欄一直是空的、目錄也不抓
    it('孩子名單晚到：載完之後預設選好、抓那個孩子的目錄', async () => {
      await setup({ lateKids: true });
      expect(api.catalog).not.toHaveBeenCalled();
      kidsSig.set([KID]);
      activeSig.set(KID.id);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(api.catalog).toHaveBeenCalledWith(KID.id);
      expect(text()).toContain('還沒填：開課班、開始日期');
      expect(text()).not.toContain('還沒填：孩子');
    });

    // 審核席 G1：孩子名旁的年級（API 回代碼 J3，畫面寫國三）
    it('孩子名旁寫年級：一個孩子「名字（國三）」；多個孩子每顆選項都有年級', async () => {
      await setup();
      expect(text()).toContain('林子晴（國三）');
      TestBed.resetTestingModule();
      await setup({ kids: [KID, KID2] });
      const opt = (id: string) =>
        el()
          .querySelector(`input[name="sid"][value="${id}"]`)!
          .closest('label')!
          .textContent!.replace(/\s+/g, '');
      expect(opt('kid-1')).toBe('林子晴國三');
      expect(opt('kid-2')).toBe('林子安國一');
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
      // 失敗後按鈕要能再按（kb/wiki/lessons/submit-busy-flag-finalize.md）
      const again = btn(/送出申請/)!;
      expect(again.getAttribute('aria-disabled')).toBe('false');
      again.click();
      expect(api.createEnrollmentRequest).toHaveBeenCalledTimes(2);
    });

    it('CLASS_FULL（剛好被搶走最後一位）：重抓目錄，按鈕變「登記候補」', async () => {
      await setup();
      api.createEnrollmentRequest.mockReturnValue(
        throwError(() => ({ status: 409, error: { error: '這個班已額滿', code: 'CLASS_FULL' } })),
      );
      pick('c-open').click();
      setDate('2026-11-01');
      api.catalog.mockClear();
      api.catalog.mockReturnValue(of({ data: [cls({ remainingSeats: 0 })] }));
      btn(/送出申請/)!.click();
      fixture.detectChanges();
      expect(api.catalog).toHaveBeenCalledTimes(1);
      expect(btn(/登記候補/)).toBeDefined();
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

    const INV = {
      id: 'inv-1',
      invoiceNo: 'INV-2610-001',
      total: 3100,
      netPaid: 0,
      dueDate: '2026-11-04',
      status: 'unpaid',
    };
    const openPay = async (over: Partial<ParentEnrollmentRequest>) => {
      await setup({
        requests: [req({ id: 'r-pay', status: 'awaiting_payment', ...over })],
        fragment: 'records',
      });
      el().querySelector<HTMLButtonElement>('[data-request="r-pay"]')!.click();
      fixture.detectChanges();
      return el().querySelector('dialog')!;
    };

    it('待付款詳情（A6，#1726）：這筆申請的帳單金額、期限，付款方式，申請班級分校的帳戶', async () => {
      const dialog = await openPay({
        invoice: INV,
        paymentInfo: '臺灣銀行 景美分行（004）\n帳號 0123',
      });
      const t = dialog.textContent!;
      expect(t).toContain('繳費單');
      expect(t).toContain('3,100 元');
      expect(t).toContain('繳費期限 11/4');
      expect(t).toContain('告訴櫃台帳號末五碼');
      expect(t).toContain('臺灣銀行 景美分行（004）');
      expect(t).not.toContain('已核准，請到繳費頁付款');
      // 還沒收過錢：不寫「已收 0 元」
      expect(t).not.toContain('已收');
    });

    it('待付款部分繳：寫已收與還差多少', async () => {
      const dialog = await openPay({ invoice: { ...INV, netPaid: 1000, status: 'partial' } });
      expect(dialog.textContent).toContain('已收 1,000 元，還差 2,100 元');
    });

    // #1778：繳清的同一個交易就完成申請，這種狀態只剩上線前的舊資料 —— 不再寫「等補習班確認」
    it('待付款已繳清（舊資料）：寫已繳清、不寫等確認，不再列帳戶', async () => {
      const dialog = await openPay({
        invoice: { ...INV, netPaid: 3100, status: 'paid' },
        paymentInfo: '某帳戶',
      });
      expect(dialog.textContent).toContain('已繳清 3,100 元。');
      expect(dialog.textContent).not.toContain('等補習班確認');
      expect(dialog.textContent).not.toContain('還差');
      expect(dialog.textContent).not.toContain('某帳戶');
    });

    it('待付款但沒設帳戶：寫請洽行政', async () => {
      const dialog = await openPay({ invoice: INV, paymentInfo: null });
      expect(dialog.textContent).toContain('帳戶資訊請洽補習班行政人員');
    });

    it('詳情：已拒絕顯示補習班的說明；待付款但帳單作廢沒重開 → 退回「請到繳費頁」並連到繳費頁', async () => {
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

    it('取消失敗：錯誤 toast、詳情不關、按鈕可以再按且真的再送', async () => {
      await setup({ requests: records, fragment: 'records' });
      api.cancelEnrollmentRequest.mockReturnValue(
        throwError(() => ({ status: 409, error: { error: '這筆申請已經在審核', code: 'X' } })),
      );
      el().querySelector<HTMLButtonElement>('[data-request="r-pend"]')!.click();
      await Promise.resolve(); // showModal 在 microtask
      fixture.detectChanges();
      expect(el().querySelector('dialog')!.open).toBe(true);
      btn(/取消這筆申請/)!.click();
      fixture.detectChanges();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', summary: '這筆申請已經在審核' }),
      );
      expect(el().querySelector('dialog')!.open).toBe(true);
      const again = btn(/取消這筆申請/)!;
      expect(again.getAttribute('aria-disabled')).toBe('false');
      again.click();
      expect(api.cancelEnrollmentRequest).toHaveBeenCalledTimes(2);
    });

    // R5 2026-10-21（#1758）：待付款不會自動過期 —— 詳情不寫「繳費期限已過」這種不存在的流程
    it('已過期（enum 有、實際不會出現）：時間軸只有送出申請', async () => {
      await setup({ requests: [req({ id: 'r-exp', status: 'expired' })], fragment: 'records' });
      el().querySelector<HTMLButtonElement>('[data-request="r-exp"]')!.click();
      fixture.detectChanges();
      const dialog = el().querySelector('dialog')!;
      expect(dialog.querySelectorAll('ol li')).toHaveLength(1);
      expect(dialog.textContent).not.toContain('繳費期限已過');
    });

    it('待審核、候補可以取消（Q8）；其他狀態沒有取消鈕', async () => {
      await setup({
        requests: [...records, req({ id: 'r-wl', status: 'waitlist' })],
        fragment: 'records',
      });
      for (const id of ['r-rej', 'r-pay']) {
        el().querySelector<HTMLButtonElement>(`[data-request="${id}"]`)!.click();
        fixture.detectChanges();
        expect(btn(/取消這筆申請/)).toBeUndefined();
        (fixture.componentInstance as any).closeDetail();
        fixture.detectChanges();
      }
      el().querySelector<HTMLButtonElement>('[data-request="r-pend"]')!.click();
      fixture.detectChanges();
      expect(btn(/取消這筆申請/)).toBeDefined();
      (fixture.componentInstance as any).closeDetail();
      fixture.detectChanges();
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
