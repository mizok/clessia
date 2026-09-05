import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { vi } from 'vitest';

import { ClassLogsService, type ClassLog } from '@core/class-logs.service';

import { ClassLogSheetComponent, type ClassLogSheetInput } from './class-log-sheet.component';

const INPUT: ClassLogSheetInput = {
  classId: 'c1',
  className: '數學班 A',
  logDate: '2026-09-05',
};

function log(overrides: Partial<ClassLog> = {}): ClassLog {
  return {
    id: 'l1',
    classId: 'c1',
    className: '數學班 A',
    logDate: '2026-09-05',
    teachingRecord: '第三章 配方法',
    homework: '習作 p.42-45',
    lastEditedByName: '王老師',
    publishedAt: null,
    ...overrides,
  };
}

describe('ClassLogSheetComponent', () => {
  let fixture: ComponentFixture<ClassLogSheetComponent>;
  let component: ClassLogSheetComponent;

  const listMock = vi.fn();
  const upsertMock = vi.fn();
  const publishMock = vi.fn();
  const closeMock = vi.fn();

  async function render(existing: ClassLog[] = []) {
    listMock.mockReset();
    upsertMock.mockReset();
    publishMock.mockReset();
    closeMock.mockReset();
    listMock.mockReturnValue(of({ data: existing, meta: { total: existing.length } }));
    upsertMock.mockReturnValue(of({ data: log() }));
    publishMock.mockReturnValue(of({ data: log() }));

    await TestBed.configureTestingModule({
      imports: [ClassLogSheetComponent],
      providers: [
        { provide: DynamicDialogConfig, useValue: { data: INPUT } },
        { provide: DynamicDialogRef, useValue: { close: closeMock } },
        { provide: ClassLogsService, useValue: { list: listMock, upsert: upsertMock, publish: publishMock } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClassLogSheetComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function read<T>(key: string): T {
    return (component as never as Record<string, () => T>)[key]();
  }

  /**
   * **這條是這一刀的資料遺失防線。**
   *
   * 同一班同一天可能有兩場課（`sessions` 的唯一鍵含 `start_time`，`class_logs` 不含），
   * 兩張課堂卡會開到同一篇日誌。而 `PUT` 是 upsert ——
   * 第二場的老師若看到空白表單，存檔就直接蓋掉第一場寫的東西。
   *
   * 預載讓語意從「空白新寫」變成「編輯既有」，覆蓋因此**結構上不可能**，
   * 而不是靠老師讀到警語之後自己小心。
   */
  it('開啟時把既有日誌的內容載進兩個欄位', async () => {
    await render([log()]);

    expect(read<string>('teachingRecord')).toBe('第三章 配方法');
    expect(read<string>('homework')).toBe('習作 p.42-45');
  });

  it('只查這一班這一天', async () => {
    await render();

    expect(listMock).toHaveBeenCalledWith({
      classId: 'c1',
      from: '2026-09-05',
      to: '2026-09-05',
    });
  });

  it('本來就有日誌 → 明說是在編輯', async () => {
    await render([log()]);
    expect(fixture.nativeElement.textContent).toContain('本日已有日誌');
  });

  it('本來沒有 → 不出現那句，也不預填任何東西', async () => {
    await render();

    expect(fixture.nativeElement.textContent).not.toContain('本日已有日誌');
    expect(read<string>('teachingRecord')).toBe('');
  });

  /**
   * **這條是從 v1a 的「沒有發布按鈕」改寫來的，不是刪掉。**
   *
   * 它守的東西沒變：**按鈕不存在，不是 disabled** —— 灰著的按鈕仍然在承諾功能存在。
   * 只是條件從「永遠不放」變成「沒有東西可發的時候不放」。
   */
  it('還沒存過（沒有既有日誌）→ 不出現發布按鈕，也不是灰的', async () => {
    await render();
    expect(fixture.nativeElement.textContent).not.toContain('發布');
  });

  it('有既有日誌但兩欄都空 → 不出現發布（發一篇空的對家長是純雜訊）', async () => {
    await render([log({ teachingRecord: null, homework: null })]);
    expect(fixture.nativeElement.textContent).not.toContain('發布');
  });

  it('有內容且未發布 → 出現發布', async () => {
    await render([log()]);
    expect(fixture.nativeElement.textContent).toContain('發布');
  });

  it('已發布 → 不再出現發布按鈕，改說家長看得到什麼', async () => {
    await render([log({ publishedAt: '2026-09-05T01:00:00Z' })]);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('家長看得到');
    expect(read<boolean>('canPublish')).toBe(false);
  });

  /**
   * **確認文案只能說現在為真的事。**
   *
   * 規則把 LINE 推播寫成 `published_at` 的效果之一，但那排在 P4 ——
   * 全 repo 至今沒有任何 LINE Messaging 實作。文案寫「會推播給家長」
   * 就是承諾一件不會發生的事，而那正是 v1a 不放這顆按鈕的同一個理由。
   */
  it('確認文案講家長看得到與不可逆，不提 LINE 推播', async () => {
    await render([log()]);
    (component as never as { askPublish(): void }).askPublish();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('家長就會看到');
    expect(text).toContain('收不回');
    expect(text).not.toContain('LINE');
  });

  /**
   * **先存再發。** 老師可能改了字才按發布 —— 不先存的話發出去的是編輯前的版本，
   * 而畫面上看到的是編輯後的：兩者不一致，而且沒有人會發現。
   */
  it('發布前先把當下的內容存下去', async () => {
    await render([log()]);
    (component as never as { homework: { set(v: string): void } }).homework.set('改過的作業');
    (component as never as { askPublish(): void }).askPublish();
    (component as never as { confirmPublish(): void }).confirmPublish();

    expect(upsertMock).toHaveBeenCalledWith({
      classId: 'c1',
      logDate: '2026-09-05',
      teachingRecord: '第三章 配方法',
      homework: '改過的作業',
    });
    expect(publishMock).toHaveBeenCalledWith('l1');
  });

  it('發布失敗不關面板，並說出來', async () => {
    await render([log()]);
    publishMock.mockReturnValue(throwError(() => new Error('boom')));
    (component as never as { askPublish(): void }).askPublish();
    (component as never as { confirmPublish(): void }).confirmPublish();
    fixture.detectChanges();

    expect(closeMock).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('發布失敗');
  });

  // 寫錯欄位的代價是內部溝通外洩，而那是寫入當下就決定的後果
  it('兩個欄位都標示可見性', async () => {
    await render();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('家長看不到');
    expect(text).toContain('家長會看到');
  });

  it('存檔用 upsert，帶上班級與日期', async () => {
    await render();
    (component as never as { teachingRecord: { set(v: string): void } }).teachingRecord.set('今天講了三角函數');
    (component as never as { save(): void }).save();

    expect(upsertMock).toHaveBeenCalledWith({
      classId: 'c1',
      logDate: '2026-09-05',
      teachingRecord: '今天講了三角函數',
      homework: '',
    });
  });

  it('成功後關閉面板並回報有存過', async () => {
    await render();
    (component as never as { homework: { set(v: string): void } }).homework.set('p.10');
    (component as never as { save(): void }).save();

    expect(closeMock).toHaveBeenCalledWith(true);
  });

  // 兩欄都空、而且本來也沒有日誌 —— 沒有東西可存，不要建一筆空的
  it('全空且本來沒有日誌 → 存檔停用', async () => {
    await render();
    expect(read<boolean>('nothingToSave')).toBe(true);
  });

  /**
   * **這條是突變測試逼出來的。**
   *
   * 原本只測了 `nothingToSave()` 這個 computed 的值 —— 而把 `save()` 裡那道
   * `|| this.nothingToSave()` 拿掉之後測試照樣全綠：**computed 對，不代表有人在用它**。
   * 按鈕的 `[disabled]` 也擋不住程式化呼叫。
   */
  it('沒東西可存時，就算真的呼叫 save() 也不送請求', async () => {
    await render();
    (component as never as { save(): void }).save();

    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('本來就有日誌時，即使清空兩欄也還能存（那是刪內容，不是沒事做）', async () => {
    await render([log()]);
    (component as never as { teachingRecord: { set(v: string): void } }).teachingRecord.set('');
    (component as never as { homework: { set(v: string): void } }).homework.set('');

    expect(read<boolean>('nothingToSave')).toBe(false);
  });

  it('存檔失敗不關面板，並把錯誤說出來', async () => {
    await render();
    upsertMock.mockReturnValue(throwError(() => new Error('boom')));
    (component as never as { homework: { set(v: string): void } }).homework.set('p.10');
    (component as never as { save(): void }).save();
    fixture.detectChanges();

    expect(closeMock).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('存檔失敗');
  });

  /**
   * 讀取失敗時**不能讓人若無其事地存檔** —— 表單是空的，
   * 但庫裡可能有內容，存下去就是覆蓋。
   */
  it('讀取失敗時警告存檔會覆蓋既有內容', async () => {
    listMock.mockReturnValue(throwError(() => new Error('boom')));
    await TestBed.configureTestingModule({
      imports: [ClassLogSheetComponent],
      providers: [
        { provide: DynamicDialogConfig, useValue: { data: INPUT } },
        { provide: DynamicDialogRef, useValue: { close: closeMock } },
        { provide: ClassLogsService, useValue: { list: listMock, upsert: upsertMock, publish: publishMock } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(ClassLogSheetComponent);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();

    expect(f.nativeElement.textContent).toContain('會覆蓋');
  });
});
