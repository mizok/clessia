// 逐幀跳動量測（#1859）：用實際畫出來的畫面量「版面有沒有跳」。
//
//   node tools/a6-conformance/jump.mjs <頁…> [--widths 1440,390] [--out file.json]
//
// <頁> 是 lib/config.mjs 的 PAGES 名稱（students、dashboard…），或直接給路徑（/admin/sessions）。
// 每頁每寬：
//   1. 注入一段 CSS，替頁面的主要區塊（`main.shell-content > * > :nth-child(k)`）各加一條向內的純色 outline
//      （不佔版面），第 k 塊用 MARK_COLORS[k]
//   2. CDP screencast 從導覽開始錄到 networkidle＋1.5 秒，每一幀 PNG
//   3. 每一幀找各標記色的最上緣＝那一塊**實際畫出來**的頂端；相鄰兩幀的差＝那一幀跳了多少
// 輸出每頁的「單幀最大跳動 px」與有變化的幀的時間軸。設計理由見 README「逐幀跳動」。
import fs from 'node:fs';
import { chromium } from 'playwright';

import { API_URL, APP_URL, PAGES, STATE } from './lib/config.mjs';
import { MARK_COLORS, changes, maxJumps } from './lib/jump.mjs';

const BUILT_API = 'http://localhost:8787';
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const widths = opt('widths', '1440,390').split(',').map(Number);
const outFile = opt('out', null);
// 要追的區塊：預設是頁面的頂層區塊；`--sel 'a;b;c'` 直接指定（最多 MARK_COLORS 個），例如區塊內部的列表
const sels = opt('sel', null)?.split(';').filter(Boolean);
const targets = args.length ? args : Object.keys(PAGES);

const MARK_CSS = MARK_COLORS.map(([r, g, b], k) => {
  const sel = sels ? sels[k] : `main.shell-content > * > :nth-child(${k + 1})`;
  return sel
    ? `${sel} { outline: 2px solid rgb(${r} ${g} ${b}) !important; outline-offset: -2px !important; }`
    : '';
}).join('\n');

const browser = await chromium.launch();
// outline 的頂邊是一整條橫線，水平每 8px 取樣就抓得到；全幅逐像素掃在 1440 寬太慢
// 解 PNG 用的頁（瀏覽器的 canvas，不另裝影像套件）
const decoder = await (await browser.newContext()).newPage();

/** 一幀 PNG → 各標記色的最上緣 y（沒有就 null） */
async function topsOf(pngBase64) {
  return decoder.evaluate(
    async ({ b64, colors }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      const tops = colors.map(() => null);
      let left = colors.length;
      for (let y = 0; y < img.height && left; y++) {
        for (let x = 0; x < img.width; x += 8) {
          const i = (y * img.width + x) * 4;
          for (let k = 0; k < colors.length; k++) {
            if (tops[k] !== null) continue;
            const [r, gg, bb] = colors[k];
            if (
              Math.abs(d[i] - r) < 8 &&
              Math.abs(d[i + 1] - gg) < 8 &&
              Math.abs(d[i + 2] - bb) < 8
            ) {
              tops[k] = y;
              left--;
            }
          }
        }
      }
      return tops;
    },
    { b64: pngBase64, colors: MARK_COLORS },
  );
}

async function measure(name, width) {
  const page = PAGES[name];
  const url = page?.app ?? name;
  const ctx = await browser.newContext({
    // 高一點，主要區塊都在畫面內（screencast 只錄可視範圍）
    viewport: { width, height: 2400 },
    storageState: page?.state ?? STATE,
    reducedMotion: 'no-preference',
  });
  if (API_URL !== BUILT_API)
    await ctx.route(BUILT_API + '/**', async (route) => {
      const target = route.request().url().replace(BUILT_API, API_URL);
      for (let i = 0; i < 6; i++) {
        try {
          return await route.fulfill({ response: await route.fetch({ url: target }) });
        } catch {
          await new Promise((r) => setTimeout(r, 1500)); // wrangler 在負載下會崩、自動重啟
        }
      }
      await route.abort().catch(() => {});
    });
  await ctx.addInitScript((css) => {
    const add = () => {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.append(s);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  }, MARK_CSS);
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  const raw = [];
  cdp.on('Page.screencastFrame', async (f) => {
    raw.push({ t: f.metadata.timestamp, data: f.data });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await p.goto(APP_URL + url, { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForTimeout(1500);
  await cdp.send('Page.stopScreencast');
  await ctx.close();
  const t0 = raw[0]?.t ?? 0;
  const frames = [];
  for (const f of raw)
    frames.push({ t: Math.round((f.t - t0) * 1000), tops: await topsOf(f.data) });
  return {
    name,
    url,
    width,
    frameCount: frames.length,
    ...maxJumps(frames),
    timeline: changes(frames),
  };
}

const results = [];
for (const name of targets)
  for (const w of widths) {
    const r = await measure(name, w);
    // 一個標記都沒在畫面上出現 = 選擇器沒對到這頁的結構，不是「沒跳」：印成沒量到，改用 --sel 指定
    const seen = r.timeline.some((f) => f.tops.some((y) => y !== null));
    console.log(
      seen
        ? `${name} ${w}: 單幀最大跳動 ${r.maxJump}px（第 ${r.block === null ? '-' : r.block + 1} 塊，${r.at ?? '-'}ms）；${r.frameCount} 幀`
        : `${name} ${w}: 沒量到（畫面上沒有任何標記，用 --sel 指定區塊）；${r.frameCount} 幀`,
    );
    r.measured = seen;
    results.push(r);
  }
await browser.close();
if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
