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

// ── 審核席 #1759 的突變補守（S10／S9／S5／S1／S7／S3／S4）──

test('S10 app 沒 sticky、動作列在捲動區外（#166 的 form-dialog）：墊高塊不能插在元素旁，否則 footer 被撐出視窗', async () => {
  const html = `<style>body{margin:0;overflow:hidden}</style>
    <div role="dialog" aria-label="表單" style="position:fixed;top:40px;left:40px;width:400px;max-height:500px;display:flex;flex-direction:column">
      <div style="min-height:0;overflow-y:auto">${'<p>欄位</p>'.repeat(40)}</div>
      <div><button>送出</button></div></div>`;
  const { r } = await probe(html, '>landmark:dialog[表單]>control:button[送出]', 'bottom');
  assert.equal(r.scroller, false); // 按鈕的祖先沒有捲動容器＝本來就不會被捲走
  assert.equal(r.visible, true);
});

test('S9 fixed 面板之上的祖先就算 overflow hidden 也裁不到它', async () => {
  const html = `<style>body{margin:0}</style><div style="overflow:hidden;height:10px">
    <section style="position:fixed;inset:0"><main aria-label="內容" style="height:700px;overflow-y:auto">
    <div style="position:sticky;top:0"><button>返回</button></div>${'<p>表單</p>'.repeat(60)}</main></section></div>`;
  const { r } = await probe(html, '>landmark:main[內容]>control:button[返回]');
  assert.equal(r.visible, true);
});

test('S5 橫向（甘特左欄 left 0）：墊高插在後面、橫著捲過去仍在；拿掉 sticky 就被捲走', async () => {
  const gantt = (lab) => `<style>body{margin:0}</style>
    <main aria-label="內容" style="width:600px;overflow-x:auto">
      <div style="display:flex;width:900px"><div style="${lab};flex:none;width:120px;background:#fff"><p>王老師</p></div>
      <div style="flex:none;width:780px">課</div></div></main>`;
  const key = '>landmark:main[內容]>text:p[王老師]';
  const stuck = (await probe(gantt('position:sticky;left:0'), key, 'left')).r;
  const loose = (await probe(gantt(''), key, 'left')).r;
  assert.equal(stuck.short, false);
  assert.equal(stuck.visible, true);
  assert.equal(stuck.natural, false);
  assert.equal(loose.visible, false);
});

test('S4 只露出 1/4 不算看得到', async () => {
  const html = shell(
    chap('position:sticky;top:-30px;align-self:start;height:40px;overflow:hidden'),
  ).replace('<h2 style="margin:0">', '<h2 style="margin:0;height:40px;line-height:40px">');
  const { r } = await probe(html, KEY);
  assert.equal(r.visible, false);
});

const T = { found: true, scroller: true, short: false, natural: false, visible: true, at: 80 };

test('S1 落點容差 ±4：差 4 不報、差 5 報', () => {
  assert.equal(stickyVerdict(T, { ...T, at: 84 }, 'p', false), null);
  assert.match(stickyVerdict(T, { ...T, at: 85 }, 'p', false).detail, /80px → 85px/);
});

test('S7 app 墊高後仍捲不到（short）或不黏也看得到（natural）：工具限制，不能當成黏住', () => {
  for (const app of [
    { ...T, short: true },
    { ...T, natural: true },
  ]) {
    const v = stickyVerdict(T, app, 'p', true);
    assert.ok(v?.limit, JSON.stringify(app));
  }
});

test('S3 稿不黏也看得到（natural）：稿這裡沒得比，不是待修', () => {
  const a6 = { ...T, natural: true };
  const app = { ...T, visible: false };
  assert.ok(stickyVerdict(a6, app, 'p', true).limit);
  assert.equal(stickyVerdict(a6, app, 'p', false), null);
});
