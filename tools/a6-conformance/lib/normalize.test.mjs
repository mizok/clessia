import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normText, sizeOk, posOk, styleEq } from './normalize.mjs';
import { matchParts } from './diff.mjs';

test('文案模板：數字、時間、日期、區間、假人名正規化', () => {
  assert.equal(normText('120 位學生，今天有 30 位有課。'), '# 位學生，今天有 # 位有課。');
  assert.equal(normText('16:00–17:30 · 2026/10/14 · NT$ 1,200'), '# · # · NT$ #');
  assert.equal(
    normText('帳戶：林主任，目前身分 管理員', ['林主任']),
    '帳戶：{名}，目前身分 管理員',
  );
  assert.equal(normText('  a \n b '), 'a b');
});

test('容差邊界：位置 ±4、尺寸 ±4 或 3%、字級 ±0.5', () => {
  assert.ok(posOk(0, 4));
  assert.ok(!posOk(0, 5));
  assert.ok(sizeOk(100, 104) && !sizeOk(100, 105));
  assert.ok(sizeOk(400, 412) && !sizeOk(400, 413)); // 3% of 412.4
  assert.ok(styleEq('fontSize', '14px', '14.5px') && !styleEq('fontSize', '14px', '15px'));
  assert.ok(!styleEq('color', 'rgb(0, 0, 0)', 'rgb(0, 0, 1)'));
});

test('配對：後綴唯一、同類角色、只看文案', () => {
  const p = (key, kind, role, tpl = '') => ({
    key,
    parent: key.split('>').slice(0, -1).join('>') || null,
    kind,
    role,
    tpl,
  });
  const a6 = [
    p('>control:searchbox[搜尋學生]', 'control', 'searchbox', '搜尋學生'),
    p('>landmark:main[]>text:div[國三]', 'text', 'div', '國三'),
  ];
  const app = [
    p('>landmark:search[篩選學生]>control:textbox[搜尋學生]', 'control', 'textbox', '搜尋學生'),
    p('>landmark:banner[]>control:button[搜尋學生]', 'control', 'button', '搜尋學生'),
    p('>landmark:main[]>heading:h2[國三]', 'heading', 'h2', '國三'),
  ];
  const m = matchParts(a6, app);
  assert.equal(m.get(a6[0].key), app[0].key); // 輸入框配輸入框，不配同名按鈕
  assert.equal(m.get(a6[1].key), app[2].key);
});

test('包裝層 span 的底線併回連結（app 把「目前頁」底線畫在內層 span）', async () => {
  const { styleDiffs, withWrapper } = await import('./diff.mjs');
  const st = (bb, color = 'rgb(255, 255, 255)') => ({
    borderBottom: bb,
    color,
    fontSize: '14px',
    fontWeight: '600',
    lineHeight: '21px',
    display: 'block',
  });
  const a6 = {
    key: '>a',
    tpl: '學生',
    kind: 'control',
    own: true,
    style: st('2px solid rgb(255, 106, 61)'),
  };
  const link = {
    key: '>a',
    tpl: '學生',
    kind: 'control',
    own: false,
    style: st('0px none rgb(255, 255, 255)', 'rgb(0, 0, 238)'),
  };
  const span = {
    key: '>a>s',
    parent: '>a',
    tpl: '學生',
    kind: 'text',
    own: true,
    style: st('2px solid rgb(255, 106, 61)'),
  };
  assert.deepEqual(styleDiffs(a6, withWrapper(link, [link, span])), []);
  assert.ok(styleDiffs(a6, link).some((d) => d.startsWith('borderBottom'))); // 不併就會誤報
});

test('分欄：資料差 → 工具限制 → 已記錄偏離 → 待修', async () => {
  const { classify } = await import('./diff.mjs');
  const { DEVIATIONS } = await import('./config.mjs');
  const r = (status, detail, extra = {}) => ({
    status,
    kind: 'control',
    detail,
    a6: '>x',
    app: '>x',
    ...extra,
  });
  const out = classify(
    [
      r('尺寸', '高 26→44'),
      r('尺寸', '高 26→43'),
      r('尺寸', '高 26→44', { kind: 'text' }),
      r('資料差', '高 26→44'),
      r('位置', 'Δy', { limit: '結構範圍不同' }),
    ],
    DEVIATIONS,
  ).map((x) => x.bucket);
  // 44 是 A27 的觸控下限；43 不到下限＝待修；文字不是可點元素＝待修
  assert.deepEqual(out, ['已記錄偏離', '待修', '待修', '資料差', '工具限制']);
});

test('工具限制自動標註：結構範圍不同、同型段落數不同、偽元素', async () => {
  const { diffParts } = await import('./diff.mjs');
  const style = {
    display: 'block',
    fontSize: '14px',
    fontWeight: '400',
    lineHeight: '21px',
    color: 'x',
    backgroundColor: 'x',
    padding: '0px',
  };
  const p = (key, kind, role, tpl, box, extra = {}) => ({
    key,
    parent: key.split('>').slice(0, -1).join('>') || null,
    kind,
    role,
    tpl,
    text: tpl,
    box,
    style,
    ...extra,
  });
  // A6：hero 在 main 外；app：hero 在 main 裡 → main 的位置差是結構範圍不同
  const A = [
    p('>landmark:region[摘要]', 'landmark', 'region', '摘要', [0, 0, 100, 50]),
    p('>landmark:main[]', 'landmark', 'main', '', [0, 50, 100, 100]),
    p('>landmark:main[]>landmark:popover[帳戶]', 'landmark', 'popover', '帳戶', [0, 50, 100, 100]),
    p(
      '>landmark:main[]>landmark:popover[帳戶]>text:p[{名}]',
      'text',
      'p',
      '{名}',
      [0, 50, 100, 20],
    ),
    p(
      '>landmark:main[]>landmark:popover[帳戶]>text:p[切換身分]',
      'text',
      'p',
      '切換身分',
      [0, 70, 100, 20],
    ),
    p(
      '>landmark:main[]>landmark:popover[帳戶]>control:link[設定]',
      'control',
      'link',
      '設定',
      [0, 90, 50, 20],
      { pseudo: true, style: { ...style, borderBottom: '2px solid red' } },
    ),
  ];
  const B = [
    p('>landmark:main[]', 'landmark', 'main', '', [0, 0, 100, 150]),
    p('>landmark:main[]>landmark:region[摘要]', 'landmark', 'region', '摘要', [0, 0, 100, 50]),
    p('>landmark:main[]>landmark:popover[帳戶]', 'landmark', 'popover', '帳戶', [0, 50, 100, 100]),
    p(
      '>landmark:main[]>landmark:popover[帳戶]>text:p[Demo]',
      'text',
      'p',
      'Demo',
      [0, 50, 100, 20],
    ),
    p(
      '>landmark:main[]>landmark:popover[帳戶]>control:link[設定]',
      'control',
      'link',
      '設定',
      [0, 70, 50, 20],
    ),
  ];
  const rows = diffParts({ parts: A }, { parts: B });
  const lim = (pred) => rows.find(pred)?.limit ?? '';
  assert.match(
    lim((r) => r.a6 === '>landmark:main[]' && r.status === '位置'),
    /結構範圍/,
  );
  assert.match(
    lim((r) => r.status === '缺' && r.a6.endsWith('{名}]')),
    /同型段落數/,
  );
  // A6 的「設定」有底線且自己帶偽元素 → 偽元素解釋不了 app 沒底線，照算
  assert.equal(rows.find((r) => r.status === '樣式').limit, undefined);
  // app 那側沒底線、但帶偽元素 → 線可能畫在偽元素上，歸工具限制
  const B2 = B.map((x) => (x.key.endsWith('[設定]') ? { ...x, pseudo: true } : x));
  const A2 = A.map((x) => (x.pseudo ? { ...x, pseudo: false } : x));
  assert.match(
    diffParts({ parts: A2 }, { parts: B2 }).find((r) => r.status === '樣式').limit ?? '',
    /偽元素/,
  );
});

test('帳戶浮層：名字、email 兩邊都樣板化；「切換身分」單身分帳號沒有＝資料差', async () => {
  // 稿的假帳號與 app 的登入者，模板要一樣才配得上（#1314 comment 6182020487 C 段的誤報）
  assert.equal(normText('lin.director@wenshan-demo.tw'), normText('admin@demo.clessia.app'));
  assert.equal(normText('林主任', ['林主任']), normText('Demo Admin', ['Demo Admin']));
  assert.equal(normText('user01@demo.clessia.app'), '{email}'); // 數字不能先被換成 #

  const { diffParts, classify } = await import('./diff.mjs');
  const { DATA_DEPENDENT } = await import('./config.mjs');
  const style = { display: 'block', padding: '0px' };
  const p = (key, kind, role, tpl, box) => ({
    key,
    parent: key.split('>').slice(0, -1).join('>') || null,
    kind,
    role,
    tpl,
    text: tpl,
    box,
    style,
  });
  const R = 'pop[acct]>landmark:popover[帳戶]';
  const A = [
    p(R, 'landmark', 'popover', '帳戶', [0, 0, 300, 315]),
    p(`${R}>text:p[{名}]`, 'text', 'p', '{名}', [0, 0, 200, 24]),
    p(`${R}>text:p[切換身分]`, 'text', 'p', '切換身分', [0, 40, 200, 28]),
    p(`${R}>control:button[家長]`, 'control', 'button', '家長', [0, 70, 270, 40]),
  ];
  const B = [
    p(R, 'landmark', 'popover', '帳戶', [0, 0, 300, 195]),
    p(`${R}>text:p[{名}]`, 'text', 'p', '{名}', [0, 0, 200, 24]),
  ];
  const rows = classify(
    diffParts({ parts: A }, { parts: B }, {}, { dataDependent: DATA_DEPENDENT }),
  );
  assert.deepEqual(
    rows.filter((r) => r.bucket === '待修'),
    [],
  );
  assert.ok(rows.some((r) => r.a6 === R && /高 315→195；內含隨資料/.test(r.detail)));
  // 沒有 dataDependent 時同一份資料會報「缺」—— 確認上面那條真的是規則在起作用
  assert.ok(
    classify(diffParts({ parts: A }, { parts: B })).some(
      (r) => r.bucket === '待修' && r.status === '缺',
    ),
  );
});

test('貼底的抽屜：視窗高不同時用「距視窗底」量', async () => {
  const { diffParts } = await import('./diff.mjs');
  const st = { display: 'block' };
  const root = (y, h) => [
    {
      key: 'pop[x]>landmark:popover[帳戶]',
      parent: null,
      kind: 'landmark',
      role: 'popover',
      tpl: '帳戶',
      text: '',
      box: [0, y, 360, h],
      style: st,
    },
  ];
  // 稿：視窗 6686、抽屜貼底；app：視窗 1112、抽屜也貼底 → 不算位置差
  const same = diffParts(
    { parts: root(6686 - 300, 300), height: 6686 },
    { parts: root(1112 - 300, 300), height: 1112 },
  );
  assert.equal(same.filter((r) => r.status === '位置').length, 0);
  // app 離底 20px → 報位置差，而且說是相對視窗底
  const off = diffParts(
    { parts: root(6686 - 300, 300), height: 6686 },
    { parts: root(1112 - 320, 300), height: 1112 },
  );
  assert.match(off.find((r) => r.status === '位置').detail, /相對視窗底 Δx 0、Δy -20/);
});
