import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FlowFieldComponent } from './flow-field.component';

/**
 * 這支 spec 存在的理由：**resize 這條路徑之前一個測試都沒有**，
 * 而它已經出過一次事（#101：靜態場 resize 之後永遠空白，因為 `resize()` 清了畫布
 * 但沒有 rAF 會把它補回來）。當時修了卻沒留防線 —— 現在補上。
 *
 * canvas 在測試環境裡拿不到真的 2D context，所以整支用替身：
 * 我們不驗「畫得好不好看」，只驗**有沒有畫**與**淡出淡入的次序**。
 */

interface StubContext {
  strokeCount: number;
  clearCount: number;
}

class ResizeObserverStub {
  static last: ResizeObserverStub | null = null;
  constructor(private readonly cb: () => void) {
    ResizeObserverStub.last = this;
  }
  observe(): void {}
  disconnect(): void {}
  fire(): void {
    this.cb();
  }
}

/** 跟元件裡的 RESIZE_DEBOUNCE / FADE_MS 對齊 */
const DEBOUNCE_MS = 240;
const FADE_MS = 1000;
/** 剛好跨過某個時點就好，不要剛好等於它 */
const JUST_AFTER = 20;

describe('FlowFieldComponent', () => {
  let fixture: ComponentFixture<FlowFieldComponent>;
  let stub: StubContext;
  let canvas: HTMLCanvasElement;

  const setup = async (opts: { frozen?: boolean; reduced?: boolean } = {}) => {
    stub = { strokeCount: 0, clearCount: 0 };

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: () => void stub.clearCount++,
      setTransform: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => void stub.strokeCount++,
      lineCap: '',
      lineJoin: '',
      lineWidth: 0,
      strokeStyle: '',
    } as unknown as CanvasRenderingContext2D);

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 200,
    } as DOMRect);

    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: opts.reduced === true && q.includes('reduced-motion'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    await TestBed.configureTestingModule({ imports: [FlowFieldComponent] }).compileComponents();
    fixture = TestBed.createComponent(FlowFieldComponent);
    fixture.componentRef.setInput('frozen', opts.frozen ?? false);
    await fixture.whenStable();
    canvas = fixture.nativeElement.querySelector('canvas');

    // 元件已經初始化完，現在才換成假時鐘 —— 反過來的話 whenStable() 會等不到而卡死。
    // resize 的 debounce / 淡出 timer 都是在 fire() 之後才建立的，所以照樣攔得到。
    vi.useFakeTimers();
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    ResizeObserverStub.last = null;
  });

  // ── #101 的防線 ───────────────────────────────────────────────────────────
  it('凍結模式 resize 之後會重畫，不留白（#101 的回歸防線）', async () => {
    await setup({ frozen: true });
    const before = stub.strokeCount;

    ResizeObserverStub.last!.fire();
    vi.advanceTimersByTime(DEBOUNCE_MS + FADE_MS + JUST_AFTER);

    expect(stub.strokeCount).toBeGreaterThan(before);
  });

  // ── 使用者回報的「突變」 ──────────────────────────────────────────────────
  it('凍結模式 resize 先淡出、重算完再淡入', async () => {
    await setup({ frozen: true });

    ResizeObserverStub.last!.fire();
    vi.advanceTimersByTime(DEBOUNCE_MS + JUST_AFTER); // 淡出開始

    expect(canvas.style.opacity).toBe('0');

    // 淡出還在進行中（一秒是使用者指定的長度）—— 這時候不該有任何動靜
    vi.advanceTimersByTime(FADE_MS / 2);

    expect(canvas.style.opacity).toBe('0');

    vi.advanceTimersByTime(FADE_MS / 2 + JUST_AFTER); // 淡出走完

    expect(canvas.style.opacity).toBe('1');
  });

  it('重算發生在淡出之後，不是淡出之前', async () => {
    await setup({ frozen: true });
    const before = stub.strokeCount;

    ResizeObserverStub.last!.fire();
    vi.advanceTimersByTime(DEBOUNCE_MS + FADE_MS - JUST_AFTER); // 淡出差一點走完

    // 舊圖還在淡出的整段期間都不該重畫 —— 不然使用者會在畫面淡掉之前
    // 就看到新圖冒出來，那正是要修掉的「突變」
    expect(stub.strokeCount).toBe(before);

    vi.advanceTimersByTime(JUST_AFTER * 2); // 淡出走完的那一刻

    expect(stub.strokeCount).toBeGreaterThan(before);
  });

  // ── 動態模式不受這套影響 ──────────────────────────────────────────────────
  it('動態模式不碰 opacity —— rAF 本來就每幀重畫', async () => {
    await setup({ frozen: false });

    ResizeObserverStub.last!.fire();
    vi.advanceTimersByTime(DEBOUNCE_MS + FADE_MS + JUST_AFTER);

    expect(canvas.style.opacity).toBe('');
  });

  // ── reduced-motion：淡入淡出本身也是動態 ─────────────────────────────────
  it('reduced-motion 直接重算，不做淡入淡出', async () => {
    await setup({ reduced: true });
    const before = stub.strokeCount;

    ResizeObserverStub.last!.fire();
    vi.advanceTimersByTime(DEBOUNCE_MS + JUST_AFTER); // 只過 debounce，還沒到淡出的長度

    expect(canvas.style.opacity).toBe(''); // 沒有被設過
    expect(stub.strokeCount).toBeGreaterThan(before); // 但已經重算了 —— 不等淡出
  });
});
