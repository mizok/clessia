import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { vi } from 'vitest';

import { ContactBookService } from '@core/contact-book.service';

import { ContactBookRosterComponent } from './contact-book-roster.component';

const INPUT = { classId: 'c1', className: '一年級勤班', entryDate: '2026-09-05' };

function missing(id: string, name: string, classId = 'c1') {
  return { studentId: id, studentName: name, classes: [{ classId, className: '一年級勤班' }] };
}

describe('ContactBookRosterComponent', () => {
  let fixture: ComponentFixture<ContactBookRosterComponent>;
  let component: ContactBookRosterComponent;

  const missingMock = vi.fn();
  const listMock = vi.fn();
  const openMock = vi.fn();

  async function render(students = [missing('s1', '王小明')]) {
    missingMock.mockReset();
    listMock.mockReset();
    openMock.mockReset();
    missingMock.mockReturnValue(of({ data: students, meta: { total: students.length } }));
    listMock.mockReturnValue(of({ data: [], meta: { total: 0 } }));
    openMock.mockReturnValue({ onClose: of(undefined) });

    await TestBed.configureTestingModule({
      imports: [ContactBookRosterComponent],
      providers: [
        { provide: DynamicDialogConfig, useValue: { data: INPUT } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: ContactBookService, useValue: { missing: missingMock, list: listMock } },
        { provide: DialogService, useValue: { open: openMock } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContactBookRosterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const openRow = (s = missing('s1', '王小明')) =>
    (component as never as { open(x: unknown): void }).open(s);

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
      ],
    }).compileComponents();

    const f = TestBed.createComponent(ContactBookRosterComponent);
    f.detectChanges();

    expect(f.nativeElement.querySelector('.skeleton-list')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.skeleton-bar').length).toBeGreaterThan(0);
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
    const existing = {
      id: 'e1',
      studentId: 's1',
      content: '甲老師寫的',
      lastEditedByName: '甲老師',
    };
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

  it('寫完那一列就從清單消失', async () => {
    await render([missing('s1', '王小明'), missing('s2', '李小華')]);
    openMock.mockReturnValue({ onClose: of(true) });
    openRow();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('王小明');
    expect(text).toContain('李小華');
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
