// 黏住（sticky）的行為檢查：靜態幾何是在撐開的視窗裡量的（capture 的 growViewport），什麼都不捲，
// sticky 漏了也量不出來。這裡用正常高度的視窗、真的去捲，看該黏住的東西還在不在視窗裡。
// 比「效果」不比寫法：app 用別的方式釘住（動作列放在捲動區外、頂欄不在捲動容器裡）也算對齊。
import { extractSource } from './extract.mjs';
import { closePop, harvestNames, openPage, openPop } from './capture.mjs';

/**
 * 瀏覽器端：找回 key 的元素，往釘住的方向捲到「不黏就會離開視窗」，回報黏住後與不黏時是否看得到。
 * - top／left：最近一個能在該軸捲動的祖先，捲到元素「不黏時的位置」整個越過可視區起點
 * - bottom／right：捲回起點，元素「不黏時的位置」要在可視區終點之外才有得比
 * 可視區＝視窗 ∩ 所有 overflow 不是 visible 的祖先。看得到＝該軸至少一半在可視區內。
 */
export function probeInPage({ key, axis }) {
  const el = window.__a6els?.get(key);
  if (!el) return { found: false };
  const v = axis === 'top' || axis === 'bottom';
  const [S, C, P, start, end] = v
    ? ['scrollTop', 'clientHeight', 'scrollHeight', 'top', 'bottom']
    : ['scrollLeft', 'clientWidth', 'scrollWidth', 'left', 'right'];
  const doc = document.scrollingElement;
  // 捲動容器：該軸 overflow 是 auto／scroll 的祖先；文件本身要 html／body 沒有 overflow: hidden 才算
  // （app 的殼層把 body 設 hidden，程式還是捲得動它，但使用者捲不到）
  const ov = (x) => getComputedStyle(x)[v ? 'overflowY' : 'overflowX'];
  const cands = [];
  for (let x = el.parentElement; x && x !== doc && x !== document.body; x = x.parentElement)
    if (/auto|scroll/.test(ov(x))) cands.push(x);
  if (ov(doc) !== 'hidden' && ov(document.body) !== 'hidden') cands.push(doc);
  // 墊高：資料少時容器不夠長，黏不黏都捲不出差別（app 一班三個學生）。暫插一塊兩個視窗長的空白，
  // 量完拿掉。有 sticky：插在釘點（最上層 sticky 祖先）的容器裡，黏住的範圍才會跟著變長；
  // 沒有：插在最近的捲動容器裡，只給捲動的餘量（插在元素旁邊會把 dialog 的 footer 撐爆）。
  // top／left 插在後面、bottom／right 插在前面
  let anchor = null;
  for (let x = el; x && x !== doc; x = x.parentElement)
    if (getComputedStyle(x).position === 'sticky') anchor = x;
  const pad = document.createElement('div');
  pad.style.cssText = v
    ? `flex:none;width:1px;height:${2 * innerHeight}px`
    : `flex:none;height:1px;width:${2 * innerWidth}px`;
  const after = axis === 'top' || axis === 'left';
  const box = cands[0] === doc ? document.body : cands[0];
  if (anchor) anchor[after ? 'after' : 'before'](pad);
  else if (box) box[after ? 'append' : 'prepend'](pad);
  const scrollers = cands.filter((x) => x[P] > x[C] + 1);
  for (const s of scrollers) s[S] = 0;
  const clip = () => {
    let a = 0,
      b = v ? innerHeight : innerWidth;
    // body 的 overflow 會傳給 viewport，不是自己的裁切框；fixed 祖先之上的祖先也裁不到它
    for (let x = el.parentElement; x && x !== doc && x !== document.body; x = x.parentElement) {
      const s = getComputedStyle(x);
      if ((v ? s.overflowY : s.overflowX) !== 'visible') {
        const r = x.getBoundingClientRect();
        a = Math.max(a, r[start]);
        b = Math.min(b, r[end]);
      }
      if (s.position === 'fixed') break;
    }
    return [a, b];
  };
  // 不黏時的位置：把自己與 sticky 祖先暫時改成 static（sticky 在文件流裡佔的位置跟 static 一樣）
  const natural = () => {
    const pinned = [];
    for (let x = el; x && x !== doc; x = x.parentElement)
      if (getComputedStyle(x).position === 'sticky') pinned.push([x, x.style.position]);
    for (const [x] of pinned) x.style.setProperty('position', 'static', 'important');
    const r = el.getBoundingClientRect();
    for (const [x, old] of pinned) x.style.position = old;
    return r;
  };
  const seen = (r, [a, b]) => {
    const len = r[end] - r[start];
    return len > 0 && (Math.min(r[end], b) - Math.max(r[start], a)) / len >= 0.5;
  };
  const sc = scrollers[0];
  let short = false; // 捲不到需要的量（內容不夠長）
  if (sc && (axis === 'top' || axis === 'left')) {
    const need = natural()[end] - clip()[0] + 8;
    const before = sc[S];
    sc[S] = before + need;
    short = sc[S] - before < need - 1;
  }
  const c = clip();
  const r = el.getBoundingClientRect();
  const out = {
    found: true,
    scroller: !!sc,
    short,
    visible: seen(r, c),
    natural: seen(natural(), c),
    // 黏在哪：釘點容器（最上層 sticky 祖先，沒有就是自己）離視窗那一邊的距離 —— 使用者看到的位置
    // （app 頂欄在捲動區外，同一個 top 值落點不同）。量容器不量 part：章頭裡張數離章名多遠是靜態「位置」的事
    at: (() => {
      const q = (anchor ?? el).getBoundingClientRect();
      return Math.round(after ? q[start] : (v ? innerHeight : innerWidth) - q[end]);
    })(),
  };
  pad.remove();
  for (const s of scrollers) s[S] = 0;
  return out;
}

/**
 * 節點端：開一頁（正常視窗高）、逐一檢查 targets（{ pop?, key, axis }），回傳同順序的結果。
 * 抽 part 用跟 capture 一樣的參數，key 才找得回來。
 */
export async function probeSticky(browser, o, targets) {
  const out = new Map();
  if (!targets.length) return out;
  const { ctx, page } = await openPage(browser, o);
  try {
    const names = await harvestNames(page, o.source, ctx);
    const pops = [...new Set(targets.map((t) => t.pop ?? ''))];
    for (const pop of pops) {
      let root = 'body';
      if (pop) {
        root = await openPop(page, pop, o.opens);
        if (!root) {
          for (const t of targets.filter((t) => (t.pop ?? '') === pop))
            out.set(t, { found: false });
          continue;
        }
      }
      await page.evaluate(
        extractSource({
          names,
          rowParents: o.rowParents,
          rowSel: o.rowSel,
          root,
          prefix: pop ? `pop[${pop}]` : '',
          tag: true,
        }),
      );
      for (const t of targets.filter((t) => (t.pop ?? '') === pop))
        out.set(t, await page.evaluate(probeInPage, { key: t.key, axis: t.axis }));
      if (pop) await closePop(page, pop, o.opens);
    }
  } finally {
    await ctx.close();
  }
  return out;
}

/**
 * 兩邊的結果 → 判定。null＝效果一致，不列；否則 { detail, limit? }。
 * 稿這裡「捲得出差別」（有捲動容器、捲得到、不黏時會離開視窗）才比：稿還看得到＝該黏，app 也要看得到；
 * 稿被捲走＝不該黏，app 卻黏著（而且 app 那邊同樣捲得出差別）＝多黏。
 */
export function stickyVerdict(a6, app, pins, pinsDiffer, axis = 'top') {
  const lim = (why) => ({ detail: `${pins}；${why}`, limit: LIMIT });
  if (!a6.found || !app.found) return lim('行為檢查找不回元素');
  const testable = (x) => x.scroller && !x.short && !x.natural;
  if (!testable(a6))
    return pinsDiffer ? lim('稿在這個視窗高下捲不出黏住的效果（容器太短或沒有捲動容器）') : null;
  if (a6.visible && !app.visible) return { detail: `${pins}；捲動後稿仍在視窗內，app 被捲走了` };
  // app 捲不出差別（沒有捲動容器、捲不到）：看得到可能只是因為沒捲走，不能當作有黏住
  if (a6.visible && app.scroller && (app.short || app.natural))
    return lim('app 這裡捲不出差別（墊高後仍捲不到），看得到不代表有黏住');
  if (a6.visible && app.visible && testable(app) && Math.abs(a6.at - app.at) > 4)
    return {
      detail: `${pins}；兩邊都黏住，但黏在離視窗${/^(top|left)/.test(axis) ? '頂' : '底'} ${a6.at}px → ${app.at}px`,
    };
  if (!a6.visible && app.visible && testable(app))
    // 稿宣告了 sticky 卻沒黏住：多半是被只有自己高的容器框住（scores.html 的註解講過這個坑）。
    // 稿的意圖是黏，app 黏著不見得錯 —— 裁過的登記成偏離（config DEVIATIONS）
    // 不標工具限制：要讓 config 的偏離認領（稿的 bug、app 照意圖做，例：meals .savebar）
    return {
      detail: /^sticky 無/.test(pins)
        ? `${pins}；捲動後稿被捲走，app 仍黏在視窗內（多黏）`
        : `${pins}；稿宣告了 sticky 但捲動時沒黏住（容器框住了它），app 有黏`,
    };
  return null;
}

export const LIMIT = '黏住：行為檢查無法判定（見細節），人工看';
