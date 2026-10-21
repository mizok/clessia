// 黏住的行為檢查：真的開瀏覽器捲（sticky 要有版面才有意義）。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { extractSource } from './extract.mjs';
import { probeInPage, stickyVerdict } from './sticky.mjs';

const browser = await chromium.launch();
after(() => browser.close());

// 殼層型：內容區自己捲（app 的 shell），body overflow hidden
const shell = (
  inner,
) => `<style>body{margin:0;overflow:hidden}main{height:600px;overflow-y:auto}</style>
  <header style="height:56px">頂欄</header><main aria-label="內容">${inner}</main>`;
const chap = (side) =>
  `<section aria-label="國三" style="display:grid;grid-template-columns:200px 1fr">
    <div style="${side}"><h2 style="margin:0">國三</h2></div><ul>${'<li>學生</li>'.repeat(5)}</ul></section>`;

async function probe(html, key, axis = 'top') {
  const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
  await page.setContent(html);
  const parts = await page.evaluate(extractSource({ tag: true }));
  const r = await page.evaluate(probeInPage, { key, axis });
  await page.close();
  return { r, part: parts.find((p) => p.key === key) };
}
const KEY = '>landmark:main[內容]>landmark:region[國三]>heading:h2[國三]';

test('sticky 祖先帶進 part：釘點與 offset（sticky 容器本身不是 part）', async () => {
  const { part } = await probe(shell(chap('position:sticky;top:80px;align-self:start')), KEY);
  assert.equal(part.pin.at, 'top 80px');
});

test('黏住的章頭：資料只有 5 列也墊得出差別，捲過去仍在視窗內', async () => {
  const { r } = await probe(shell(chap('position:sticky;top:80px;align-self:start')), KEY);
  const { at, ...rest } = r;
  assert.deepEqual(rest, {
    found: true,
    scroller: true,
    short: false,
    visible: true,
    natural: false,
  });
  assert.equal(at, 56 + 80); // 頂欄 56 在捲動區外
});

test('拿掉 sticky（突變）：捲走 → 判成 app 被捲走', async () => {
  const stuck = (await probe(shell(chap('position:sticky;top:80px;align-self:start')), KEY)).r;
  const { r } = await probe(shell(chap('align-self:start')), KEY);
  assert.equal(r.visible, false);
  assert.match(stickyVerdict(stuck, r, 'sticky top 80px → 無', true).detail, /app 被捲走了/);
  assert.equal(stickyVerdict(stuck, stuck, 'sticky top 80px → top 80px', false), null);
});

test('頂欄不在捲動容器裡（app 殼層）：沒有捲動容器，效果等於黏住', async () => {
  const a6 = { found: true, scroller: true, short: false, visible: true, natural: false };
  const { r } = await probe(shell(chap('')), '>landmark:banner[]');
  assert.equal(r.scroller, false);
  assert.equal(stickyVerdict(a6, r, 'sticky top 0px → 無', true), null);
});

test('sticky 被只有自己高的容器框住（稿 meals 的 .savebar）：宣告了但沒黏 → 工具限制，不算待修', async () => {
  const bar = (wrap) =>
    `${'<p>列</p>'.repeat(60)}<div ${wrap ? '' : 'style="display:contents"'}><div role="region" aria-label="儲存" style="position:sticky;bottom:16px">儲存</div></div>`;
  const key = '>landmark:main[內容]>landmark:region[儲存]';
  const framed = (await probe(shell(bar(true)), key, 'bottom')).r;
  const ok = (await probe(shell(bar(false)), key, 'bottom')).r;
  assert.equal(framed.visible, false);
  assert.equal(ok.visible, true);
  assert.ok(stickyVerdict(framed, ok, 'sticky bottom 16px → bottom 16px', false).limit);
});

test('fixed 面板裡的捲動區：body overflow hidden 高 0 不當裁切框（稿登入頁手機 .ps__bar）', async () => {
  const html = `<style>body{margin:0;overflow:hidden}.ps{position:fixed;inset:0}</style>
    <section class="ps"><main aria-label="內容" style="height:700px;overflow-y:auto">
    <div style="position:sticky;top:0"><button>返回</button></div><p>表單</p></main></section>`;
  const { r } = await probe(html, '>landmark:main[內容]>control:button[返回]');
  assert.equal(r.visible, true);
});

test('兩邊都黏住但落點不同：app 頂欄在捲動區外，照抄稿的 top 80px 會低一個頂欄 → 待修', async () => {
  const side = 'position:sticky;align-self:start;top:';
  // 稿：整頁捲、頂欄自己 sticky
  const a6 = (
    await probe(
      `<style>body{margin:0}</style><header style="position:sticky;top:0;height:56px">頂欄</header>
      <main aria-label="內容">${chap(side + '80px')}</main>`,
      KEY,
    )
  ).r;
  const copied = (await probe(shell(chap(side + '80px')), KEY)).r;
  const fixed = (await probe(shell(chap(side + '24px')), KEY)).r;
  assert.deepEqual([a6.at, copied.at, fixed.at], [80, 136, 80]);
  assert.match(
    stickyVerdict(a6, copied, 'sticky top 80px → top 80px', false).detail,
    /離視窗頂 80px → 136px/,
  );
  assert.equal(stickyVerdict(a6, fixed, 'sticky top 80px → top 24px', true), null);
});
