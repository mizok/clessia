import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  viewChild,
} from '@angular/core';

/**
 * 入口面的流場動畫。canvas 2D 手寫，零依賴。
 *
 * **速度場是某個流函數 ψ 的旋度**（`vx = ∂ψ/∂y`、`vy = −∂ψ/∂x`），所以散度恆為 0，
 * 粒子沿等勢線流動、不會塌進吸子。第一版把 ψ 的值直接當角度用，那種場有吸子，
 * 線會在收斂區擠成一坨 —— 改成 curl 之後那個行為從根上消失，不必偵測匯聚區也不必加斥力。
 *
 * 只放在入口面與標頭（登入、角色選擇、之後的儀表板頭部）。
 * **資料表格後面永遠不放持續動態** —— 那會讓需要工作的畫面一直在動。
 */
@Component({
  selector: 'app-flow-field',
  imports: [],
  template: '<canvas #canvas class="flow-field__canvas" aria-hidden="true"></canvas>',
  styleUrl: './flow-field.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlowFieldComponent {
  /** 粒子密度倍率。面積越大條數越多，這個值只是相對調整 */
  readonly density = input(0.9);
  /** 流速倍率 */
  readonly speed = input(1);

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);

  private ctx: CanvasRenderingContext2D | null = null;
  private raf: number | null = null;
  private particles: Particle[] = [];
  private w = 0;
  private h = 0;
  private t = 0;
  private reduced = false;
  private observer: IntersectionObserver | null = null;
  private sizeObserver: ResizeObserver | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // canvas 要等實際佈局才量得到尺寸，所以掛在 afterNextRender 而不是建構子
    afterNextRender(() => this.setup());

    this.destroyRef.onDestroy(() => {
      this.stop();
      this.observer?.disconnect();
      this.sizeObserver?.disconnect();
      if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
      document.removeEventListener('visibilitychange', this.onVisibility);
    });
  }

  private setup(): void {
    const el = this.canvasRef().nativeElement;
    this.ctx = el.getContext('2d');
    if (!this.ctx) return;

    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.init(0);

    document.addEventListener('visibilitychange', this.onVisibility);

    // 監聽**容器自己**的尺寸，不是只聽 window resize。
    // 這個面的高度取決於內容與字體載入 —— 字體載入完成後容器會變高，
    // 但那不會觸發 window resize，於是 canvas 停在初始尺寸、粒子還擠在
    // 一開始那一小塊裡。正式站看起來「線很稀、擠在角落」就是這個。
    if ('ResizeObserver' in window) {
      this.sizeObserver = new ResizeObserver(() => this.onResize());
      this.sizeObserver.observe(el);
    }

    // 只負責「捲出畫面就停、捲回來再跑」。初次啟動由 init() 負責 ——
    // 交給 observer 的話，第一次回調若在佈局未穩時判定為不可見，就再也不會啟動。
    if (!this.reduced && 'IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) this.start();
            else this.stop();
          }
        },
        { rootMargin: '200px' },
      );
      this.observer.observe(el);
    }
  }

  /**
   * 佈局還沒穩（字體載入中、flex 尚未定高）時 rect 是 0。
   * 直接放棄的話動畫永遠不啟動、而且不會有任何錯誤訊息 —— 重試。
   */
  private init(attempt: number): void {
    if (!this.resize()) {
      if (attempt < 60) requestAnimationFrame(() => this.init(attempt + 1));
      return;
    }

    if (this.reduced) {
      // 靜態版：跑一段再停，留下一張成形的場
      this.warm(320);
      return;
    }

    this.warm(130); // 開場就有線，不是從空白長出來
    this.start();
  }

  private resize(): boolean {
    const el = this.canvasRef().nativeElement;
    const ctx = this.ctx;
    if (!ctx) return false;

    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = rect.width;
    this.h = rect.height;
    el.width = Math.round(this.w * dpr);
    el.height = Math.round(this.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.round(
      Math.min(290, Math.max(52, ((this.w * this.h) / 1150) * this.density())),
    );
    this.particles = Array.from({ length: count }, () => this.spawn());
    ctx.clearRect(0, 0, this.w, this.h);
    return true;
  }

  private spawn(): Particle {
    const x = Math.random() * this.w;
    const y = Math.random() * this.h;
    return { x, y, life: 0, maxLife: 120 + Math.random() * 160, trail: [x, y] };
  }

  /**
   * ψ = A·sin(ax + pt) + B·cos(by − qt) + C·sin(c(x+y) + rt)
   * 速度取它的旋度，導數是解析的、不必數值差分。
   */
  private flowAt(x: number, y: number): { x: number; y: number } {
    const t = this.t;
    const cross = Math.cos(FC_C * (x + y) + FC_R * t) * FC_AMP * FC_C;
    const vx = -FB_AMP * FB_B * Math.sin(FB_B * y - FB_Q * t) + cross;
    const vy = -FA_AMP * FA_A * Math.cos(FA_A * x + FA_P * t) - cross;
    const m = Math.sqrt(vx * vx + vy * vy);
    // 駐點：給一個穩定方向，免得粒子卡在原地抖
    if (m < 1e-6) return { x: 1, y: 0 };
    return { x: vx / m, y: vy / m };
  }

  private drawFrame(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    // 底色由 CSS 負責，canvas 保持透明。每幀重畫整條流線而不是靠半透明殘影
    // 堆疊 —— 殘影版本會把線切成一段一段的碎屑。
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.7;

    const sp = this.speed();
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const v = this.flowAt(p.x, p.y);
      p.x += v.x * 1.28 * sp;
      p.y += v.y * 1.28 * sp;
      p.trail.push(p.x, p.y);
      if (p.trail.length > TRAIL * 2) p.trail.splice(0, 2);
      p.life += 1;

      if (p.life > p.maxLife || p.x < -20 || p.x > this.w + 20 || p.y < -20 || p.y > this.h + 20) {
        this.particles[i] = this.spawn();
        continue;
      }

      if (p.trail.length < 6) continue;

      // 生命頭尾淡入淡出，流線才不會憑空出現又憑空消失
      const fade = Math.min(1, p.life / 26, (p.maxLife - p.life) / 34);
      ctx.strokeStyle = `rgba(255, 255, 255, ${(0.7 * fade).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(p.trail[0], p.trail[1]);
      for (let k = 2; k < p.trail.length; k += 2) ctx.lineTo(p.trail[k], p.trail[k + 1]);
      ctx.stroke();
    }
    this.t += 1;
  }

  /** 先把場跑到穩定狀態再顯示；reduced-motion 的靜態版也走這條 */
  private warm(n: number): void {
    for (let i = 0; i < n; i++) this.drawFrame();
  }

  private start(): void {
    if (this.raf !== null || this.reduced) return;
    const loop = () => {
      this.drawFrame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop(): void {
    if (this.raf === null) return;
    cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  private readonly onResize = (): void => {
    if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => this.resize(), 150);
  };

  private readonly onVisibility = (): void => {
    if (this.reduced) return;
    if (document.hidden) this.stop();
    else this.start();
  };
}

interface Particle {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  trail: number[];
}

/** 一條流線保留幾個點 */
const TRAIL = 34;

// 流函數的三項係數
const FA_AMP = 1.7;
const FA_A = 0.0055;
const FA_P = 0.0038;
const FB_AMP = 1.3;
const FB_B = 0.0075;
const FB_Q = 0.0026;
const FC_AMP = 0.9;
const FC_C = 0.0032;
const FC_R = 0.0015;
