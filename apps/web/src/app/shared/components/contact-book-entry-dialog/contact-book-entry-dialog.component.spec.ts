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
    signedAt: '2026-08-29T12:00:00Z',
    isSigned: true,
  };

  const setup = async (entry: ContactBookEntry) => {
    await TestBed.configureTestingModule({
      imports: [ContactBookEntryDialogComponent],
      providers: [
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
   * #733：**這支對話框自己 `inject(MessageService)`，卻沒有自己 `provide` 它。**
   *
   * `MessageService` 不是 `providedIn: 'root'` —— 要由 injector 鏈上的誰給。
   * 三個開啟點裡只有 admin 那兩處給了（`contact-book.page.ts:76`）；
   * 老師端（`contact-book-roster.component.ts:100`）整條鏈上都沒有，
   * 於是按「撰寫」時 `NG0201`，DOM 裡多一層**空的** `.p-dialog`，
   * 使用者看到的是「這顆按鈕壞了」。
   *
   * ⚠️ **上面那些既有測試每一支都自己 provide 了 `MessageService`** ——
   * 也就是說**測試環境剛好複製了會動的那個呼叫端**，所以這個缺陷對它們不可見。
   * 下面第一支就是把那個缺口補起來。
   */
  describe('#733 對話框要能自己活著（不依賴呼叫端提供 MessageService）', () => {
    /** 刻意**不**提供 `MessageService` —— 這就是老師端的 injector 環境 */
    const setupWithoutMessageService = async () => {
      await TestBed.configureTestingModule({
        imports: [ContactBookEntryDialogComponent],
        providers: [
          { provide: ContactBookService, useValue: { upsert: vi.fn() } },
          { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
          { provide: DynamicDialogConfig, useValue: { data: { entry: signedEntry } } },
        ],
      }).compileComponents();

      const f = TestBed.createComponent(ContactBookEntryDialogComponent);
      f.detectChanges();
      return f;
    };

    it('呼叫端沒有提供 MessageService 時照樣建得起來，而且有內容', async () => {
      const f = await setupWithoutMessageService();

      // 修前：`createComponent` 直接丟 NG0201，跑不到這裡
      expect(f.nativeElement.textContent).toContain('王小明');
      expect(f.nativeElement.querySelectorAll('button').length).toBeGreaterThan(0);
    });

    /**
     * **只 provide 不夠，還要有人在聽。**
     *
     * `MessageService` 是 toast 的通道，訊息只會出現在**綁同一個實例**的
     * `<p-toast>` 上。這支對話框原本沒有自己的 toast —— admin 端看得到訊息，
     * 是因為**剛好共用了頁面層的實例**，而那一頁的模板第一行有 `<p-toast>`。
     *
     * **老師端整條路上沒有任何 `<p-toast>`**（全 app 的 toast 都在 admin 頁面層，
     * 唯一的例外是 `login-link-dialog` 自己帶一個）。所以只補 provider 的話，
     * NG0201 會消失、對話框會打開，**而「儲存失敗」永遠不會被看見** ——
     * 把一個大聲的錯誤換成一個安靜的。
     *
     * 形狀照 `login-link-dialog`（全站唯一的先例），不另發明。
     */
    it('自己帶 <p-toast> —— 否則訊息會送進沒有人在聽的地方', async () => {
      const f = await setupWithoutMessageService();

      expect(f.nativeElement.querySelector('p-toast')).toBeTruthy();
    });

    /**
     * **反向對照**：admin 那條路（呼叫端有提供 `MessageService`）不能被弄壞。
     * 這一支修前就是綠的 —— 它守的是「修法不要只顧老師端」。
     */
    it('呼叫端有提供 MessageService 時（admin 那條路）照樣正常', async () => {
      const text = await setup(signedEntry);

      expect(text).toContain('王小明');
      expect(fixture.nativeElement.querySelectorAll('button').length).toBeGreaterThan(0);
    });
  });
});
