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
import { capture, harvestNames, openPage } from './lib/capture.mjs';
import { compareDelta, delta, runScenario } from './lib/behave.mjs';
import { SCENARIOS } from './lib/scenarios.mjs';
import { behaveMarkdown, inventoryMarkdown } from './lib/report.mjs';
import { classify, diffParts, diffMarkdown } from './lib/diff.mjs';
import { collectExtras, extrasMarkdown } from './lib/extras.mjs';

const [cmd, ...args] = process.argv.slice(2);
const pages = args.length ? args : Object.keys(PAGES);
const browser = await chromium.launch();

const save = (dir, name, cap) => {
  const { shot, popShots = {}, ...rest } = cap;
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(rest, null, 1));
  fs.writeFileSync(path.join(dir, `${name}.png`), shot);
  for (const [id, png] of Object.entries(popShots))
    fs.writeFileSync(path.join(dir, `${name}.pop-${id}.png`), png);
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

/** 一頁的第二層（兩寬）：抓兩邊、配對、彈出物各自配對、分欄。存 JSON／截圖。 */
async function diffPage(page) {
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
    const out = classify(rows, [...DEVIATIONS, ...(PAGES[page].deviations ?? [])], w.width);
    fs.writeFileSync(path.join(dir, `diff-${w.tag}.json`), JSON.stringify(out, null, 1));
    sections.push({ width: w.width, tag: w.tag, rows: out, a6, app });
  }
  return sections;
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
      const sections = await diffPage(page);
      fs.writeFileSync(path.join(OUT, page, 'diff.md'), diffMarkdown(page, PAGES[page], sections));
      console.log(`${page} → ${path.join(OUT, page)}/diff.md`);
    }
  } else if (cmd === 'extras') {
    // 多出功能盤點：每頁跑第一、二層，取「多」依功能歸組，裁圖
    const all = [];
    for (const page of pages) {
      try {
        // A6_CACHED=1：用上一次存下的 diff／app JSON 重新歸組（不重抓 22 頁）
        const cached = process.env.A6_CACHED === '1';
        const read = (f) => JSON.parse(fs.readFileSync(path.join(OUT, page, f), 'utf8'));
        const sections = cached
          ? WIDTHS.map((w) => ({
              width: w.width,
              tag: w.tag,
              rows: read(`diff-${w.tag}.json`),
              app: read(`app-${w.tag}.json`),
            }))
          : await diffPage(page);
        if (!cached)
          fs.writeFileSync(
            path.join(OUT, page, 'diff.md'),
            diffMarkdown(page, PAGES[page], sections),
          );
        all.push({
          page,
          cfg: PAGES[page],
          widths: sections.map((s) => ({
            width: s.width,
            tag: s.tag,
            rows: s.rows,
            height: s.app.height,
            parts: [...s.app.parts, ...Object.values(s.app.popovers).filter(Boolean).flat()],
          })),
        });
        console.log(`${page} ✓`);
      } catch (e) {
        console.warn(`  ⚠ ${page} 跑不起來：${e.message.split('\n')[0]}`);
        all.push({ page, cfg: PAGES[page], widths: [], error: e.message.split('\n')[0] });
      }
    }
    const data = collectExtras(all.filter((p) => !p.error));
    const shotDir = path.join(OUT, 'extras');
    fs.mkdirSync(shotDir, { recursive: true });
    const crop = await browser.newPage();
    const shots = new Map();
    const shotsOf = (page, f) => shots.get(f) ?? [];
    for (const [page, list] of [
      ['shell', data.shell],
      ...data.pages.map((p) => [p.page, p.features]),
    ])
      for (const [i, f] of list.entries()) {
        const out = [];
        for (const [w, k] of Object.entries(f.keys)) {
          if (!k.box || k.box[2] < 1 || k.box[3] < 1) continue;
          const srcPage = page === 'shell' ? [...f.pages][0] : page;
          const src = path.join(
            OUT,
            srcPage,
            `app-${k.tag}${k.popId ? `.pop-${k.popId}` : ''}.png`,
          );
          if (!fs.existsSync(src)) continue;
          const file = path.join(shotDir, `${page}-${i + 1}-${w}.png`);
          const [x, y, bw, bh] = k.box;
          await crop.setContent(
            `<body style="margin:0"><img src="data:image/png;base64,${fs.readFileSync(src).toString('base64')}"></body>`,
          );
          await crop.setViewportSize({
            width: Math.max(400, x + bw + 40),
            height: Math.min(20000, Math.max(300, y + bh + 40)),
          });
          await crop.screenshot({
            path: file,
            clip: {
              x: Math.max(0, x - 8),
              y: Math.max(0, y - 8),
              width: bw + 16,
              height: Math.min(bh + 16, 1600),
            },
          });
          out.push(path.relative(OUT, file));
        }
        shots.set(f, out);
      }
    let md = extrasMarkdown(data, shotsOf);
    const failed = all.filter((p) => p.error);
    if (failed.length)
      md += `\n## 沒跑起來的頁\n\n${failed.map((p) => `- ${p.page}（\`${p.cfg.app}\`）：${p.error}`).join('\n')}\n`;
    fs.writeFileSync(path.join(OUT, 'extras.md'), md);
    console.log(`→ ${path.join(OUT, 'extras.md')}`);
  } else if (cmd === 'behave') {
    for (const page of pages) {
      const cfg = PAGES[page];
      const dir = path.join(OUT, page);
      fs.mkdirSync(dir, { recursive: true });
      const results = [];
      for (const w of WIDTHS)
        for (const sc of SCENARIOS[page] ?? []) {
          const side = {};
          for (const source of ['a6', 'app']) {
            // 每個情境各開一頁，前一個情境的狀態不會漏到下一個
            const url = source === 'a6' ? 'file://' + path.join(A6_DIR, cfg.a6) : APP_URL + cfg.app;
            const {
              ctx,
              page: pg,
              errors,
            } = await openPage(browser, {
              source,
              url,
              width: w.width,
              storageState: source === 'app' ? STATE : undefined,
            });
            const names = await harvestNames(pg, source, ctx);
            const r = await runScenario(pg, { steps: sc[source], names });
            side[source] = { ...r, errors, delta: delta(r) };
            await ctx.close();
          }
          const diffs = compareDelta(side.a6.delta, side.app.delta, {
            ignore: [...(cfg.behaveIgnore ?? []), ...(sc.ignore ?? [])],
            checkFocus: sc.checkFocus,
          });
          const failed = [
            side.a6.failed && `A6 ${side.a6.failed}`,
            side.app.failed && `app ${side.app.failed}`,
          ].filter(Boolean);
          results.push({
            width: w.width,
            name: sc.name,
            ok: !diffs.length && !failed.length,
            failed,
            diffs,
            a6: side.a6.delta,
            app: side.app.delta,
          });
        }
      fs.writeFileSync(path.join(dir, 'behave.json'), JSON.stringify(results, null, 1));
      fs.writeFileSync(path.join(dir, 'behave.md'), behaveMarkdown(page, cfg, results));
      console.log(
        `${page}：${results.filter((r) => r.ok).length}／${results.length} 一致 → ${dir}/behave.md`,
      );
    }
  } else {
    console.log('用法：run.mjs inventory [頁…] | diff [頁…] | behave [頁…] | extras [頁…]');
    process.exitCode = 2;
  }
} finally {
  await browser.close();
}
