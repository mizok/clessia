// 載入一頁（A6 稿或 app）、撐開視窗、抽 part、逐一打開彈出物再抽。
import fs from 'node:fs';
import path from 'node:path';
import { extractSource } from './extract.mjs';
import { A6_DIR, API_URL } from './config.mjs';

// web 的 API 網址寫死 8787（environment.ts）。自己的 API 起在別的 port 時，在瀏覽器層轉送，
// 不必改 repo 檔案、也不碰別席的 8787。
const BUILT_API = 'http://localhost:8787';

// 稿的假資料裡沒有的專有名詞（a6.js 的 ME）
const EXTRA_NAMES = ['林主任'];

/**
 * 殼層是內部捲動（app 的 h-window），fullPage 拍不到也量不到。把視窗高撐到「最高的捲動容器
 * 攤開後」的高度，所有 part 都在一個不捲動的座標系裡。上限 20000px。
 */
async function growViewport(page, width) {
  for (let i = 0; i < 3; i++) {
    const need = await page.evaluate(() => {
      let h = document.scrollingElement.scrollHeight;
      for (const el of document.querySelectorAll('*')) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1)
          h = Math.max(h, innerHeight + el.scrollHeight - el.clientHeight);
      }
      return Math.ceil(h);
    });
    const cur = page.viewportSize().height;
    if (need <= cur) break;
    await page.setViewportSize({ width, height: Math.min(need, 20000) });
    await page.waitForTimeout(300);
  }
  return page.viewportSize().height;
}

/** 稿的互動觸發點：從頁內與 a6.js 等腳本原始碼抓 `[data-*]` 選擇器，再數畫面上有幾個。 */
function hookSelectors(file) {
  const html = fs.readFileSync(path.join(A6_DIR, file), 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => path.join(A6_DIR, m[1]));
  const text = [
    html,
    ...srcs.filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')),
  ].join('\n');
  const sels = new Set();
  for (const m of text.matchAll(/closest\('([^']+)'\)/g))
    for (const s of m[1].split(',')) if (/\[data-[\w-]+\]/.test(s.trim())) sels.add(s.trim());
  return [...sels];
}

export async function capture(browser, { source, file, url, width, storageState, appOpen = {} }) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    storageState,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (source === 'app' && API_URL !== BUILT_API)
    await page.route(BUILT_API + '/**', async (route) =>
      route.fulfill({
        response: await route.fetch({ url: route.request().url().replace(BUILT_API, API_URL) }),
      }),
    );
  await page.goto(url, { waitUntil: source === 'app' ? 'networkidle' : 'load' });
  if (source === 'app' && new URL(page.url()).pathname !== new URL(url).pathname)
    throw new Error(
      `app 被導到 ${page.url()}：登入態失效或 API 沒在跑（${API_URL}）。重跑 login.mjs`,
    );
  await page.waitForTimeout(1200);
  const height = await growViewport(page, width);

  const names =
    source === 'a6'
      ? await page.evaluate((extra) => {
          const out = new Set(extra);
          const seen = new Set();
          const rec = (o, k) => {
            if (o == null || seen.has(o)) return;
            if (typeof o === 'string') {
              if (/^(name|teacher|student)$/.test(k ?? '') && /^[一-鿿]{2,4}$/.test(o)) out.add(o);
              return;
            }
            if (typeof o !== 'object') return;
            seen.add(o);
            for (const [kk, v] of Object.entries(o)) rec(v, Array.isArray(o) ? k : kk);
          };
          rec(window.CLESSIA);
          return [...out].sort((a, b) => b.length - a.length);
        }, EXTRA_NAMES)
      : [];

  const parts = await page.evaluate(extractSource({ names }));
  const shot = await page.screenshot({ fullPage: false });

  // 彈出物：每個不同的 popovertarget 點第一顆可見的開啟鈕
  const targets = await page.evaluate(() => {
    const seen = new Set();
    return [...document.querySelectorAll('[popovertarget]:not([popovertargetaction="hide"])')]
      .filter(
        (b) =>
          b.getClientRects().length &&
          !b.closest('.proto-pill, .proto-all, .proto-notes') && // 設計稿翻頁膠囊，不是頁面
          !seen.has(b.getAttribute('popovertarget')) &&
          seen.add(b.getAttribute('popovertarget')),
      )
      .map((b) => b.getAttribute('popovertarget'));
  });
  const popovers = {};
  for (const id of targets) {
    await page
      .locator(`[popovertarget="${id}"]:not([popovertargetaction="hide"]) >> visible=true`)
      .first()
      .click();
    await page.waitForTimeout(400);
    const open = await page.evaluate(
      (i) => document.getElementById(i)?.matches(':popover-open'),
      id,
    );
    popovers[id] = open
      ? await page.evaluate(extractSource({ names, root: `[id="${id}"]`, prefix: `pop[${id}]` }))
      : null;
    await page.evaluate((i) => document.getElementById(i)?.hidePopover?.(), id).catch(() => {});
  }

  for (const [id, { click, root }] of Object.entries(source === 'app' ? appOpen : {})) {
    await page.locator(click).first().click();
    await page.waitForTimeout(500);
    popovers[id] = (await page.locator(root).count())
      ? await page.evaluate(extractSource({ names, root, prefix: `pop[${id}]` }))
      : null;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  const hooks =
    source === 'a6'
      ? await page.evaluate(
          (sels) => sels.map((s) => [s, document.querySelectorAll(s).length]),
          hookSelectors(file),
        )
      : [];

  await ctx.close();
  return { source, url, width, height, names, parts, popovers, hooks, errors, shot };
}
