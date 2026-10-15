// A6 conformance（#1314）
//   node tools/a6-conformance/run.mjs inventory [頁…]   第一層：A6 → part 清單（JSON＋Markdown）
//   node tools/a6-conformance/run.mjs diff <頁>          第二層：app vs A6 幾何與樣式差異表
// 環境變數見 lib/config.mjs（A6_DIR、A6_APP_URL、A6_STATE、A6_OUT）。輸出在 A6_OUT/<頁>/。
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  A6_DIR,
  APP_URL,
  DATA_DEPENDENT,
  DEVIATIONS,
  OUT,
  PAGES,
  SHELL_POPOVERS,
  STATE,
  WIDTHS,
} from './lib/config.mjs';
import { capture } from './lib/capture.mjs';
import { inventoryMarkdown } from './lib/report.mjs';
import { classify, diffParts, diffMarkdown } from './lib/diff.mjs';

const [cmd, ...args] = process.argv.slice(2);
const pages = args.length ? args : Object.keys(PAGES);
const browser = await chromium.launch();

const save = (dir, name, cap) => {
  const { shot, ...rest } = cap;
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(rest, null, 1));
  fs.writeFileSync(path.join(dir, `${name}.png`), shot);
};

async function grab(page, source, w) {
  const cfg = PAGES[page];
  if (!cfg) throw new Error(`不認得的頁：${page}（可用：${Object.keys(PAGES).join('、')}）`);
  const url = source === 'a6' ? 'file://' + path.join(A6_DIR, cfg.a6) : APP_URL + cfg.app;
  return capture(browser, {
    source,
    file: cfg.a6,
    url,
    width: w.width,
    storageState: source === 'app' ? STATE : undefined,
    appOpen: cfg.appOpen,
  });
}

try {
  if (cmd === 'inventory') {
    for (const page of pages) {
      const dir = path.join(OUT, page);
      fs.mkdirSync(dir, { recursive: true });
      const caps = [];
      for (const w of WIDTHS) {
        const c = await grab(page, 'a6', w);
        save(dir, `a6-${w.tag}`, c);
        caps.push({ ...c, tag: w.tag });
        if (c.errors.length) console.warn(`  ⚠ ${page} ${w.width} 頁面錯誤：`, c.errors);
      }
      fs.writeFileSync(
        path.join(dir, 'inventory.md'),
        inventoryMarkdown(page, PAGES[page].a6, caps),
      );
      console.log(
        `${page}：${caps.map((c) => `${c.width}px ${c.parts.length} part`).join('、')} → ${dir}/inventory.md`,
      );
    }
  } else if (cmd === 'diff') {
    for (const page of pages) {
      const dir = path.join(OUT, page);
      fs.mkdirSync(dir, { recursive: true });
      const sections = [];
      for (const w of WIDTHS) {
        const a6 = await grab(page, 'a6', w);
        const app = await grab(page, 'app', w);
        save(dir, `a6-${w.tag}`, a6);
        save(dir, `app-${w.tag}`, app);
        if (app.errors.length) console.warn(`  ⚠ app ${w.width} 頁面錯誤：`, app.errors);
        const opts = { dataDependent: DATA_DEPENDENT };
        const rows = diffParts(a6, app, PAGES[page].mapping, opts);
        // 彈出物各自配對（A6 的 id 與 app 的不同，見 SHELL_POPOVERS）
        for (const [ia, ib] of Object.entries({
          ...SHELL_POPOVERS,
          ...Object.fromEntries(Object.keys(PAGES[page].appOpen ?? {}).map((k) => [k, k])),
          ...PAGES[page].popovers,
        })) {
          const pa = a6.popovers[ia],
            pb = app.popovers[ib];
          if (!pa) continue;
          if (!pb)
            rows.push({
              status: '缺',
              a6: `pop[${ia}]`,
              app: null,
              detail: `彈出物 ${ia}：app 端 ${ib} 沒打開或不存在`,
            });
          // 兩邊的浮層根節點直接配（A6 是 popover、app 常是 PrimeNG 的 dialog）
          else
            for (const r of diffParts(
              { parts: pa, height: a6.height },
              { parts: pb, height: app.height },
              { [pa[0].key]: pb[0].key },
              opts,
            ))
              rows.push({ ...r, pop: ia });
        }
        const out = classify(rows, [...DEVIATIONS, ...(PAGES[page].deviations ?? [])]);
        fs.writeFileSync(path.join(dir, `diff-${w.tag}.json`), JSON.stringify(out, null, 1));
        sections.push({ width: w.width, rows: out, a6, app });
      }
      fs.writeFileSync(path.join(dir, 'diff.md'), diffMarkdown(page, PAGES[page], sections));
      console.log(`${page} → ${dir}/diff.md`);
    }
  } else {
    console.log('用法：run.mjs inventory [頁…] | diff <頁>');
    process.exitCode = 2;
  }
} finally {
  await browser.close();
}
