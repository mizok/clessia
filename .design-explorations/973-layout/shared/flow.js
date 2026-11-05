/*
 * apps/web/src/app/shared/components/flow-field 的靜態移植（同一個流函數、同一組係數），
 * 讓設計稿裡的線條跟入口頁是「同一片場」而不是長得像的仿作。
 *
 * ClessiaFlow.mount(canvasEl, {
 *   density: 0.9,        // 同元件 input
 *   speed: 1,            // 同元件 input
 *   frozen: false,       // 同元件 input：跑完暖機就停（內頁橘帶用的模式）
 *   ink: '255,255,255',  // 線色 rgb 三元組。入口頁是白線；白面上可以換成橘
 *   alpha: 0.7,          // 線的最高不透明度（元件是 0.7）
 *   lineWidth: 1.7,
 *   phase: 0,            // 時間相位，讓不同面的場不要長成同一張
 * })
 * prefers-reduced-motion 時一律凍結（同元件）。
 */
(function () {
  const FA_AMP = 1.7, FA_A = 0.0055, FA_P = 0.0038;
  const FB_AMP = 1.3, FB_B = 0.0075, FB_Q = 0.0026;
  const FC_AMP = 0.9, FC_C = 0.0032, FC_R = 0.0015;
  const TRAIL = 34, STATIC_WARM = 320;

  function mount(canvas, opts) {
    const o = Object.assign({ density: 0.9, speed: 1, frozen: false, ink: '255,255,255', alpha: 0.7, lineWidth: 1.7, phase: 0, max: 290, trail: TRAIL, amp: 1 }, opts || {});
    const ctx = canvas.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isStatic = reduced || o.frozen;
    let w = 0, h = 0, t = o.phase, particles = [], raf = null;

    const spawn = () => {
      const x = Math.random() * w, y = Math.random() * h;
      return { x, y, life: 0, maxLife: 120 + Math.random() * 160, trail: [x, y] };
    };
    const flowAt = (x0, y0) => {
      const x = x0 / o.amp, y = y0 / o.amp;
      const cross = Math.cos(FC_C * (x + y) + FC_R * t) * FC_AMP * FC_C;
      const vx = -FB_AMP * FB_B * Math.sin(FB_B * y - FB_Q * t) + cross;
      const vy = -FA_AMP * FA_A * Math.cos(FA_A * x + FA_P * t) - cross;
      const m = Math.hypot(vx, vy);
      return m < 1e-6 ? { x: 1, y: 0 } : { x: vx / m, y: vy / m };
    };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(o.max, Math.max(52, ((w * h) / 1150) * o.density)));
      particles = Array.from({ length: count }, spawn);
      ctx.clearRect(0, 0, w, h);
      return true;
    };
    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = o.lineWidth;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const v = flowAt(p.x, p.y);
        p.x += v.x * 1.28 * o.speed; p.y += v.y * 1.28 * o.speed;
        p.trail.push(p.x, p.y);
        if (p.trail.length > o.trail * 2) p.trail.splice(0, 2);
        p.life++;
        if (p.life > p.maxLife || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) { particles[i] = spawn(); continue; }
        if (p.trail.length < 6) continue;
        const fade = Math.min(1, p.life / 26, (p.maxLife - p.life) / 34);
        ctx.strokeStyle = `rgba(${o.ink}, ${(o.alpha * fade).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(p.trail[0], p.trail[1]);
        for (let k = 2; k < p.trail.length; k += 2) ctx.lineTo(p.trail[k], p.trail[k + 1]);
        ctx.stroke();
      }
      t++;
    };
    const loop = () => { frame(); raf = requestAnimationFrame(loop); };
    let held = false; // pause() 期間，IntersectionObserver／visibilitychange 不要把它重新開起來
    const start = () => { if (raf === null && !isStatic && !held) raf = requestAnimationFrame(loop); };
    const stop = () => { if (raf !== null) cancelAnimationFrame(raf); raf = null; };

    const init = (attempt) => {
      if (!resize()) { if (attempt < 60) requestAnimationFrame(() => init(attempt + 1)); return; }
      if (isStatic) { for (let i = 0; i < STATIC_WARM; i++) frame(); return; }
      for (let i = 0; i < 130; i++) frame();
      start();
    };
    init(0);

    let timer = null;
    new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (resize() && isStatic) for (let i = 0; i < STATIC_WARM; i++) frame(); }, 240);
    }).observe(canvas);
    if (!isStatic) {
      new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? start() : stop())), { rootMargin: '200px' }).observe(canvas);
      document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    }
    return { pause() { held = true; stop(); }, resume() { held = false; start(); } };
  }

  // 標記式掛載：<canvas data-flow='{"frozen":true}'>
  function auto() {
    document.querySelectorAll('canvas[data-flow]').forEach((c) => mount(c, JSON.parse(c.dataset.flow || '{}')));
  }
  window.ClessiaFlow = { mount, auto };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
  else auto();
})();
