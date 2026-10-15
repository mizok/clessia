import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { ToastComponent } from './toast.component';

/**
 * #1615：全站唯一的 toast 出口（A6 kit.html／a6.css:674-689）。
 * 灰底一種面、圖示換色（使用者裁 1）；標題一行、內文一行（裁 2）；錯誤 6 秒、其餘照 A6（裁 3）。
 */
describe('ToastComponent（#1615）', () => {
  let fixture: ComponentFixture<ToastComponent>;
  let messages: MessageService;
  const el = () => fixture.nativeElement as HTMLElement;
  const toasts = () => [...el().querySelectorAll<HTMLElement>('.toast')];

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [MessageService] });
    messages = TestBed.inject(MessageService);
    fixture = TestBed.createComponent(ToastComponent);
    fixture.detectChanges();
  });

  afterEach(() => vi.useRealTimers());

  function add(m: Parameters<MessageService['add']>[0]) {
    messages.add(m);
    fixture.detectChanges();
  }

  it('標題一行、內文一行；只有標題就只有一行', () => {
    add({ severity: 'success', summary: '已儲存', detail: '出勤模式已更新' });
    add({ severity: 'success', summary: '已刪除' });
    const [both, only] = toasts();
    expect(both.querySelector('.toast__title')?.textContent?.trim()).toBe('已儲存');
    expect(both.querySelector('.toast__detail')?.textContent?.trim()).toBe('出勤模式已更新');
    expect(only.querySelector('.toast__title')?.textContent?.trim()).toBe('已刪除');
    expect(only.querySelector('.toast__detail')).toBeNull();
  });

  it('只有內文：內文當標題那一行', () => {
    add({ severity: 'info', detail: '已複製' });
    expect(toasts()[0].querySelector('.toast__title')?.textContent?.trim()).toBe('已複製');
  });

  it.each([
    ['success', 'success'],
    ['error', 'error'],
    ['danger', 'error'],
    ['warn', 'warn'],
    ['warning', 'warn'],
    ['info', 'info'],
    [undefined, 'info'],
  ])('severity %s → 同一個灰面，圖示是 toast__icon--%s', (severity, kind) => {
    add({ severity, summary: 'x' });
    const t = toasts()[0];
    expect(t.classList).toContain('toast');
    expect(t.querySelector(`.toast__icon--${kind}`)).not.toBeNull();
  });

  it('同時最多 3 則，新的在下面、最舊的先走', () => {
    for (const n of [1, 2, 3, 4]) add({ severity: 'success', summary: `第${n}則` });
    expect(toasts().map((t) => t.querySelector('.toast__title')?.textContent?.trim())).toEqual([
      '第2則',
      '第3則',
      '第4則',
    ]);
  });

  it('時間：成功 4 秒、錯誤 6 秒、有給 life 就照 life', () => {
    add({ severity: 'success', summary: '成功' });
    add({ severity: 'error', summary: '錯誤' });
    add({ severity: 'warn', summary: '自訂', life: 8000 });
    const titles = () =>
      toasts()
        .filter((t) => !t.classList.contains('toast--leaving'))
        .map((t) => t.querySelector('.toast__title')?.textContent?.trim());

    vi.advanceTimersByTime(4000);
    fixture.detectChanges();
    expect(titles()).toEqual(['錯誤', '自訂']);
    vi.advanceTimersByTime(2000);
    fixture.detectChanges();
    expect(titles()).toEqual(['自訂']);
    vi.advanceTimersByTime(2000);
    fixture.detectChanges();
    expect(titles()).toEqual([]);
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    expect(toasts()).toHaveLength(0); // 出場動畫跑完才拿掉節點
  });

  it('滑過時暫停倒數，離開後接著算剩下的', () => {
    add({ severity: 'success', summary: '成功' });
    vi.advanceTimersByTime(3000);
    toasts()[0].dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(10000);
    fixture.detectChanges();
    expect(toasts()[0].classList).not.toContain('toast--leaving');
    toasts()[0].dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(toasts()[0].classList).toContain('toast--leaving');
  });

  it('sticky：不會自己消失，給一顆「關閉」', () => {
    add({ severity: 'error', summary: '名單沒有確認', sticky: true });
    vi.advanceTimersByTime(60000);
    fixture.detectChanges();
    const close = toasts()[0].querySelector<HTMLButtonElement>('.toast__action');
    expect(close?.textContent?.trim()).toBe('關閉');
    close!.click();
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    expect(toasts()).toHaveLength(0);
  });

  it('有 undo 的給「復原」，按了執行並跳「已復原」；停 6 秒', () => {
    const undo = vi.fn();
    add({ severity: 'success', summary: '已提醒', data: { undo } });
    expect(toasts()[0].querySelector('.toast__action')?.textContent?.trim()).toBe('復原');
    vi.advanceTimersByTime(5000);
    fixture.detectChanges();
    expect(toasts()[0].classList).not.toContain('toast--leaving');

    toasts()[0].querySelector<HTMLButtonElement>('.toast__action')!.click();
    fixture.detectChanges();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(toasts().at(-1)?.querySelector('.toast__title')?.textContent?.trim()).toBe('已復原');
  });

  it('clear() 收掉全部', () => {
    add({ severity: 'success', summary: 'a' });
    add({ severity: 'success', summary: 'b' });
    messages.clear();
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    expect(toasts()).toHaveLength(0);
  });

  it('addAll 一次多則', () => {
    messages.addAll([
      { severity: 'success', summary: 'a' },
      { severity: 'error', summary: 'b' },
    ]);
    fixture.detectChanges();
    expect(toasts()).toHaveLength(2);
  });

  it('外框是 role=status 的 live region', () => {
    expect(el().getAttribute('role')).toBe('status');
    expect(el().getAttribute('aria-live')).toBe('polite');
  });

  // A6 a6.js:298：手機底部有動作列時浮在它上面 12px
  it('頁面有底部動作列（data-toast-dock）：浮在它上面 12px；沒有就離底 16px', () => {
    add({ severity: 'success', summary: 'a' });
    expect(el().style.bottom).toBe('16px');

    const dock = document.createElement('div');
    dock.setAttribute('data-toast-dock', '');
    document.body.append(dock);
    vi.spyOn(dock, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    vi.spyOn(dock, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight - 64,
    } as DOMRect);
    add({ severity: 'success', summary: 'b' });
    expect(el().style.bottom).toBe('76px');
    dock.remove();
  });
});
