import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { vi } from 'vitest';

import { AuthService } from '@core/auth.service';
import { ContactBookService } from '@core/contact-book.service';
import { SystemClockService } from '@core/system-clock.service';

import { ContactBookRosterComponent } from './contact-book-roster.component';

const INPUT = { classId: 'c1', className: '一年級勤班', entryDate: '2026-09-05' };

/** 當天已寫的一則；預設是「我今天寫的、在這班」 */
function written(id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id: `e-${id}`,
    studentId: id,
    studentName: name,
    entryDate: '2026-09-05',
    content: `${name}今天很專心`,
    lastEditedBy: 'me',
    lastEditedByName: '我',
    classNames: ['一年級勤班'],
    ...over,
  };
}

/** 「今天」：名單那天預設就是今天；要驗前幾天的名單就在 render 前改它 */
let today = '2026-09-05';
const PROVIDERS = [
  { provide: AuthService, useValue: { user: () => ({ id: 'me' }) } },
  { provide: SystemClockService, useValue: { todayTaipei: () => today } },
];

function missing(id: string, name: string, classId = 'c1') {
  return {
    studentId: id,
    studentName: name,
    classes: [{ classId, className: '一年級勤班', teacherNames: [], studentCount: 0 }],
  };
}

describe('ContactBookRosterComponent', () => {
  let fixture: ComponentFixture<ContactBookRosterComponent>;
  let component: ContactBookRosterComponent;

  const missingMock = vi.fn();
  const listMock = vi.fn();
  const openMock = vi.fn();

  async function render(students = [missing('s1', '王小明')], entries: unknown[] = []) {
    missingMock.mockReset();
    listMock.mockReset();
    openMock.mockReset();
    missingMock.mockReturnValue(of({ data: students, meta: { total: students.length } }));
    listMock.mockReturnValue(of({ data: entries, meta: { total: entries.length } }));
    openMock.mockReturnValue({ onClose: of(undefined) });

    await TestBed.configureTestingModule({
      imports: [ContactBookRosterComponent],
      providers: [
        { provide: DynamicDialogConfig, useValue: { data: INPUT } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: ContactBookService, useValue: { missing: missingMock, list: listMock } },
        { provide: DialogService, useValue: { open: openMock } },
        ...PROVIDERS,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContactBookRosterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const openRow = (
    s: { studentId: string; studentName: string; entry?: unknown } = missing('s1', '王小明'),
  ) => (component as never as { open(x: unknown): void }).open({ entry: null, ...s });
  const text = () => fixture.nativeElement.textContent as string;
  const rowOf = (name: string) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('li')].find((li) =>
      li.textContent?.includes(name),
    )!;

  // #508：載入中原本是整塊被一行文字取代（沒有骨架尺寸，資料到了會跳版）。
  // 改成骨架列表後這裡改斷言骨架元素，不是文字。
  it('載入中顯示骨架列表，不是整塊被文字取代', async () => {
    missingMock.mockReset();
    listMock.mockReset();
    missingMock.mockReturnValue(NEVER);
    listMock.mockReturnValue(of({ data: [], meta: { total: 0 } }));

    await TestBed.configureTestingModule({
      imports: [ContactBookRosterComponent],
      providers: [
        { provide: DynamicDialogConfig, useValue: { data: INPUT } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: ContactBookService, useValue: { missing: missingMock, list: listMock } },
        { provide: DialogService, useValue: { open: openMock } },
        ...PROVIDERS,
      ],
    }).compileComponents();

    const f = TestBed.createComponent(ContactBookRosterComponent);
    f.detectChanges();

    expect(f.nativeElement.querySelector('.skeleton-list')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.skeleton-list .skeleton').length).toBeGreaterThan(0);
  });

  it('共用殼：h2 是班名、日期＋聯絡簿在內容區第一行（#2396）；✕ 關掉面板（#2290）', async () => {
    await render();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('h2')!.textContent?.trim()).toBe(INPUT.className);
    expect(host.querySelector('[data-part="dialog-context"]')!.textContent).toContain('聯絡簿');
    host.querySelector<HTMLButtonElement>('button[aria-label="關閉"]')!.click();
    expect(TestBed.inject(DynamicDialogRef).close).toHaveBeenCalledWith(false);
  });

  it('只列這一堂課的班，別班的缺漏不混進來', async () => {
    await render([missing('s1', '王小明'), missing('s2', '別班的', 'other-class')]);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('王小明');
    expect(text).not.toContain('別班的');
  });

  /**
   * **這一條守的是「靜靜吃掉別人寫的東西」。**
   *
   * `/missing` 已經排除寫過的人，所以名單載入那一刻是準的 —— **但它會過期**：
   * 甲老師在名單載入之後才寫，這份清單仍然顯示那位學生。
   *
   * 若直接用 `draft` 開，對話框是**空白的**：老師看不到甲寫了什麼，
   * 存檔就蓋掉（`PUT` 是 upsert），而且兩邊都不會知道。
   *
   * 所以開之前一定要再查一次，有既有的就用 `entry` 開 ——
   * 對話框會預載內容**並顯示「最後由 X 編輯」**。
   */
  it('開之前先查那位學生當天有沒有已經被寫過', async () => {
    await render();
    openRow();

    expect(listMock).toHaveBeenCalledWith({
      studentId: 's1',
      from: '2026-09-05',
      to: '2026-09-05',
    });
  });

  it('查到既有的 → 用 entry 開（會預載並顯示作者），不是空白的 draft', async () => {
    await render();
    // 我自己在別的裝置上剛寫的：照樣用 entry 開（別人寫的改不了，見下面 #2499 那組）
    const existing = written('s1', '王小明');
    listMock.mockReturnValue(of({ data: [existing], meta: { total: 1 } }));
    openRow();

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openMock.mock.calls[0][1].data).toEqual({ entry: existing });
  });

  it('確實沒有既有的 → 才用 draft 開', async () => {
    await render();
    openRow();

    expect(openMock.mock.calls[0][1].data).toEqual({
      draft: { studentId: 's1', studentName: '王小明', entryDate: '2026-09-05' },
    });
  });

  describe('已寫的也列出來（#2499）', () => {
    it('寫完那一列留著，變成已寫、看得到內容（不再從名單消失）', async () => {
      await render([missing('s1', '王小明'), missing('s2', '李小華')]);
      openMock.mockReturnValue({ onClose: of(written('s1', '王小明')) });
      openRow();
      fixture.detectChanges();

      expect(text()).toContain('王小明今天很專心');
      expect(rowOf('王小明').textContent).toContain('修改');
      expect(rowOf('李小華').textContent).toContain('撰寫');
    });

    it('當天已寫、在這班的列出來（內容摘要）；別班的不混進來', async () => {
      await render(
        [missing('s1', '王小明')],
        [written('s2', '李小華'), written('s3', '別班的', { classNames: ['二年級班'] })],
      );
      expect(text()).toContain('李小華今天很專心');
      expect(text()).not.toContain('別班的');
    });

    it('自己今天寫的才有「修改」；別人寫的寫明是誰、不給改', async () => {
      await render(
        [],
        [
          written('s2', '李小華'),
          written('s3', '陳大文', { lastEditedBy: 'other', lastEditedByName: '甲老師' }),
        ],
      );
      expect(rowOf('李小華').textContent).toContain('修改');
      expect(rowOf('陳大文').textContent).not.toContain('修改');
      expect(rowOf('陳大文').textContent).toContain('甲老師');
    });

    it('前幾天的名單（課堂那天不是今天）：自己寫的也不給改', async () => {
      today = '2026-09-06';
      await render([], [written('s2', '李小華')]);
      expect(rowOf('李小華').textContent).not.toContain('修改');
      today = '2026-09-05';
    });

    it('按「修改」直接用那則開（已經有內容，不用再查一次）', async () => {
      await render([], [written('s2', '李小華')]);
      openRow({ studentId: 's2', studentName: '李小華', entry: written('s2', '李小華') });
      expect(listMock).toHaveBeenCalledTimes(1); // 只有載入那一次
      expect(openMock.mock.calls[0][1].data).toEqual({ entry: written('s2', '李小華') });
    });

    it('撰寫前查到別人剛寫好的：不開對話框（改不了），那列變成已寫、寫明是誰', async () => {
      await render();
      listMock.mockReturnValue(
        of({
          data: [written('s1', '王小明', { lastEditedBy: 'other', lastEditedByName: '甲老師' })],
          meta: { total: 1 },
        }),
      );
      openRow();
      fixture.detectChanges();

      expect(openMock).not.toHaveBeenCalled();
      expect(rowOf('王小明').textContent).toContain('甲老師');
      expect(rowOf('王小明').textContent).not.toContain('撰寫');
    });
  });

  // 全寫完不是錯誤，要說得出來
  it('沒有缺漏時說「都寫完了」而不是空白', async () => {
    await render([]);
    expect(fixture.nativeElement.textContent).toContain('都寫完了');
  });

  it('查詢失敗不開對話框，並說出錯誤', async () => {
    await render();
    listMock.mockReturnValue(throwError(() => new Error('boom')));
    openRow();
    fixture.detectChanges();

    expect(openMock).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('讀取失敗');
  });
});
