import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, vi } from 'vitest';

import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentApplicationsService,
  type ParentCatalogClass,
  type ParentEnrollmentRequest,
} from '@core/parent-applications.service';
import { AddCourseComponent } from './add-course.component';

/** #1727 ⑤：家長端加選課程（A6 p-add-course）—— 卡片探索、詳情、加選表單走報名申請 */

const PAGE = {
  label: '加選課程',
  relativePath: '',
  absolutePath: '',
  role: undefined,
  icon: '',
  showInMenu: true,
};

const KID = { id: 'kid-1', name: '林子晴', grade: 'junior_3', school: null };
const KID2 = { id: 'kid-2', name: '林子安', grade: 'junior_1', school: null };

const cls = (over: Partial<ParentCatalogClass> = {}): ParentCatalogClass => ({
  classId: 'c-math',
  className: '國三數學 A 班',
  gradeLevels: [],
  courseId: 'co-math',
  courseName: '國三數學',
  subject: '數學',
  courseDescription: '照學校進度先講觀念',
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
  className: '某班',
  status: 'pending',
  preferredStartDate: null,
  note: null,
  rejectReason: null,
  billingMode: null,
  invoice: null,
  paymentInfo: null,
  createdAt: '2026-10-18T02:00:00Z',
  ...over,
});

describe('AddCourseComponent（家長端加選課程）', () => {
  let fixture: ComponentFixture<AddCourseComponent>;
  let api: {
    enrollmentRequests: ReturnType<typeof vi.fn>;
    createEnrollmentRequest: ReturnType<typeof vi.fn>;
    catalog: ReturnType<typeof vi.fn>;
  };
  let activeId: ReturnType<typeof signal<string | null>>;

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
    opts: { classes?: ParentCatalogClass[]; requests?: ParentEnrollmentRequest[] } = {},
  ) {
    api = {
      enrollmentRequests: vi.fn(() => of({ data: opts.requests ?? [] })),
      createEnrollmentRequest: vi.fn(() => of(req({ id: 'r-new' }))),
      catalog: vi.fn(() => of({ data: opts.classes ?? [cls()] })),
    };
    activeId = signal<string | null>(KID.id);
    const children = signal([KID, KID2]);
    await TestBed.configureTestingModule({
      imports: [AddCourseComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ParentApplicationsService, useValue: api },
        {
          provide: ChildScopeService,
          useValue: {
            children: children.asReadonly(),
            activeChildId: activeId.asReadonly(),
            activeChild: computed(() => children().find((k) => k.id === activeId()) ?? null),
            status: () => 'ready' as const,
            canSwitch: () => true,
            setActiveChild: (id: string) => activeId.set(id),
            load: vi.fn(),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AddCourseComponent);
    fixture.componentRef.setInput('page', PAGE);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent!.replace(/\s+/g, ' ');
  const title = () => el().querySelector('h1')!.textContent!.replace(/\s+/g, ' ').trim();
  const cards = () =>
    [...el().querySelectorAll('[data-class]')].map((c) => c.getAttribute('data-class'));
  const card = (id: string) => el().querySelector<HTMLButtonElement>(`[data-class="${id}"]`)!;
  const dialog = () => el().querySelector('dialog')!;
  const btn = (label: RegExp, root: ParentNode = el()) =>
    [...root.querySelectorAll<HTMLElement>('button, a')].find((b) =>
      label.test(b.textContent ?? ''),
    );
  const cmp = () => fixture.componentInstance as any;
  const openCard = async (id: string) => {
    card(id).click();
    await Promise.resolve(); // showModal 在 microtask
    fixture.detectChanges();
  };
  const tap = (b: HTMLElement | undefined) => {
    b!.click();
    fixture.detectChanges();
  };
  const setDate = (v: string) => {
    const input = dialog().querySelector<HTMLInputElement>('input[type="date"]')!;
    input.value = v;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  describe('卡片', () => {
    it('只列年級對、還沒在班上的；推薦的排前面；頁首寫可加選幾個班', async () => {
      await setup({
        classes: [
          cls({ classId: 'c-a' }),
          cls({ classId: 'c-rec', isRecommended: true }),
          cls({ classId: 'c-in', enrolled: true }),
          cls({ classId: 'c-grade', matchesGrade: false }),
        ],
      });
      expect(cards()).toEqual(['c-rec', 'c-a']);
      expect(title()).toBe('林子晴可以加選2 個班。');
      expect(card('c-rec').textContent).toContain('推薦加選');
    });

    it('沒有可加選的：頁首與空狀態', async () => {
      await setup({ classes: [cls({ enrolled: true })] });
      expect(title()).toBe('林子晴目前沒有可以加選的班。');
      expect(text()).toContain('目前沒有適合的可加選課程。');
      expect(el().querySelector('a[href="/parent/trial"]')).not.toBeNull();
    });

    it('撞時間琥珀字；額滿寫可登記候補；剩 3 位以下紅字', async () => {
      await setup({
        classes: [
          cls({ classId: 'c-clash', conflictsWith: '國三英文 A 班' }),
          cls({ classId: 'c-full', remainingSeats: 0 }),
          cls({ classId: 'c-low', remainingSeats: 3 }),
          cls({ classId: 'c-ok', remainingSeats: 4 }),
        ],
      });
      expect(card('c-clash').querySelector('.text-warning-800')!.textContent).toContain(
        '跟 國三英文 A 班 撞時間',
      );
      expect(card('c-ok').querySelector('.text-warning-800')).toBeNull();
      expect(card('c-full').textContent).toContain('已額滿 · 可登記候補');
      expect(card('c-low').querySelector('.text-error-700')!.textContent).toContain('剩 3 位');
      expect(card('c-ok').querySelector('.text-error-700')).toBeNull();
      expect(card('c-ok').textContent).toContain('4,800 元／月');
    });

    it('已送出（待審核／待付款）標「已送出申請」；候補中額滿寫「已登記候補」；別的孩子的不算', async () => {
      await setup({
        classes: [
          cls({ classId: 'c-p' }),
          cls({ classId: 'c-pay' }),
          cls({ classId: 'c-wl', remainingSeats: 0 }),
          cls({ classId: 'c-other' }),
          cls({ classId: 'c-rej' }),
        ],
        requests: [
          req({ classId: 'c-p', status: 'pending' }),
          req({ id: 'r2', classId: 'c-pay', status: 'awaiting_payment' }),
          req({ id: 'r3', classId: 'c-wl', status: 'waitlist' }),
          req({ id: 'r4', classId: 'c-other', status: 'pending', studentId: 'kid-2' }),
          req({ id: 'r5', classId: 'c-rej', status: 'rejected' }),
        ],
      });
      expect(card('c-p').textContent).toContain('已送出申請');
      expect(card('c-pay').textContent).toContain('已送出申請');
      expect(card('c-wl').textContent).toContain('已登記候補');
      expect(card('c-other').textContent).not.toContain('已送出申請');
      expect(card('c-rej').textContent).not.toContain('已送出申請');
    });
  });

  describe('工具列', () => {
    it('關鍵字比對班名、科目、課程名；科目、星期；清除篩選', async () => {
      await setup({
        classes: [
          cls({ classId: 'c-math' }),
          cls({ classId: 'c-eng', className: 'A 班', subject: '英文', courseName: '國三課程' }),
          cls({
            classId: 'c-talk',
            className: 'B 班',
            subject: null,
            courseName: '英語會話',
            slots: [{ weekday: 6, startTime: '09:00', endTime: '11:00' }],
          }),
        ],
      });
      expect(text()).toContain('推薦的排在前面');
      cmp().q.set('英文');
      fixture.detectChanges();
      expect(cards()).toEqual(['c-eng']);
      expect(text()).toContain('符合 1 個');
      cmp().q.set('會話');
      fixture.detectChanges();
      expect(cards()).toEqual(['c-talk']);
      cmp().q.set('');
      cmp().subject.set('數學');
      fixture.detectChanges();
      expect(cards()).toEqual(['c-math']);
      cmp().subject.set(null);
      cmp().weekday.set(6);
      fixture.detectChanges();
      expect(cards()).toEqual(['c-talk']);
      tap(btn(/清除篩選/));
      expect(cards()).toHaveLength(3);
    });

    it('篩到 0 筆：寫目前沒有適合的，不放試聽連結', async () => {
      await setup();
      cmp().q.set('不存在');
      fixture.detectChanges();
      expect(text()).toContain('目前沒有適合的可加選課程。');
      expect(el().querySelector('a[href="/parent/trial"]')).toBeNull();
    });
  });

  describe('換孩子', () => {
    it('重抓那個孩子的目錄；快速切換時 A 晚回來不蓋掉 B', async () => {
      await setup();
      const replies: Record<string, Subject<{ data: ParentCatalogClass[] }>> = {
        'kid-1': new Subject(),
        'kid-2': new Subject(),
      };
      api.catalog.mockImplementation((id: string) => replies[id]);
      for (const id of ['kid-2', 'kid-1', 'kid-2']) {
        activeId.set(id);
        fixture.detectChanges();
        await fixture.whenStable();
      }
      replies['kid-2'].next({ data: [cls({ classId: 'c-b' })] });
      replies['kid-1'].next({ data: [cls({ classId: 'c-a' })] });
      fixture.detectChanges();
      expect(cards()).toEqual(['c-b']);
      expect(api.catalog).toHaveBeenLastCalledWith('kid-2');
    });
  });

  describe('詳情與加選', () => {
    it('詳情：介紹、時間、老師、地點、人數、費用、撞時間', async () => {
      await setup({ classes: [cls({ conflictsWith: '國三英文 A 班', remainingSeats: 2 })] });
      await openCard('c-math');
      const d = dialog().textContent!.replace(/\s+/g, ' ');
      expect(dialog().open).toBe(true);
      expect(d).toContain('照學校進度先講觀念');
      expect(d).toContain('每週二 18:00–20:00');
      expect(d).toContain('王老師');
      expect(d).toContain('本校');
      expect(d).toContain('18 / 20 人');
      expect(d).toContain('跟林子晴的 國三英文 A 班 撞時間');
    });

    it('加選：預選班的繳費週期（期繳）、可改；送出帶 billingMode／日期／備註 → 完成畫面「繼續瀏覽／查看申請狀態」', async () => {
      await setup({ classes: [cls({ fee: { amount: 18000, billingMode: 'period' } })] });
      await openCard('c-math');
      tap(btn(/加選此課程/, dialog()));
      const radio = (m: string) =>
        dialog().querySelector<HTMLInputElement>(`input[name="mode"][value="${m}"]`)!;
      expect(radio('period').checked).toBe(true);
      expect(text()).toContain('還沒填：開始日期');
      tap(radio('monthly'));
      setDate('2026-11-01');
      const note = dialog().querySelector<HTMLTextAreaElement>('textarea')!;
      note.value = ' 想先試聽 ';
      note.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      api.enrollmentRequests.mockClear();
      tap(btn(/送出加選申請/, dialog()));
      expect(api.createEnrollmentRequest).toHaveBeenCalledWith({
        studentId: KID.id,
        classId: 'c-math',
        preferredStartDate: '2026-11-01',
        note: '想先試聽',
        billingMode: 'monthly',
        waitlist: false,
      });
      expect(api.enrollmentRequests).toHaveBeenCalled();
      expect(dialog().textContent).toContain('已送出加選申請');
      expect(dialog().textContent).toContain('月繳');
      expect(btn(/繼續瀏覽/, dialog())).toBeDefined();
      const go = btn(/查看申請狀態/, dialog())!;
      expect(go.getAttribute('href')).toBe('/parent/enrollment#records');
    });

    it('班沒有範本或是堂數制：不預選繳費週期，沒選就不帶', async () => {
      await setup({ classes: [cls({ fee: { amount: 3000, billingMode: 'session_pack' } })] });
      await openCard('c-math');
      tap(btn(/加選此課程/, dialog()));
      expect(dialog().querySelector('input[name="mode"]:checked')).toBeNull();
      setDate('2026-11-01');
      tap(btn(/送出加選申請/, dialog()));
      expect(api.createEnrollmentRequest).toHaveBeenCalledWith(
        expect.objectContaining({ billingMode: undefined }),
      );
    });

    it('額滿：詳情鈕變「登記候補」，只問備註，送 waitlist: true，完成畫面寫已登記候補', async () => {
      await setup({ classes: [cls({ remainingSeats: 0 })] });
      await openCard('c-math');
      expect(btn(/加選此課程/, dialog())).toBeUndefined();
      tap(btn(/登記候補/, dialog()));
      expect(dialog().querySelector('input[type="date"]')).toBeNull();
      expect(text()).not.toContain('還沒填');
      tap(btn(/登記候補/, dialog().querySelector('form')!));
      expect(api.createEnrollmentRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          waitlist: true,
          preferredStartDate: undefined,
          billingMode: undefined,
        }),
      );
      expect(dialog().textContent).toContain('這班已額滿，已為您登記候補，補習班會主動聯絡。');
    });

    it('換一班加選：上一班填的開始日期、備註不帶過來', async () => {
      await setup({ classes: [cls({ classId: 'c-a' }), cls({ classId: 'c-b' })] });
      await openCard('c-a');
      tap(btn(/加選此課程/, dialog()));
      setDate('2026-11-01');
      cmp().close();
      fixture.detectChanges();
      await openCard('c-b');
      tap(btn(/加選此課程/, dialog()));
      expect(dialog().querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('');
      expect(dialog().textContent).toContain('還沒填：開始日期');
    });

    it('剛好剩 1 位：還能加選，不是額滿', async () => {
      await setup({ classes: [cls({ remainingSeats: 1 })] });
      expect(card('c-math').textContent).toContain('剩 1 位');
      expect(card('c-math').textContent).not.toContain('已額滿');
      await openCard('c-math');
      expect(btn(/加選此課程/, dialog())).toBeDefined();
    });

    it('已送出申請的班：詳情只有「查看申請狀態」', async () => {
      await setup({ requests: [req({ classId: 'c-math' })] });
      await openCard('c-math');
      expect(btn(/加選此課程/, dialog())).toBeUndefined();
      expect(btn(/查看申請狀態/, dialog())).toBeDefined();
    });

    it('送出失敗：錯誤留在表單、填的不清、按鈕可以再按且真的再送', async () => {
      await setup();
      api.createEnrollmentRequest.mockReturnValue(
        throwError(() => ({
          status: 409,
          error: { error: '這個班已經有一筆申請在處理中', code: 'DUPLICATE_REQUEST' },
        })),
      );
      await openCard('c-math');
      tap(btn(/加選此課程/, dialog()));
      setDate('2026-11-01');
      tap(btn(/送出加選申請/, dialog()));
      expect(dialog().textContent).toContain('這個班已經有一筆申請在處理中');
      expect(dialog().querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe(
        '2026-11-01',
      );
      const again = btn(/送出加選申請/, dialog())!;
      expect(again.getAttribute('aria-disabled')).toBe('false');
      again.click();
      expect(api.createEnrollmentRequest).toHaveBeenCalledTimes(2);
    });

    it('重送時清掉上一次的錯誤', async () => {
      await setup();
      api.createEnrollmentRequest.mockReturnValue(
        throwError(() => ({ status: 0, error: { error: '上一次的錯誤', code: 'X' } })),
      );
      await openCard('c-math');
      tap(btn(/加選此課程/, dialog()));
      setDate('2026-11-01');
      tap(btn(/送出加選申請/, dialog()));
      expect(dialog().textContent).toContain('上一次的錯誤');
      api.createEnrollmentRequest.mockReturnValue(new Subject()); // 第二次還在送
      tap(btn(/送出加選申請/, dialog()));
      expect(dialog().textContent).not.toContain('上一次的錯誤');
      expect(dialog().textContent).toContain('送出中…');
    });

    it('星期篩選有週日', async () => {
      await setup({
        classes: [
          cls({ classId: 'c-sun', slots: [{ weekday: 7, startTime: '09:00', endTime: '11:00' }] }),
          cls({ classId: 'c-tue' }),
        ],
      });
      expect(cmp().weekdayOptions.map((o: { value: number }) => o.value)).toContain(7);
      cmp().weekday.set(7);
      fixture.detectChanges();
      expect(cards()).toEqual(['c-sun']);
    });

    it('CLASS_FULL（剛好被搶走最後一位）：重抓目錄，按鈕變「登記候補」', async () => {
      await setup();
      api.createEnrollmentRequest.mockReturnValue(
        throwError(() => ({ status: 409, error: { error: '這個班已額滿', code: 'CLASS_FULL' } })),
      );
      await openCard('c-math');
      tap(btn(/加選此課程/, dialog()));
      setDate('2026-11-01');
      api.catalog.mockClear();
      api.catalog.mockReturnValue(of({ data: [cls({ remainingSeats: 0 })] }));
      tap(btn(/送出加選申請/, dialog()));
      expect(api.catalog).toHaveBeenCalledTimes(1);
      expect(text()).toContain('這個班已額滿');
      expect(btn(/登記候補/, dialog().querySelector('form')!)).toBeDefined();
    });
  });

  // #1983：「符合 N 個」是資料算出來、會隨篩選變的字，換字走 appTextSwap
  describe('「符合 N 個」換字（#1983）', () => {
    let animated: HTMLElement[];
    const stubMotion = (reduce: boolean) => {
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce') }));
      animated = [];
      (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (
        this: HTMLElement,
      ) {
        animated.push(this);
        return { cancel: vi.fn(), finished: new Promise(() => undefined) };
      };
    };
    afterEach(() => {
      vi.unstubAllGlobals();
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    });
    const search = async (q: string) => {
      cmp().q.set(q);
      fixture.detectChanges();
      await fixture.whenStable();
      await Promise.resolve(); // MutationObserver 回呼
      await Promise.resolve(); // 合成一次換字的 microtask
    };
    const classes = () => [
      cls({ classId: 'c-math' }),
      cls({ classId: 'c-eng', className: 'A 班', subject: '英文', courseName: '國三課程' }),
      cls({ classId: 'c-eng2', className: 'C 班', subject: '英文', courseName: '國三英文' }),
    ];
    const host = () => el().querySelector('span[apptextswap]') as HTMLElement;

    it('值變了會播', async () => {
      stubMotion(false);
      await setup({ classes: classes() });
      await search('英文'); // 符合 2 個：第一次出現，只記不播
      expect(animated).toHaveLength(0);
      await search('C 班');
      expect(host().textContent).toContain('符合 1 個');
      expect(animated).toContain(host());
    });

    it('值沒變不播', async () => {
      stubMotion(false);
      await setup({ classes: classes() });
      await search('英文');
      await search('英'); // 還是 2 個
      expect(animated).not.toContain(host());
    });

    it('減少動態不播', async () => {
      stubMotion(true);
      await setup({ classes: classes() });
      await search('英文');
      await search('C 班');
      expect(animated).not.toContain(host());
    });
  });
});
