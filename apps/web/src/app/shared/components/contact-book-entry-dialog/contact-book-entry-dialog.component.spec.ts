import { ToastComponent } from '@shared/components/toast/toast.component';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { vi } from 'vitest';

import { ContactBookService, type ContactBookEntry } from '@core/contact-book.service';

import { ContactBookEntryDialogComponent } from './contact-book-entry-dialog.component';

describe('ContactBookEntryDialogComponent', () => {
  let fixture: ComponentFixture<ContactBookEntryDialogComponent>;

  // `signed_at` 是 timestamptz（`20260829100000_create_contact_book_and_class_logs.sql:30`），
  // 而 API 原樣傳出 —— `contact-book.spec.ts:53` 就斷言了這個形狀。
  const signedEntry: ContactBookEntry = {
    id: 'entry-1',
    studentId: 'student-1',
    studentName: '王小明',
    entryDate: '2026-08-29',
    content: '今天有練到直式除法。',
    lastEditedByName: '陳老師',
    signedBy: 'user-1',
    signedByName: '林太太',
    signedAt: '2026-08-29T12:00:00Z',
    isSigned: true,
    editedAfterSign: false,
  };

  const setup = async (entry: ContactBookEntry) => {
    await TestBed.configureTestingModule({
      imports: [ContactBookEntryDialogComponent],
      providers: [
        MessageService,
        { provide: ContactBookService, useValue: { upsert: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data: { entry } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContactBookEntryDialogComponent);
    fixture.detectChanges();
    return fixture.nativeElement.textContent as string;
  };

  /**
   * `signedAt` 是這個 repo 裡**唯一**被原樣渲染的 timestamptz —— 其餘每一個被
   * 直接內插的日期欄位都是 `date` 欄（渲染成 `2026-09-05`，那是刻意的完整日期形式）。
   * 沒有格式化的話這句話會變成「家長已於 2026-08-29T12:00:00Z 簽收」。
   *
   * 斷言盯的是「**不出現 ISO 的 T 與 Z**」而不是某一個特定格式字串 ——
   * 要換成別的顯示格式請一起改下面那條正面斷言，但不要讓這條變成零。
   */
  it('簽收時間不以原始 ISO 時間戳渲染', async () => {
    const text = await setup(signedEntry);

    expect(text).toContain('簽收');
    expect(text).not.toContain('2026-08-29T12:00:00Z');
  });

  it('簽收時間渲染成人看得懂的日期時間', async () => {
    const text = await setup(signedEntry);

    expect(text).toMatch(/2026-08-29 \d{2}:\d{2}/);
  });

  /**
   * 對照組：沒有這一條的話，上面那條「不含 ISO」在**整句話根本沒渲染**時
   * 也會是綠的（坑 16 —— 只斷言「沒有結果」的測試要有同結構的正面對照）。
   */
  it('未簽收時不出現簽收那一句', async () => {
    const text = await setup({ ...signedEntry, isSigned: false, signedAt: null });

    expect(text).not.toContain('簽收。');
  });

  /**
   * #1314 CB6：儲存鈕 `[disabled]="!dirty()"` 停用時要講原因。
   * 對照組（有改動時提示消失）跟「停用時有提示」成對 —— 只斷言「有提示」的話，
   * 提示永遠顯示也會是綠的（坑 16）。
   */
  describe('#1314 CB6 儲存鈕停用原因', () => {
    const reason = () =>
      fixture.nativeElement.querySelector('.entry-dialog__disabled-reason') as HTMLElement | null;
    const saveButton = () =>
      fixture.nativeElement.querySelector('.entry-dialog__footer p-button:last-child button') as
        HTMLButtonElement | undefined;

    it('既有稿沒改：停用並寫「內容沒有修改」，改了之後提示消失、鈕可按', async () => {
      await setup(signedEntry);

      expect(reason()?.textContent?.trim()).toBe('內容沒有修改，改了才能儲存');
      expect(saveButton()?.disabled).toBe(true);

      fixture.componentInstance['content'].set('改過的內容');
      fixture.detectChanges();

      expect(reason()).toBeNull();
      expect(saveButton()?.disabled).toBe(false);
    });

    it('新稿沒寫字：停用並寫「還沒寫內容」；只有空白也算沒寫', async () => {
      await TestBed.configureTestingModule({
        imports: [ContactBookEntryDialogComponent],
        providers: [
          MessageService,
          { provide: ContactBookService, useValue: { upsert: vi.fn() } },
          { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
          {
            provide: DynamicDialogConfig,
            useValue: {
              data: { draft: { studentId: 's1', studentName: '王柏睿', entryDate: '2026-08-31' } },
            },
          },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(ContactBookEntryDialogComponent);
      fixture.detectChanges();

      expect(reason()?.textContent?.trim()).toBe('還沒寫內容，寫了才能寫入');

      fixture.componentInstance['content'].set('   ');
      fixture.detectChanges();
      expect(reason()?.textContent?.trim()).toBe('還沒寫內容，寫了才能寫入');

      fixture.componentInstance['content'].set('今天有練習');
      fixture.detectChanges();
      expect(reason()).toBeNull();
    });
  });

  /**
   * #733 → #1615：老師端（`contact-book-roster`）整條鏈上原本沒有 `MessageService` 也沒有
   * `<p-toast>`，所以這支對話框曾經自己帶一組。#1615 起兩樣都是全站一份
   * （`app.config.ts` 的 provider＋`App` 的 `<app-toast>`），對話框**不能再自己 provide** ——
   * 自己 provide 的話訊息只進這一層，全站出口收不到，「儲存失敗」又變回看不見。
   */
  describe('#733／#1615 對話框的訊息走全站出口', () => {
    const setupWithRoot = async () => {
      await TestBed.configureTestingModule({
        imports: [ContactBookEntryDialogComponent],
        providers: [
          MessageService,
          { provide: ContactBookService, useValue: { upsert: vi.fn() } },
          { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
          { provide: DynamicDialogConfig, useValue: { data: { entry: signedEntry } } },
        ],
      }).compileComponents();

      const f = TestBed.createComponent(ContactBookEntryDialogComponent);
      f.detectChanges();
      return f;
    };

    it('拿到的是全站那一個 MessageService（沒有自己 provide）', async () => {
      const f = await setupWithRoot();

      expect(f.debugElement.injector.get(MessageService)).toBe(TestBed.inject(MessageService));
      expect(f.nativeElement.textContent).toContain('王小明');
    });

    it('發的訊息到得了全站出口', async () => {
      const f = await setupWithRoot();
      const outlet = TestBed.createComponent(ToastComponent);

      f.debugElement.injector.get(MessageService).add({ severity: 'error', summary: '儲存失敗' });
      outlet.detectChanges();

      expect((outlet.nativeElement as HTMLElement).querySelector('.toast')).not.toBeNull();
    });
  });

  /**
   * #738：「還沒有人寫」那一支的文案**無條件**印
   * 「撰寫者本來是帶班老師 —— **這裡是行政的補寫入口**」。
   *
   * `#737` 之前老師端根本打不開這支對話框（NG0201），**所以只有行政看得到，文案成立**。
   * 路打通之後，帶班老師自己進來看到的也是這一句 ——
   * 對他來說「撰寫者本來是帶班老師」講的就是他自己，而「這裡是行政的補寫入口」是錯的。
   *
   * **不是 #737 的回歸，是它讓一條路走得通之後才露出來的。**
   *
   * 修法：`audience` 分岔，**而預設是中性的那一版**（見下方測試的理由）。
   */
  describe('#738 「還沒有人寫」的文案依對象分岔', () => {
    const ADMIN_ONLY = '這裡是行政的補寫入口';

    async function renderDraft(data: Record<string, unknown> = {}) {
      await TestBed.configureTestingModule({
        imports: [ContactBookEntryDialogComponent],
        providers: [
          MessageService,
          { provide: ContactBookService, useValue: { upsert: vi.fn() } },
          { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
          {
            provide: DynamicDialogConfig,
            useValue: {
              data: {
                draft: { studentId: 's1', studentName: '王柏睿', entryDate: '2026-08-31' },
                ...data,
              },
            },
          },
        ],
      }).compileComponents();

      const f = TestBed.createComponent(ContactBookEntryDialogComponent);
      f.detectChanges();
      return (f.nativeElement.textContent as string).replace(/\s+/g, ' ');
    }

    /**
     * **預設是中性版，而不是沿用現狀的行政版。**
     *
     * 這一點跟 `login-link-dialog`（#666）的做法相反，是刻意的：
     * 那一支的預設（家長版）對沒宣告的呼叫端是**對的**，這一支的預設（行政版）
     * 對沒宣告的呼叫端**可能是錯的**。
     *
     * **失效方向要選「少講一句」而不是「講錯一句」** ——
     * 將來多一個開啟點而有人忘了標對象時，使用者看到的是資訊少一點，不是被告知錯的事。
     */
    it('沒有標明對象時不講「行政」—— 老師那條路就是這樣開的', async () => {
      const text = await renderDraft();

      expect(text).toContain('這一則還沒有人寫');
      expect(text).not.toContain(ADMIN_ONLY);
      expect(text).not.toContain('行政');
    });

    it('標明是老師時也不講「行政」', async () => {
      const text = await renderDraft({ audience: 'teacher' });

      expect(text).not.toContain('行政');
    });

    /**
     * **反向對照 1**：行政版一字不動。
     * 那句話對行政是**有用的** —— 它解釋了「為什麼你在寫一則不是你負責的聯絡簿」。
     */
    it('標明是行政時保留原句', async () => {
      const text = await renderDraft({ audience: 'admin' });

      expect(text).toContain('撰寫者本來是帶班老師');
      expect(text).toContain(ADMIN_ONLY);
    });

    /**
     * **反向對照 2**：已經有內容的那一則**根本不走這個分支**。
     *
     * 這條同時釘住我對 `@if (entry()) … @else` 的理解 ——
     * `contact-book.page.ts:303` 的 `openEntry` 是用 `{ entry }` 開的，
     * **永遠到不了這句話**，所以那個呼叫端不需要標對象（標了是噪音）。
     */
    it('已經有內容時兩個版本都不印這一句', async () => {
      const text = await setup(signedEntry);

      expect(text).not.toContain('這一則還沒有人寫');
      expect(text).not.toContain(ADMIN_ONLY);
    });
  });
});
