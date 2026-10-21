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
  type ParentTrialRequest,
} from '@core/parent-applications.service';
import { TrialComponent } from './trial.component';

/** #1727 ④：家長端試聽申請（A6 p-trial）—— 一門課一列（R5 偏離），時段 chip 寫進 preferredTimes */

const PAGE = {
  label: '試聽申請',
  relativePath: '',
  absolutePath: '',
  role: undefined,
  icon: '',
  showInMenu: true,
};

const KID = { id: 'kid-1', name: '林子晴', grade: 'J3', school: null };
const KID2 = { id: 'kid-2', name: '林子安', grade: 'J1', school: null };

const cls = (over: Partial<ParentCatalogClass> = {}): ParentCatalogClass => ({
  classId: 'c-math-a',
  className: '國三數學 A 班',
  gradeLevels: [],
  courseId: 'co-math',
  courseName: '國三數學',
  subject: '數學',
  courseDescription: null,
  campusName: '本校',
  slots: [{ weekday: 2, startTime: '18:00', endTime: '20:00' }],
  maxStudents: 20,
  remainingSeats: 8,
  fee: null,
  isRecommended: false,
  teacherNames: ['王老師'],
  matchesGrade: true,
  enrolled: false,
  conflictsWith: null,
  ...over,
});

const trial = (over: Partial<ParentTrialRequest> = {}): ParentTrialRequest => ({
  id: 't-1',
  studentId: KID.id,
  studentName: KID.name,
  courseId: 'co-x',
  courseName: '國三理化',
  status: 'pending',
  preferredTimes: null,
  note: null,
  createdAt: '2026-10-18T02:00:00Z',
  scheduledDate: null,
  scheduledStartTime: null,
  scheduledEndTime: null,
  campusName: '總校',
  campusPhone: '02-2345-6789',
  ...over,
});

describe('TrialComponent（家長端試聽申請）', () => {
  let fixture: ComponentFixture<TrialComponent>;
  let api: {
    trialRequests: ReturnType<typeof vi.fn>;
    createTrialRequests: ReturnType<typeof vi.fn>;
    catalog: ReturnType<typeof vi.fn>;
  };
  let toast: ReturnType<typeof vi.fn>;
  let kidsSig: ReturnType<typeof signal<Array<typeof KID>>>;
  let activeSig: ReturnType<typeof signal<string | null>>;

  const dialogProto = HTMLDialogElement.prototype;
  const originalDialog = { showModal: dialogProto.showModal, close: dialogProto.close };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T04:00:00Z'));
    dialogProto.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    dialogProto.close = function (this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    Object.assign(dialogProto, originalDialog);
  });

  async function setup(
    opts: {
      classes?: ParentCatalogClass[];
      requests?: ParentTrialRequest[];
      records?: boolean;
      kids?: Array<typeof KID>;
      /** 孩子名單晚到（直接打開這頁）：一開始 activeChildId 是 null */
      lateKids?: boolean;
    } = {},
  ) {
    api = {
      trialRequests: vi.fn(() => of({ data: opts.requests ?? [] })),
      createTrialRequests: vi.fn(() => of({ data: [trial({ id: 't-new' })] })),
      catalog: vi.fn(() => of({ data: opts.classes ?? [cls()] })),
    };
    toast = vi.fn();
    kidsSig = signal(opts.lateKids ? [] : (opts.kids ?? [KID]));
    activeSig = signal<string | null>(opts.lateKids ? null : KID.id);
    await TestBed.configureTestingModule({
      imports: [TrialComponent],
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
    fixture = TestBed.createComponent(TrialComponent);
    fixture.componentRef.setInput('page', PAGE);
    if (opts.records) (fixture.componentInstance as any).tab.set('records');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent!.replace(/\s+/g, ' ');
  const title = () => el().querySelector('h1')!.textContent!.replace(/\s+/g, ' ').trim();
  const btn = (label: RegExp) =>
    [...el().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      label.test(b.textContent ?? ''),
    );
  const course = (id: string) =>
    el().querySelector<HTMLInputElement>(`input[name="courseId"][value="${id}"]`);
  const chip = (label: string) =>
    [...el().querySelectorAll<HTMLLabelElement>('[data-course] label')]
      .find((l) => l.textContent!.trim() === label)
      ?.querySelector('input') as HTMLInputElement | undefined;
  const type = (selector: string, v: string) => {
    const input = el().querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    input.value = v;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const click = (input: HTMLInputElement) => {
    input.click();
    fixture.detectChanges();
  };
  const open = (id: string) => {
    el().querySelector<HTMLButtonElement>(`[data-request="${id}"]`)!.click();
    fixture.detectChanges();
    return el().querySelector('dialog')!;
  };

  describe('新增申請', () => {
    it('一門課一列：同課程的班合成一列；推薦的一組在最前；孩子已在上的課整門不出現', async () => {
      await setup({
        classes: [
          cls(),
          cls({ classId: 'c-math-b', className: '國三數學 B 班' }),
          cls({
            classId: 'c-eng',
            courseId: 'co-eng',
            courseName: '國三英文',
            subject: '英文',
            isRecommended: true,
          }),
          // 孩子在理化 A 班 → 理化這門課（含 B 班）都不出現
          cls({ classId: 'c-sci-a', courseId: 'co-sci', courseName: '國三理化', enrolled: true }),
          cls({ classId: 'c-sci-b', courseId: 'co-sci', courseName: '國三理化' }),
        ],
      });
      expect(el().querySelectorAll('input[name="courseId"]')).toHaveLength(2);
      expect(course('co-sci')).toBeNull();
      expect([...el().querySelectorAll('h3')].map((h) => h.textContent!.trim())).toEqual([
        '推薦加選',
        '數學',
      ]);
      expect(el().querySelector('[data-course="co-math"]')!.textContent).toContain('2 個班');
    });

    it('同門課有待處理或已安排的試聽：列出但不能選、寫原因；已完成的、別的孩子的不影響', async () => {
      await setup({
        classes: [
          cls({ courseId: 'co-a', courseName: 'A 課' }),
          cls({ courseId: 'co-b', courseName: 'B 課' }),
          cls({ courseId: 'co-c', courseName: 'C 課' }),
          cls({ courseId: 'co-d', courseName: 'D 課' }),
        ],
        requests: [
          trial({ id: 'r1', courseId: 'co-a', status: 'pending' }),
          trial({ id: 'r2', courseId: 'co-b', status: 'scheduled' }),
          trial({ id: 'r3', courseId: 'co-c', status: 'completed' }),
          trial({ id: 'r4', courseId: 'co-d', status: 'pending', studentId: 'kid-2' }),
        ],
      });
      expect(course('co-a')!.disabled).toBe(true);
      expect(course('co-b')!.disabled).toBe(true);
      expect(course('co-c')!.disabled).toBe(false);
      expect(course('co-d')!.disabled).toBe(false);
      expect(text()).toContain('試聽申請處理中');
      expect(text()).toContain('已安排試聽');
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
      expect(text()).toContain('還沒填：想試聽的課');
      expect(text()).not.toContain('還沒填：孩子');
    });

    // 審核席 G2：孩子名旁的年級（API 回代碼 J3，畫面寫國三）
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

    it('還沒填：想試聽的課（孩子只有一個時預設選好）', async () => {
      await setup();
      expect(text()).toContain('還沒填：想試聽的課');
      expect(btn(/送出試聽申請/)!.getAttribute('aria-disabled')).toBe('true');
    });

    it('勾了課才出時段 chip；取消勾課，那門課勾過的時段一起拿掉', async () => {
      await setup({ classes: [cls(), cls({ classId: 'c-b', className: '國三數學 B 班' })] });
      expect(chip('國三數學 A 班 週二 18:00–20:00')).toBeUndefined();
      click(course('co-math')!);
      click(chip('國三數學 B 班 週二 18:00–20:00')!);
      click(course('co-math')!);
      click(course('co-math')!);
      expect(chip('國三數學 B 班 週二 18:00–20:00')!.checked).toBe(false);
    });

    it('送出：一次兩門課；勾的時段＋自己寫的時段寫進 preferredTimes；成功 → toast、切到紀錄、重抓', async () => {
      await setup({
        classes: [
          cls(),
          cls({
            classId: 'c-eng',
            courseId: 'co-eng',
            courseName: '國三英文',
            className: '英文 A 班',
          }),
        ],
      });
      click(course('co-math')!);
      click(course('co-eng')!);
      click(chip('國三數學 A 班 週二 18:00–20:00')!);
      type('#trial-slot', ' 週六上午 ');
      type('#trial-note', '想看進度');
      api.trialRequests.mockClear();
      btn(/送出試聽申請/)!.click();
      fixture.detectChanges();
      expect(api.createTrialRequests).toHaveBeenCalledWith({
        studentId: KID.id,
        courseIds: ['co-math', 'co-eng'],
        preferredTimes: '國三數學 A 班 週二 18:00–20:00、週六上午',
        note: '想看進度',
      });
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: '已送出 林子晴 的試聽申請（2 門），補習班會打電話跟你約時間',
        }),
      );
      expect(api.trialRequests).toHaveBeenCalled();
      expect((fixture.componentInstance as any).tab()).toBe('records');
    });

    it('沒勾時段也沒寫：不帶 preferredTimes', async () => {
      await setup();
      click(course('co-math')!);
      btn(/送出試聽申請/)!.click();
      expect(api.createTrialRequests).toHaveBeenCalledWith(
        expect.objectContaining({ preferredTimes: undefined, note: undefined }),
      );
    });

    it('送出失敗：錯誤留在表單、勾的不清、按鈕可以再按且真的再送', async () => {
      await setup();
      api.createTrialRequests.mockReturnValue(
        throwError(() => ({
          status: 409,
          error: { error: '這門課已經有一筆試聽在處理中', code: 'DUPLICATE_REQUEST' },
        })),
      );
      click(course('co-math')!);
      btn(/送出試聽申請/)!.click();
      fixture.detectChanges();
      expect(text()).toContain('這門課已經有一筆試聽在處理中');
      expect(course('co-math')!.checked).toBe(true);
      expect((fixture.componentInstance as any).tab()).toBe('new');
      const again = btn(/送出試聽申請/)!;
      expect(again.getAttribute('aria-disabled')).toBe('false');
      again.click();
      expect(api.createTrialRequests).toHaveBeenCalledTimes(2);
    });

    it('網路失敗（沒有伺服器訊息）：寫通用訊息', async () => {
      await setup();
      api.createTrialRequests.mockReturnValue(throwError(() => ({ status: 0 })));
      click(course('co-math')!);
      btn(/送出試聽申請/)!.click();
      fixture.detectChanges();
      expect(text()).toContain('送出失敗，請檢查網路後再試');
    });

    it('換孩子：清掉勾的課、重抓那個孩子的目錄', async () => {
      await setup({ kids: [KID, KID2] });
      click(course('co-math')!);
      click(el().querySelector<HTMLInputElement>('input[name="sid"][value="kid-2"]')!);
      await fixture.whenStable();
      fixture.detectChanges();
      expect(api.catalog).toHaveBeenLastCalledWith('kid-2');
      expect(course('co-math')!.checked).toBe(false);
      expect(text()).toContain('還沒填：想試聽的課');
    });

    it('快速換孩子：A 晚回來不蓋掉 B 的目錄', async () => {
      await setup({ kids: [KID, KID2] });
      const replies: Record<string, Subject<{ data: ParentCatalogClass[] }>> = {
        'kid-1': new Subject(),
        'kid-2': new Subject(),
      };
      api.catalog.mockImplementation((sid: string) => replies[sid]);
      for (const id of ['kid-2', 'kid-1', 'kid-2']) {
        click(el().querySelector<HTMLInputElement>(`input[name="sid"][value="${id}"]`)!);
        await fixture.whenStable();
      }
      replies['kid-2'].next({ data: [cls({ courseId: 'co-b' })] });
      replies['kid-1'].next({ data: [cls({ courseId: 'co-a' })] });
      fixture.detectChanges();
      expect(course('co-b')).not.toBeNull();
      expect(course('co-a')).toBeNull();
    });
  });

  describe('頁首', () => {
    it('有排好日期的：最早、還沒過的那一筆；另外寫其他筆數', async () => {
      await setup({
        requests: [
          trial({ id: 'a', status: 'scheduled', scheduledDate: '2026-10-28', courseName: '英文' }),
          trial({ id: 'b', status: 'scheduled', scheduledDate: '2026-10-21', courseName: '數學' }),
          // 已經過了的不上頁首
          trial({ id: 'c', status: 'scheduled', scheduledDate: '2026-10-12', courseName: '國文' }),
          trial({ id: 'd', status: 'pending' }),
        ],
      });
      expect(title()).toBe('林子晴 10/21（三） 去試聽數學。');
      expect(text()).toContain('另外還有 1 筆試聽已排好、1 筆在等安排。');
    });

    // 邊界兩側（審核席突變 >= → >）：今天的試聽還沒上完，要上頁首；昨天的已經過了
    it('排在今天的上頁首；排在昨天的不上', async () => {
      await setup({
        requests: [
          trial({ id: 'y', status: 'scheduled', scheduledDate: '2026-10-18', courseName: '國文' }),
          trial({ id: 't', status: 'scheduled', scheduledDate: '2026-10-19', courseName: '數學' }),
        ],
      });
      expect(title()).toBe('林子晴 10/19（一） 去試聽數學。');
    });

    it('只有排在昨天的：不上頁首', async () => {
      await setup({
        requests: [
          trial({ id: 'y', status: 'scheduled', scheduledDate: '2026-10-18', courseName: '國文' }),
        ],
      });
      expect(title()).toBe('想讓孩子先上一堂看看？');
    });

    it('已安排但還沒日期的不上頁首；只有待處理 → 寫筆數', async () => {
      await setup({
        requests: [trial({ id: 'a', status: 'scheduled' }), trial({ id: 'b', status: 'pending' })],
      });
      expect(title()).toBe('1 筆試聽在等補習班安排。');
    });

    it('都沒有：想讓孩子先上一堂看看？', async () => {
      await setup({ requests: [trial({ status: 'completed' })] });
      expect(title()).toBe('想讓孩子先上一堂看看？');
    });
  });

  describe('申請紀錄', () => {
    it('新到舊；已安排有日期寫「M/D（週）HH:MM 試聽」，沒日期寫「補習班會跟你聯絡時間」', async () => {
      await setup({
        records: true,
        requests: [
          trial({ id: 'old', status: 'completed', createdAt: '2026-09-01T02:00:00Z' }),
          trial({
            id: 'dated',
            status: 'scheduled',
            scheduledDate: '2026-10-21',
            scheduledStartTime: '18:30',
            createdAt: '2026-10-10T02:00:00Z',
          }),
          trial({ id: 'nodate', status: 'scheduled', createdAt: '2026-10-15T02:00:00Z' }),
        ],
      });
      const rows = [...el().querySelectorAll('[data-request]')];
      expect(rows.map((r) => r.getAttribute('data-request'))).toEqual(['nodate', 'dated', 'old']);
      expect(rows[1].textContent).toContain('林子晴 · 10/21（三） 18:30 試聽 · 10/10 送出');
      expect(rows[0].textContent).toContain('補習班會跟你聯絡時間');
      expect(rows[2].textContent).not.toContain('試聽 ·');
    });

    it('詳情（已安排有日期）：試聽安排、方便時段、分校電話＋複製；沒有取消鈕', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      await setup({
        records: true,
        requests: [
          trial({
            status: 'scheduled',
            scheduledDate: '2026-10-21',
            scheduledStartTime: '18:30',
            scheduledEndTime: '20:00',
            preferredTimes: '週六上午',
          }),
        ],
      });
      const dialog = open('t-1');
      expect(dialog.querySelector('[data-arrangement]')!.textContent).toContain(
        '10/21（三） 18:30–20:00',
      );
      expect(dialog.textContent).toContain('週六上午');
      expect(dialog.querySelector('[data-call]')!.textContent).toContain('02-2345-6789');
      expect(btn(/取消/)).toBeUndefined();
      btn(/複製電話/)!.click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith('02-2345-6789');
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ summary: '已複製電話 02-2345-6789' }),
      );
    });

    it('待處理沒有電話：寫「請打電話給補習班」不放號碼、沒有複製鈕；沒日期就沒有試聽安排', async () => {
      await setup({ records: true, requests: [trial({ campusPhone: null })] });
      const dialog = open('t-1');
      expect(dialog.querySelector('[data-call]')!.textContent).toContain('請打電話給補習班。');
      expect(btn(/複製電話/)).toBeUndefined();
      expect(dialog.querySelector('[data-arrangement]')).toBeNull();
    });

    it('已完成、已取消：沒有「要取消或改時間」', async () => {
      await setup({
        records: true,
        requests: [
          trial({ id: 'done', status: 'completed' }),
          trial({ id: 'off', status: 'cancelled' }),
        ],
      });
      for (const id of ['done', 'off']) {
        expect(open(id).querySelector('[data-call]')).toBeNull();
        (fixture.componentInstance as any).closeDetail();
        fixture.detectChanges();
      }
    });
  });
});
