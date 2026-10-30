// 載入一頁（A6 稿或 app）、撐開視窗、抽 part、逐一打開彈出物再抽。
import fs from 'node:fs';
import path from 'node:path';
import { extractSource } from './extract.mjs';
import { A6_DIR, API_URL } from './config.mjs';
import { step } from './behave.mjs';

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
  const html = fs.readFileSync(path.join(A6_DIR, file.split('#')[0]), 'utf8'); // 稿檔可帶 #分頁
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

/** 開一個 context＋頁面並載入；app 端轉送 API、被導離目標路由就報錯。 */
export async function openPage(
  browser,
  { source, url, width, height = 900, storageState, prep = [], clock },
) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    storageState,
    reducedMotion: 'reduce',
  });
  if (source === 'app' && API_URL !== BUILT_API)
    await ctx.route(BUILT_API + '/**', async (route) =>
      route.fulfill({
        response: await route.fetch({ url: route.request().url().replace(BUILT_API, API_URL) }),
      }),
    );
  // app 的「今天」對齊稿的（config 的 `clock`）：稿把日期寫死（例：課表 stress.js 的 2026-10-01 17:40），
  // app 照真實日期，週檢視就差成「今天」換了一欄、底色互換 —— 那是日期不是設計。
  // app 有兩個時鐘，兩個都要對齊：SystemClockService 認 /api/system-time（後註冊的 route 先比對），
  // 課表頁這類直接 `new Date()` 的認瀏覽器時鐘（setFixedTime 只固定 Date，timer 照跑）
  if (source === 'app' && clock) {
    const epochMs = Date.parse(clock);
    await ctx.clock.setFixedTime(epochMs);
    await ctx.route('**/api/system-time', (route) =>
      route.fulfill({ json: { epochMs, iso: new Date(epochMs).toISOString() } }),
    );
  }
  // 稿的審稿膠囊不是頁面：一插進來就拿掉（proto.js 插的時間不定，等固定秒數不可靠），
  // 連帶 a6.css 的 `body:has(.proto-pill)` 稿專用樣式也失效（公開頁品牌面多 72px padding-bottom，#1639）
  if (source === 'a6')
    await ctx.addInitScript(() => {
      const drop = () =>
        document.querySelectorAll('.proto-pill, .proto-all').forEach((e) => e.remove());
      new MutationObserver(drop).observe(document, { childList: true, subtree: true });
    });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: source === 'app' ? 'networkidle' : 'load' });
  if (source === 'app' && new URL(page.url()).pathname !== new URL(url).pathname)
    throw new Error(
      `app 被導到 ${page.url()}：登入態失效或 API 沒在跑（${API_URL}）。重跑 login.mjs`,
    );
  await page.waitForTimeout(1200);
  // 量之前先操作（config 的 `prep`）：切到週視圖、改一格分數讓儲存列出現。`widths` 限定只在某些寬度做
  for (const st of prep) if (!st.widths || st.widths.includes(width)) await step(page, st);
  return { ctx, page, errors };
}

/**
 * 要樣板化的專有名詞：人名（稿＝window.CLESSIA 的假人名；app＝登入者，家長再加上孩子，#1932）→ {名}，
 * 分校名 → {分校}。
 */
export async function harvestNames(page, source, ctx) {
  if (source === 'app') {
    const get = (u) =>
      ctx.request
        .get(API_URL + u)
        .then((r) => r.json())
        .catch(() => null);
    // 孩子：家長頁色面的「目前看的是 X」、標題句都是孩子名字；不是家長時這支回錯 → null
    const [me, campuses, children] = await Promise.all([
      get('/api/me'),
      get('/api/campuses'),
      get('/api/me/children'),
    ]);
    // 「全部分校」是「沒選單一分校」的使用者狀態，跟稿選了「文山旗艦校」一樣算資料
    return [
      me?.displayName,
      ...(children?.data ?? []).map((c) => c.name),
      ...['全部分校', ...(campuses?.data ?? []).map((c) => c.name)].map((n) => [n, '{分校}']),
    ].filter(Boolean);
  }
  return page.evaluate((extra) => {
    const out = new Set(extra);
    const seen = new Set();
    const rec = (o, k) => {
      if (o == null || seen.has(o)) return;
      if (typeof o === 'string') {
        if (/^(name|teacher|student)$/.test(k ?? '') && /^[\u4e00-\u9fff]{2,4}$/.test(o))
          out.add(o);
        return;
      }
      if (typeof o !== 'object') return;
      seen.add(o);
      for (const [kk, v] of Object.entries(o)) rec(v, Array.isArray(o) ? k : kk);
    };
    rec(window.CLESSIA);
    const campuses = (window.CLESSIA?.campuses ?? []).map((n) => [n, '{分校}']);
    return [...campuses, ...out].sort((a, b) => [].concat(b)[0].length - [].concat(a)[0].length);
  }, EXTRA_NAMES);
}

/**
 * 打開一個彈出物，回傳它的根選擇器（沒打開＝null；開啟鈕這一寬不存在＝undefined）。
 * 原生 `[popovertarget]` 直接點；不是的（app 的 PrimeNG、稿用 JS showPopover 的）照 config 的 `opens`
 * 指定點哪顆（陣列＝依序點）、根在哪。開啟鈕只在某些寬度出現（例如稿的手機登入面板）時，這一寬就當沒有。
 */
export async function openPop(page, id, opens = {}) {
  if (opens[id]) {
    const { click, root } = opens[id];
    // click 可以是陣列：依序點（app 的「新增考試」先開選單、再選「補習班考試」；分校 ⋮ 再點「教室」）。
    // 第一顆不在這一寬 = 這一寬沒有（undefined）；後面那顆找不到 = 開了選單卻沒有那一項，記成缺（null）
    for (const [i, sel] of [].concat(click).entries()) {
      const btn = page.locator(`${sel} >> visible=true`).first();
      if (!(await btn.count())) return i === 0 ? undefined : null;
      await btn.click();
      await page.waitForTimeout(400);
    }
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
    return (await page.locator(root).count()) ? root : null;
  }
  const btn = page
    .locator(`[popovertarget="${id}"]:not([popovertargetaction="hide"]) >> visible=true`)
    .first();
  if (!(await btn.count())) return undefined;
  await btn.click();
  // 點完把滑鼠移開：從底部升起的面板會把裡面的鈕放到游標底下，量到的是 hover 樣式（#1639 LINE 鍵）
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const open = await page.evaluate((i) => document.getElementById(i)?.matches(':popover-open'), id);
  return open ? `[id="${id}"]` : null;
}

export async function closePop(page, id, opens = {}) {
  if (opens[id]) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // PrimeNG 動態彈窗不一定吃 Escape；沒關掉的話遮罩會擋住後面每一次點擊 —— 點根裡的取消／關閉
    const { root } = opens[id];
    if (await page.locator(`${root} >> visible=true`).count()) {
      const x = page
        .locator(root)
        .locator('button:has-text("取消"), [aria-label="關閉"], [aria-label="Close"]')
        .filter({ visible: true })
        .first();
      if (await x.count()) await x.click();
      await page.waitForTimeout(400);
    }
  } else
    await page.evaluate((i) => document.getElementById(i)?.hidePopover?.(), id).catch(() => {});
}

export async function capture(
  browser,
  { source, file, url, width, storageState, opens = {}, rowParents = [], rowSel, prep, clock },
) {
  const { ctx, page, errors } = await openPage(browser, {
    source,
    url,
    width,
    storageState,
    prep,
    clock,
  });
  const height = await growViewport(page, width);
  const names = await harvestNames(page, source, ctx);

  const parts = await page.evaluate(extractSource({ names, rowParents, rowSel }));
  const shot = await page.screenshot({ fullPage: false });

  // 彈出物：每個不同的 popovertarget 點第一顆可見的開啟鈕
  const targets = await page.evaluate(() => {
    const seen = new Set();
    return [...document.querySelectorAll('[popovertarget]:not([popovertargetaction="hide"])')]
      .filter(
        (b) =>
          b.getClientRects().length &&
          !b.disabled && // 停用的開不了（例：沒有餐費紀錄時的「匯出」），點下去只會等到逾時
          !b.closest('.proto-pill, .proto-all, .proto-notes') && // 設計稿翻頁膠囊，不是頁面
          !seen.has(b.getAttribute('popovertarget')) &&
          seen.add(b.getAttribute('popovertarget')),
      )
      .map((b) => b.getAttribute('popovertarget'));
  });
  const popovers = {};
  const popShots = {}; // 浮層開著時的截圖（多出功能盤點要裁圖）
  for (const id of [...targets, ...Object.keys(opens)]) {
    const root = await openPop(page, id, opens);
    if (root === undefined) continue; // 開啟鈕這一寬沒有
    popovers[id] = root
      ? await page.evaluate(
          extractSource({ names, rowParents, rowSel, root, prefix: `pop[${id}]` }),
        )
      : null;
    if (root) popShots[id] = await page.screenshot();
    await closePop(page, id, opens);
  }

  const hooks =
    source === 'a6'
      ? await page.evaluate(
          (sels) => sels.map((s) => [s, document.querySelectorAll(s).length]),
          hookSelectors(file),
        )
      : [];

  await ctx.close();
  return { source, url, width, height, names, parts, popovers, hooks, errors, shot, popShots };
}
