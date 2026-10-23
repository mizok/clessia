import { TestBed } from '@angular/core/testing';
import { CampusContextService } from '@core/campus-context.service';
import type { Session } from '@core/sessions.service';
import { ScheduleListComponent } from './schedule-list.component';

describe('ScheduleListComponent —— 手機長按（#1174 G3）', () => {
  const s = {
    id: 's1',
    className: '數學A',
    sessionDate: '2026-10-07',
    startTime: '17:00',
    endTime: '18:00',
    teacherName: '林',
    status: 'scheduled',
    campusName: '總校',
  } as Session;

  function setup(opts: { picking?: boolean; selected?: boolean; compact?: boolean } = {}) {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(ScheduleListComponent);
    fixture.componentRef.setInput('groups', [{ start: '17:00', sessions: [s] }]);
    fixture.componentRef.setInput('now', new Date(2026, 9, 7, 9));
    fixture.componentRef.setInput('picking', !!opts.picking);
    fixture.componentRef.setInput('compact', !!opts.compact);
    if (opts.selected) fixture.componentRef.setInput('selectedIds', new Set([s.id]));
    fixture.detectChanges();
    const long = vi.fn();
    const menu = vi.fn();
    fixture.componentInstance.longPress.subscribe(long);
    fixture.componentInstance.menu.subscribe(menu);
    const main = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[aria-label$="看看能做什麼"]',
    )!;
    const press = (pointerType: string) =>
      main.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerType }));
    const el = fixture.nativeElement as HTMLElement;
    return { main, press, long, menu, el };
  }

  afterEach(() => vi.useRealTimers());

  it('手指按住 500ms：勾起這堂；放開後那一下 click 不開選單', () => {
    const { main, press, long, menu } = setup();
    press('touch');
    vi.advanceTimersByTime(500);
    expect(long).toHaveBeenCalledWith('s1');
    main.click();
    expect(menu).not.toHaveBeenCalled();
    main.click(); // 下一次普通點按照常開選單
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it('按不到 500ms 就放開、或捲動（pointercancel）：照常是點一下', () => {
    const { main, press, long, menu } = setup();
    press('touch');
    vi.advanceTimersByTime(300);
    main.dispatchEvent(new Event('pointercancel'));
    vi.advanceTimersByTime(500);
    expect(long).not.toHaveBeenCalled();
    main.click();
    expect(menu).toHaveBeenCalledTimes(1);
  });

  // #1620：手機的勾選欄是 hidden，display:none 不佔 grid 格子 —— 三欄的話 ⋯ 會落進中間那欄、
  // 貼在班名旁邊。手機要兩欄（內容撐滿、⋯ 貼右緣，A6 x≈322），桌機才三欄
  it('手機兩欄、桌機三欄：⋯ 貼卡片右緣', () => {
    const { main } = setup({ picking: true });
    const row = main.parentElement!;
    expect(row.classList.contains('grid-cols-[minmax(0,1fr)_auto]')).toBe(true);
    expect(row.classList.contains('wide:grid-cols-[auto_minmax(0,1fr)_auto]')).toBe(true);
  });

  // #1923：A6 schedule.css:50–51 —— 不在快速選取模式時沒有勾選框（已勾的那堂例外，看得到自己的勾）
  describe('勾選框只在快速選取或已勾時出現（#1923）', () => {
    const pickCell = (el: HTMLElement) =>
      el.querySelector('input[type="checkbox"]')!.closest('label')!;
    it('平常：桌機也兩欄、勾選框不出現', () => {
      const { main, el } = setup();
      expect(
        main.parentElement!.classList.contains('wide:grid-cols-[auto_minmax(0,1fr)_auto]'),
      ).toBe(false);
      expect(pickCell(el).classList.contains('wide:grid')).toBe(false);
    });
    it('快速選取模式：勾選框出現', () => {
      expect(pickCell(setup({ picking: true }).el).classList.contains('wide:grid')).toBe(true);
    });
    it('不在快速選取、但這堂已勾：勾選框照樣出現', () => {
      expect(pickCell(setup({ selected: true }).el).classList.contains('wide:grid')).toBe(true);
    });
  });

  it('週視圖窄欄（compact）也有 ⋯（A6 `.wc .li__more`），按了發 menu', () => {
    const { el, menu } = setup({ compact: true });
    const more = el.querySelector<HTMLButtonElement>('button[aria-label="數學A 的操作"]')!;
    expect(more).not.toBeNull();
    more.click();
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it('開始時間分組不是 landmark（A6 `.lg` 是 div）', () => {
    const { el } = setup();
    expect(el.querySelector('section')).toBeNull();
  });

  // #1786：舊寫法 `pressed && $event.preventDefault()` 在沒長按時值是 false，Angular 照樣擋掉
  it('沒長按時右鍵選單照常出（不 preventDefault）；長按中才擋', () => {
    const { main, press } = setup();
    const ctx = () => {
      const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      main.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(ctx()).toBe(false);

    press('touch');
    vi.advanceTimersByTime(500);
    expect(ctx()).toBe(true);
  });

  it('滑鼠沒有長按', () => {
    const { press, long } = setup();
    press('mouse');
    vi.advanceTimersByTime(1000);
    expect(long).not.toHaveBeenCalled();
  });
});

describe('ScheduleListComponent —— 分校名只在看全部分校時寫', () => {
  const s = {
    id: 's1',
    className: '數學A',
    sessionDate: '2026-10-07',
    startTime: '17:00',
    endTime: '18:00',
    teacherName: '林',
    status: 'scheduled',
    campusName: '總校',
  } as Session;

  const render = (campusId: string | null) => {
    TestBed.configureTestingModule({
      providers: [{ provide: CampusContextService, useValue: { id: () => campusId } }],
    });
    const fixture = TestBed.createComponent(ScheduleListComponent);
    fixture.componentRef.setInput('groups', [{ start: '17:00', sessions: [s] }]);
    fixture.componentRef.setInput('now', new Date(2026, 9, 7, 9));
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  };

  it('全部分校：列上寫分校名', () => expect(render(null)).toContain('總校'));
  it('頂欄選了某分校：不重複寫', () => expect(render('c1')).not.toContain('總校'));
});
