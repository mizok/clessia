// 抽取器要在真的瀏覽器裡跑（computed style、盒子）：用 Playwright 開一頁靜態 HTML。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { extractSource } from './extract.mjs';

const browser = await chromium.launch();
after(() => browser.close());

async function parts(html) {
  const page = await browser.newPage();
  await page.setContent(`<body>${html}</body>`);
  const out = await page.evaluate(extractSource({}));
  await page.close();
  return out;
}

test('列的代表取最常見的樣式：第一列是軸列、第一個課塊是「上課中」都不能當代表', async () => {
  const row = (blk) =>
    `<div class="r" style="border-bottom:1px solid #ddd"><span>老師</span>${blk}</div>`;
  const normal = '<button style="border:1px solid #ccc">課<span>3 人</span></button>';
  const live =
    '<button style="border:2px solid #000">課<span>3 人</span><span style="background:#fff">上課中</span></button>';
  const html = `<main><div class="r" style="border-bottom:2px solid #000"><span>軸</span><span>15:00</span></div>${row(live)}${row(normal)}${row(normal)}${row(normal)}</main>`;
  const ps = await parts(html);
  const r = ps.find((p) => p.key.endsWith('>row'));
  assert.equal(r.style.borderBottom, '1px solid rgb(221, 221, 221)'); // 資料列，不是軸列
  assert.equal(r.variants, 2);
  const btn = ps.find((p) => p.key.endsWith('>row>control:button'));
  assert.equal(btn.style.borderTop, '1px solid rgb(204, 204, 204)'); // 一般課塊，不是上課中
  // 徽章（有底色的短字）保留文案進 key，不按位置配
  assert.ok(ps.some((p) => p.key.endsWith('control:button>text:span[上課中]')));
});

test('完整文字含子元素（「已收 NT$ 174,100」的數字在 strong 裡）', async () => {
  const ps = await parts('<p><span>已收 <strong>NT$ 174,100</strong></span></p>');
  const sp = ps.find((p) => p.tpl === '已收');
  assert.equal(sp.text, '已收');
  assert.equal(sp.full, '已收 NT$ 174,100');
});
