import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextSwapDirective } from './text-swap.directive';

@Component({
  imports: [TextSwapDirective],
  template: `<div>
    <p appTextSwap id="swap-host">
      @if (text(); as t) {
        @if (bold()) {
          <b>{{ t }}</b>
        } @else {
          <span id="swap-inner">{{ t }}</span>
        }
      } @else {
        <span class="skeleton"></span>
      }
    </p>
  </div>`,
})
class HostComponent {
  readonly text = signal<string | null>('學生管理');
  readonly bold = signal(false);
}

/** jsdom 沒有 WAAPI：替身記下誰被 animate、播什麼 */
interface Call {
  el: HTMLElement;
  frames: Keyframe[];
  opts: KeyframeAnimationOptions;
  anim: { cancel: ReturnType<typeof vi.fn>; finished: Promise<void>; finish: () => void };
}

async function setup(opts: { reduce?: boolean; text?: string | null } = {}) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: !!opts.reduce && q.includes('reduce') }));
  const calls: Call[] = [];
  const proto = HTMLElement.prototype as unknown as { animate: unknown };
  proto.animate = function (this: HTMLElement, frames: Keyframe[], o: KeyframeAnimationOptions) {
    let finish!: () => void;
    const finished = new Promise<void>((r) => (finish = r));
    const anim = { cancel: vi.fn(), finished, finish };
    calls.push({ el: this, frames, opts: o, anim });
    return anim;
  };
  const fixture = TestBed.createComponent(HostComponent);
  if (opts.text !== undefined) fixture.componentInstance.text.set(opts.text);
  fixture.detectChanges();
  await fixture.whenStable();
  const host = fixture.nativeElement.querySelector('[appTextSwap]') as HTMLElement;
  const set = async (t: string | null) => {
    fixture.componentInstance.text.set(t);
    fixture.detectChanges();
    await Promise.resolve(); // MutationObserver 的回呼
    await Promise.resolve(); // 合成一次換字的 microtask
  };
  const clones = () =>
    [...(host.parentElement?.children ?? [])].filter((e) => e !== host) as HTMLElement[];
  const embolden = async () => {
    fixture.componentInstance.bold.set(true);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { host, set, calls, clones, embolden };
}

describe('TextSwapDirective（#1895 文字替換）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  it('第一次畫出來的字不播（頁面切換、page-open 重建）', async () => {
    const { calls, clones } = await setup();
    expect(calls).toHaveLength(0);
    expect(clones()).toHaveLength(0);
  });

  it('換字：舊字的複本疊在宿主外面播出場，宿主延後播進場', async () => {
    const { host, set, calls, clones } = await setup();
    await set('41 位學生，今天有 8 位有課。');
    const [clone] = clones();
    expect(clone?.textContent?.trim()).toBe('學生管理');
    expect(clone?.getAttribute('aria-hidden')).toBe('true');
    expect(clone?.inert).toBe(true);
    // 複本不能帶 id：同一頁出現兩個一樣的 id，label／aria 參照會指錯（根節點與子節點都要拿掉）
    expect(clone?.hasAttribute('id')).toBe(false);
    expect(clone?.querySelector('[id]')).toBeNull();
    expect(clone?.style.pointerEvents).toBe('none');
    expect(clone?.style.position).toBe('absolute');
    expect(host.contains(clone!)).toBe(false);

    const exit = calls.find((c) => c.el === clone)!;
    const enter = calls.find((c) => c.el === host)!;
    expect(exit.opts.duration).toBe(120);
    expect(enter.opts.duration).toBe(200);
    expect(enter.opts.delay).toBe(120);
    expect(enter.opts.fill).toBe('backwards');
    expect(exit.frames.at(-1)?.['opacity']).toBe(0);
    expect(enter.frames[0]?.['opacity']).toBe(0);
    // 宿主的字已經是新字（讀屏只念這一次）
    expect(host.textContent?.trim()).toBe('41 位學生，今天有 8 位有課。');
  });

  it('複本用舊字定下來時的小數寬：不是新字的寬、也不取整（兩種都會讓舊字折行，#1983）', async () => {
    // 替身：宿主的寬跟著字走，舊字比新字寬
    const proto = HTMLElement.prototype as unknown as { getBoundingClientRect: () => DOMRect };
    const orig = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function (this: HTMLElement) {
      return { width: this.textContent?.includes('學生管理') ? 114.47 : 60.5 } as DOMRect;
    };
    try {
      const { set, clones } = await setup();
      await set('學生');
      expect(clones()[0]?.style.width).toBe('114.47px');
    } finally {
      proto.getBoundingClientRect = orig;
    }
  });

  it('出場播完，複本拿掉', async () => {
    const { set, calls, clones } = await setup();
    await set('新的一句');
    calls.find((c) => c.el === clones()[0])!.anim.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(clones()).toHaveLength(0);
  });

  it('字串相同（節點換了、字沒變）不播', async () => {
    const { host, calls, embolden } = await setup();
    await embolden();
    expect(host.querySelector('b')).not.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('第一次出現（骨架換成字）只播進場、沒有複本、不延後', async () => {
    const { host, set, calls, clones } = await setup({ text: null });
    await set('今天 8 人要來，已經到了 0 位。');
    expect(clones()).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.el).toBe(host);
    expect(calls[0]!.opts.delay ?? 0).toBe(0);
  });

  it('連續換值：取消前一段、拿掉複本，最新的值直接進場', async () => {
    const { host, set, calls, clones } = await setup();
    await set('第二句');
    const first = [...calls];
    await set('第三句');
    expect(first.every((c) => c.anim.cancel.mock.calls.length > 0)).toBe(true);
    expect(clones()).toHaveLength(0);
    const last = calls.at(-1)!;
    expect(last.el).toBe(host);
    expect(last.opts.delay ?? 0).toBe(0);
    expect(host.textContent?.trim()).toBe('第三句');
  });

  it('動畫進行中不會因為自己插入的複本再觸發一次', async () => {
    const { set, calls } = await setup();
    await set('新的一句');
    const n = calls.length;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(n);
    expect(n).toBe(2);
  });

  it('減少動態：直接換字，不動畫、不留複本', async () => {
    const { host, set, calls, clones } = await setup({ reduce: true });
    await set('新的一句');
    expect(calls).toHaveLength(0);
    expect(clones()).toHaveLength(0);
    expect(host.textContent?.trim()).toBe('新的一句');
  });
});
