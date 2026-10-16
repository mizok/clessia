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

test('稿在這個父層有列時，app 只有 2 列也認成列（資料少的日子）；只有 1 個不認', async () => {
  const page = await browser.newPage();
  const two =
    '<main><div class="bar"><button>日</button></div><div class="r"><span>老師</span><b>15:00</b></div><div class="r"><span>李</span><button>課</button></div></main>';
  await page.setContent(two);
  const plain = await page.evaluate(extractSource({}));
  const hinted = await page.evaluate(extractSource({ rowParents: ['>landmark:main[]'] }));
  assert.ok(!plain.some((p) => p.kind === 'row'));
  const rows = hinted.filter((p) => p.key === '>landmark:main[]>row');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].inRows, 2); // 兩列，工具列（不同簽名、只有一個）不算
  // 只有一個容器：提示也不認（不知道是哪一個）
  await page.setContent(
    '<main><div class="bar"><button>日</button></div><div class="r"><span>李</span><button>課</button></div></main>',
  );
  const one = await page.evaluate(extractSource({ rowParents: ['>landmark:main[]'] }));
  await page.close();
  assert.ok(!one.some((p) => p.kind === 'row'));
});

test('列內 part 記「相對所在列」的位置（代表取自不同列也能比）', async () => {
  const ps = await parts(
    '<main>' +
      [0, 1, 2]
        .map(
          (i) =>
            `<div class="r" style="height:60px"><span>老師${i}</span><button style="margin-left:${i === 0 ? 0 : 100}px">課</button></div>`,
        )
        .join('') +
      '</main>',
  );
  const btn = ps.find((p) => p.key.endsWith('>row>control:button'));
  // 三列裡兩列的按鈕往右 100 —— 但樣式一樣，代表取第一個出現的；相對所在列的 y 都是同一個值
  assert.ok(Array.isArray(btn.rowRel));
  assert.ok(btn.rowRel[1] >= 0 && btn.rowRel[1] < 60);
});
