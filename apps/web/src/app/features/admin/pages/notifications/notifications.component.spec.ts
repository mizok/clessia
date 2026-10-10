import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AnnouncementsService, type Announcement } from '@core/announcements.service';
import { CampusesService } from '@core/campuses.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

import { NotificationsComponent } from './notifications.component';

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 'a1',
    title: '本週三停課',
    body: '因颱風假停課一天。',
    audience: 'all_teachers',
    campusId: null,
    campusName: null,
    publishedAt: '2026-08-18T02:00:00Z',
    createdByName: '王主任',
    isRead: false,
    ...overrides,
  };
}

describe('NotificationsComponent（管理端發布）', () => {
  let fixture: ComponentFixture<NotificationsComponent>;
  let component: NotificationsComponent;

  const listMock = vi.fn();
  const createMock = vi.fn();
  const campusesMock = vi.fn();

  async function setup(data: Announcement[] = []) {
    listMock.mockReset();
    createMock.mockReset();
    campusesMock.mockReset();
    listMock.mockReturnValue(of({ data, meta: { total: data.length, unread: 0 } }));
    createMock.mockReturnValue(of({ data: announcement() }));
    campusesMock.mockReturnValue(of({ data: [{ id: 'c1', name: '本校' }] }));

    await TestBed.configureTestingModule({
      imports: [NotificationsComponent],
      providers: [
        {
          provide: AnnouncementsService,
          useValue: { list: listMock, create: createMock },
        },
        { provide: CampusesService, useValue: { list: campusesMock } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', RoutesCatalog.ADMIN_NOTIFICATIONS);
    fixture.detectChanges();
  }

  // #508：載入中原本是整塊被一行文字取代（沒有骨架尺寸，資料到了會跳版）。
  // 改成骨架列表後這裡改斷言骨架元素，不是文字。
  it('已發布清單載入中顯示骨架列表，不是整塊被文字取代', async () => {
    listMock.mockReset();
    createMock.mockReset();
    campusesMock.mockReset();
    listMock.mockReturnValue(NEVER);
    createMock.mockReturnValue(of({ data: announcement() }));
    campusesMock.mockReturnValue(of({ data: [{ id: 'c1', name: '本校' }] }));

    await TestBed.configureTestingModule({
      imports: [NotificationsComponent],
      providers: [
        { provide: AnnouncementsService, useValue: { list: listMock, create: createMock } },
        { provide: CampusesService, useValue: { list: campusesMock } },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(NotificationsComponent);
    f.componentRef.setInput('page', RoutesCatalog.ADMIN_NOTIFICATIONS);
    f.detectChanges();

    expect(f.nativeElement.querySelector('.skeleton-list')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.skeleton-bar').length).toBeGreaterThan(0);
  });

  /**
   * #723（照 #664／#718 的方向）：**按鈕不再擋，按下去才驗、逐欄標錯。**
   *
   * 原本是 `[disabled]="!canSubmit()"` —— 沒填時按下去**什麼都不會發生**，
   * 沒有欄位標記也沒有解釋。現在按得下去，而**送不出去的理由看得見**。
   */
  it('標題或內容空白時按發布不會送出，而且兩個欄位同時標錯', async () => {
    await setup();
    createMock.mockClear();

    component['submit']();

    expect(createMock).not.toHaveBeenCalled();
    // **一次收集全部**，不是遇到第一個就 return
    expect(component['errors']()).toEqual({ title: '標題還沒填', body: '內容還沒填' });
  });

  it('只有空白字元也算空白', async () => {
    await setup();
    createMock.mockClear();
    component['title'].set('   ');
    component['body'].set('   ');

    component['submit']();

    expect(createMock).not.toHaveBeenCalled();
    expect(Object.keys(component['errors']())).toEqual(['title', 'body']);
  });

  it('發布鍵只在送出中才 disabled —— 沒填也按得下去', async () => {
    await setup();

    const btn = fixture.nativeElement.querySelector('.admin-notifications__composer button');
    expect(btn.disabled).toBe(false);
  });

  it('錯誤訊息顯示在欄位旁邊，不是只有 toast', async () => {
    await setup();

    component['submit']();
    fixture.detectChanges();

    const texts = [...fixture.nativeElement.querySelectorAll('.admin-notifications__error-text')]
      .map((e) => (e as HTMLElement).textContent?.trim())
      .filter(Boolean);
    expect(texts).toEqual(['標題還沒填', '內容還沒填']);
    expect(
      fixture.nativeElement.querySelector('.admin-notifications__input.p-invalid'),
    ).not.toBeNull();
  });

  /** 錯誤是「上次送出時的狀態」，不是永久標籤 */
  it('改動欄位就清掉那一欄的錯誤，另一欄留著', async () => {
    await setup();
    component['submit']();
    expect(Object.keys(component['errors']())).toEqual(['title', 'body']);

    component['onTitleChange']('停課通知');

    expect(component['errors']()).toEqual({ body: '內容還沒填' });
  });

  it('送出時去掉前後空白並帶上分校', async () => {
    await setup();
    component['title'].set('  停課通知  ');
    component['body'].set('  內容  ');
    component['campusId'].set('c1');

    component['submit']();

    expect(createMock).toHaveBeenCalledWith({
      title: '停課通知',
      body: '內容',
      audience: 'all_teachers',
      campusId: 'c1',
    });
  });

  /**
   * #636:這個下拉原本鎖成常數,理由是「家長端全是空殼,發給家長沒人收得到」。
   * **那個理由在 2026-09-04 就不成立了**(PR #291 把家長端通知中心接上了),
   * 而註解沒有被回頭檢查 —— 五天後可用性測試才撞出來。
   *
   * 這三支守的是解鎖之後的三件事:**預設沒變**、**選得到家長**、**選了會送出去**。
   */
  it('預設仍然是全體老師 —— 解鎖不等於改預設', async () => {
    await setup();

    expect(component['audience']()).toBe('all_teachers');
  });

  it('發送對象選得到家長', async () => {
    await setup();

    expect(component['audienceOptions'].map((o) => o.value)).toEqual([
      'all_teachers',
      'all_parents',
    ]);
  });

  it('選了家長之後送出去的是 all_parents', async () => {
    await setup();
    component['title'].set('停課通知');
    component['body'].set('內容');
    component['audience'].set('all_parents');

    component['submit']();

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ audience: 'all_parents' }));
  });

  it('發布成功後清空表單並重新載入清單', async () => {
    await setup();
    component['title'].set('停課通知');
    component['body'].set('內容');
    listMock.mockClear();

    component['submit']();

    expect(component['title']()).toBe('');
    expect(component['body']()).toBe('');
    expect(listMock).toHaveBeenCalled();
  });

  it('發布失敗時保留輸入內容並顯示錯誤', async () => {
    await setup();
    createMock.mockReturnValue(throwError(() => new Error('boom')));
    component['title'].set('停課通知');
    component['body'].set('內容');

    component['submit']();

    expect(component['submitError']()).toContain('發布失敗');
    expect(component['title']()).toBe('停課通知');
  });

  it('列出已發布的公告', async () => {
    await setup([announcement({ campusName: '本校' })]);

    expect(fixture.nativeElement.textContent).toContain('本週三停課');
    expect(fixture.nativeElement.textContent).toContain('全體老師');
  });

  /**
   * 發布時間用 `yyyy-MM-dd`，不是 `yyyy/MM/dd`（#425 M4）。**年份留著**是情境選擇 ——
   * 這是「發布過的全部公告」，會跨年；老師端收件匣（`announcement-inbox`）看的是最近
   * 收到的，所以那邊用短版 `MM/dd HH:mm`。**但分隔符沒有情境理由**，全站其餘每一個
   * 完整日期都是連字號。
   */
  it('發布時間用連字號而不是斜線', async () => {
    await setup([announcement({ campusName: '本校' })]);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('2026-08-18');
    expect(text).not.toMatch(/\d{4}\/\d{2}\/\d{2}/);
  });

  it('沒有分校的公告顯示為全部分校', async () => {
    await setup([announcement({ campusName: null })]);

    expect(fixture.nativeElement.textContent).toContain('全部分校');
  });

  describe('A6 版（#1314 NT3）', () => {
    const q = (id: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(
        `[data-testid="${id}"]`,
      ) as HTMLElement | null;
    const qa = (id: string) => [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        `[data-testid="${id}"]`,
      ),
    ];

    it('已發布依月份分章，新到舊；章頭有月份與則數', async () => {
      await setup([
        announcement({ id: 'a', publishedAt: '2026-08-18T02:00:00Z' }),
        announcement({ id: 'b', publishedAt: '2026-10-02T02:00:00Z' }),
        announcement({ id: 'c', publishedAt: '2026-10-01T02:00:00Z' }),
      ]);

      const chapters = component['chapters']();
      expect(chapters.map((g) => g.key)).toEqual(['2026-10', '2026-08']);
      expect(chapters[0].items.map((i) => i.id)).toEqual(['b', 'c']);
      expect(qa('chapter')).toHaveLength(2);
      expect(qa('chapter')[0].textContent).toContain('2 則');
    });

    it('月份用台北時區切：UTC 月底晚上＝台北下個月初', async () => {
      await setup([announcement({ publishedAt: '2026-09-30T17:30:00Z' })]);

      expect(component['chapters']()[0].key).toBe('2026-10');
      // 顯示的時間也是台北：2026-10-01 01:30
      expect(q('meta')!.textContent).toContain('2026-10-01 01:30');
    });

    it('跨年的章名帶年份', async () => {
      await setup([announcement({ publishedAt: '2019-12-05T02:00:00Z' })]);

      expect(component['chapters']()[0].name).toBe('2019 年 12 月');
    });

    it('色面句：已發布幾則、上一則是哪天；沒有公告時照實說', async () => {
      await setup([
        announcement({ id: 'a', publishedAt: '2026-08-18T02:00:00Z' }),
        announcement({ id: 'b', publishedAt: '2026-10-02T02:00:00Z' }),
      ]);
      expect(component['headline']()).toBe('已發布 2 則公告，上一則是 10/2。');

      TestBed.resetTestingModule();
      await setup([]);
      expect(component['headline']()).toBe('還沒有發布過公告。');
    });

    it('載入中色面不宣稱「還沒有發布過公告」', async () => {
      listMock.mockReset();
      listMock.mockReturnValue(NEVER);
      createMock.mockReset();
      campusesMock.mockReset();
      campusesMock.mockReturnValue(of({ data: [] }));
      await TestBed.configureTestingModule({
        imports: [NotificationsComponent],
        providers: [
          { provide: AnnouncementsService, useValue: { list: listMock, create: createMock } },
          { provide: CampusesService, useValue: { list: campusesMock } },
        ],
      }).compileComponents();
      const f = TestBed.createComponent(NotificationsComponent);
      f.componentRef.setInput('page', RoutesCatalog.ADMIN_NOTIFICATIONS);
      f.detectChanges();

      expect(f.componentInstance['headline']()).toBeNull();
      expect(f.nativeElement.textContent).not.toContain('還沒有發布過公告');
    });

    it('列：標題、時間·分校、對象 pill；沒有舊的副標', async () => {
      await setup([announcement({ campusName: '本校', audience: 'all_parents' })]);

      expect(q('announcement')!.textContent).toContain('本週三停課');
      expect(q('audience')!.textContent).toContain('全體家長');
      expect(q('meta')!.textContent).toContain('本校');
      expect(fixture.nativeElement.textContent).not.toContain('發布站內公告給老師或家長');
    });

    it('按發布：空標題與內容 → 焦點到標題；只缺內容 → 焦點到內容', async () => {
      await setup();

      component['submit']();
      expect(document.activeElement).toBe(fixture.nativeElement.querySelector('input[type=text]'));

      component['title'].set('停課通知');
      component['submit']();
      expect(document.activeElement).toBe(fixture.nativeElement.querySelector('textarea'));
    });

    it('發布成功跳 toast：寫出對象與分校', async () => {
      await setup();
      const spy = vi.spyOn(component['messageService'], 'add');
      component['title'].set('停課通知');
      component['body'].set('內容');
      component['audience'].set('all_parents');
      component['campusId'].set('c1');

      component['submit']();

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success', detail: '已發布給全體家長（本校）' }),
      );
    });

    it('發布失敗不跳成功 toast', async () => {
      await setup();
      const spy = vi.spyOn(component['messageService'], 'add');
      createMock.mockReturnValue(throwError(() => new Error('boom')));
      component['title'].set('停課通知');
      component['body'].set('內容');

      component['submit']();

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
