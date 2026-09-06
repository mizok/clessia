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
});
