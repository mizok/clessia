import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * 開站畫面（index.html 的 `.app-splash`，Angular 啟動前）的守門。
 * viewport 單位由 harness c6 掃 index.html 守，這裡守其他不變量。
 */
const html = readFileSync(resolve(process.cwd(), 'apps/web/src/index.html'), 'utf8');
const styles = readFileSync(resolve(process.cwd(), 'apps/web/src/styles.css'), 'utf8');

const style = /<style id="app-splash-style">([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
const markup =
  /<div class="app-splash"[\s\S]*?<\/svg>[\s\S]*?<\/div>\s*(?=<\/body>)/.exec(html)?.[0] ?? '';

describe('index.html 開站畫面', () => {
  it('樣式與標記都抓得到（下面的檢查才有意義）', () => {
    expect(style).toContain('.app-splash');
    expect(markup).toContain('role="status"');
  });

  it('放在 <app-root> 外面：Angular 第一次 render 不會把它整個換掉', () => {
    const appRoot = /\n\s*<app-root>([\s\S]*?)<\/app-root>/.exec(html)![1];
    expect(appRoot).not.toContain('app-splash');
    expect(html.indexOf('<div class="app-splash"')).toBeGreaterThan(html.indexOf('</app-root>'));
  });

  it('不得有外部資源：它要在任何下載完成之前就畫得出來', () => {
    for (const src of [style, markup]) {
      expect(src).not.toMatch(/url\(|@import|@font-face/);
      expect(src).not.toMatch(/\ssrc=/);
    }
    // 唯一允許的 href 是同一份 SVG 裡的 <use href="#…">
    expect(markup.match(/href="[^"]*"/g)?.every((h) => h.startsWith('href="#'))).toBe(true);
    expect(markup).not.toMatch(/<(script|img|link|image|iframe)\b/);
  });

  it('底色用 body 的 --zinc-100，fallback 跟 styles.css 的值一致（inlineCritical 下 token 可能還沒到）', () => {
    const token = /^\s*--zinc-100:\s*(#[0-9a-f]{6})/im.exec(styles)![1];
    const bg = /background-color:\s*var\(--zinc-100,\s*(#[0-9a-f]{6})\)/i.exec(style)?.[1];
    expect(bg?.toLowerCase()).toBe(token.toLowerCase());
  });

  it('color-scheme 固定 light：app 沒有深色模式，跟系統變深會在接手時黑→白一閃', () => {
    expect(style).toMatch(/\.app-splash\s*\{[^}]*color-scheme:\s*light/);
    expect(style).not.toContain('prefers-color-scheme');
  });

  it('減少動態：亮線不畫、改說「載入中…」', () => {
    const rm = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n {6}\}/.exec(style)?.[1];
    expect(rm).toMatch(/\.app-splash__flow\s*\{\s*display:\s*none/);
    expect(rm).toMatch(/\.app-splash__rm\s*\{[^}]*display:\s*block/);
    expect(markup).toContain('載入中…');
  });

  it('gzip 後 4KB 內（index.html 每次載入都要下載）', () => {
    expect(gzipSync(style + markup, { level: 9 }).length).toBeLessThanOrEqual(4096);
  });

  /** 退場條件：第一個路由元件掛到 router-outlet 後面。app-toast 也是 outlet 的兄弟，不能算 */
  it('退場選擇器：只有路由元件掛上才成立，<app-toast> 不算', () => {
    const selector = /\n\s*(body:has\([^{]+\))\s*\.app-splash\s*\{/.exec(style)![1];
    document.body.innerHTML =
      '<app-root><div><router-outlet></router-outlet><app-toast></app-toast></div></app-root>';
    expect(document.querySelector(selector)).toBeNull();

    document.querySelector('router-outlet')!.after(document.createElement('app-dashboard'));
    expect(document.querySelector(selector)).not.toBeNull();
    document.body.innerHTML = '';
  });
});
