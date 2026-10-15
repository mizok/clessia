import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normText, sizeOk, posOk, styleEq } from './normalize.mjs';
import { matchParts } from './diff.mjs';

test('文案模板：數字、時間、日期、區間、假人名正規化', () => {
  assert.equal(normText('120 位學生，今天有 30 位有課。'), '#位學生，今天有#位有課。');
  assert.equal(normText('16:00–17:30 · 2026/10/14 · NT$ 1,200'), '# · # · NT$ #');
  assert.equal(normText('帳戶：林主任，目前身分 管理員', ['林主任']), '帳戶：{名}，目前身分管理員');
  assert.equal(normText('  a \n b '), 'a b');
  // 月份與 <br> 留下的空白（帳單色面：稿「十月應收…，已收」vs app「10 月應收…， 已收」）
  assert.equal(
    normText('十月應收 NT$ 1,200，已收 80%。'),
    normText('10 月應收 NT$ 900， 已收 75%。'),
  );
  assert.equal(normText('120 位學生'), '#位學生');
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
    360,
  ).map((x) => x.bucket);
  // 44 是 A27 的觸控下限；43 不到下限＝待修；文字不是可點元素＝待修
  assert.deepEqual(out, ['已記錄偏離', '待修', '待修', '資料差', '工具限制']);
  // R3：A27 只管基底（手機）。桌機高度跟稿不同是待修，不是偏離
  assert.equal(classify([r('尺寸', '高 26→44')], DEVIATIONS, 1440)[0].bucket, '待修');
  // R2：「更多」選單多出的「公開申請」是已記錄偏離，其他多出來的連結不是
  const more = (name) =>
    r('多', '', {
      a6: null,
      app: `pop[shell-more]>landmark:popover[]>control:link[${name}]`,
      pop: 'more',
    });
  assert.deepEqual(
    classify([more('公開申請'), more('別的')], DEVIATIONS, 1440).map((x) => x.bucket),
    ['已記錄偏離', '待修'],
  );
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
  // 分校名（稿選了文山旗艦校、admin@demo 是全部分校）也是資料
  assert.equal(
    normText('切換分校：文山旗艦校', [['文山旗艦校', '{分校}']]),
    normText('切換分校：全部分校', [['全部分校', '{分校}']]),
  );

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

test('包裝層只認控制項：section 與章名同文案時不併章名的字級', async () => {
  const { withWrapper } = await import('./diff.mjs');
  const sec = { key: '>r', kind: 'landmark', tpl: '逾期', own: false, style: { fontSize: '14px' } };
  const big = {
    key: '>r>d',
    parent: '>r',
    kind: 'text',
    tpl: '逾期',
    own: true,
    style: { fontSize: '44px' },
  };
  assert.equal(withWrapper(sec, [sec, big]).style.fontSize, '14px');
});

test('偏離能命中「多出區塊」裡的子孫：拆成自己一列，區塊本身仍待修', async () => {
  const { classify } = await import('./diff.mjs');
  const dev = [{ status: '多', app: 'control:button\\[更多動作\\]$', reason: 'R2', source: 'x' }];
  const row = {
    status: '多',
    kind: 'landmark',
    a6: null,
    app: '>main>landmark:search[帳單搜尋與篩選]',
    detail: 'landmark:search',
    inner: [
      {
        key: '>main>landmark:search[帳單搜尋與篩選]>control:button[更多動作]',
        kind: 'control',
        tpl: '更多動作',
      },
      {
        key: '>main>landmark:search[帳單搜尋與篩選]>control:button[別的]',
        kind: 'control',
        tpl: '別的',
      },
    ],
  };
  const out = classify([row], dev, 1440);
  assert.deepEqual(
    out.map((r) => r.bucket),
    ['待修', '已記錄偏離'],
  );
  assert.match(out[0].detail, /其中 1 個已記錄偏離/);
  assert.match(out[1].app, /更多動作\]$/);
});

test('第三層：比變化量；純數字不比；焦點要宣告才比', async () => {
  const { delta, compareDelta } = await import('./behave.mjs');
  const part = (tpl, attrs = {}) => ({ tpl, kind: 'control', inRows: 0, attrs });
  const snap = (parts, focus = '') => ({ parts, overlays: 0, focus, scroll: 0 });
  // 兩邊點「國三」：A6 用 aria-current、app 用 aria-pressed —— 都算「變成選中」
  const a = delta({
    before: snap([part('國三#')]),
    after: snap([part('國三#', { 'aria-current': 'true' }), part('#')], ''),
  });
  const b = delta({
    before: snap([part('國三#')]),
    after: snap([part('國三#', { 'aria-pressed': 'true' })], '國三#'),
  });
  assert.deepEqual(compareDelta(a, b), []);
  assert.deepEqual(compareDelta(a, b, { checkFocus: true }), ['焦點：A6「」、app「國三#」']);
  // app 沒有選中態 → 報出來
  const c = delta({ before: snap([part('國三#')]), after: snap([part('國三#')]) });
  assert.deepEqual(compareDelta(a, c), ['變成選中／展開：只有 A6「國三#」']);
});

test('連帶：「更多」多出兩項，後面的項目被往下推 → 跟著 R2 歸已記錄偏離', async () => {
  const { diffParts, classify } = await import('./diff.mjs');
  const { DEVIATIONS } = await import('./config.mjs');
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
  const R = 'pop[more]>landmark:popover[]';
  const link = (t, y) => p(`${R}>control:link[${t}]`, 'control', 'link', t, [0, y, 80, 29]);
  const A = [
    p(R, 'landmark', 'popover', '', [0, 0, 300, 100]),
    link('家長管理', 0),
    link('報名進出', 29),
  ];
  const B = [
    p(R, 'landmark', 'popover', '', [0, 0, 300, 158]),
    link('家長管理', 0),
    link('公開申請', 29),
    link('到班打卡', 58),
    link('報名進出', 87),
  ];
  const rows = diffParts({ parts: A }, { parts: B }).map((r) => ({ ...r, pop: 'more' }));
  const out = classify(rows, DEVIATIONS, 1440);
  assert.deepEqual(
    out.filter((r) => r.bucket === '待修'),
    [],
  );
  const moved = out.find((r) => r.status === '位置');
  assert.equal(moved.bucket, '已記錄偏離');
  assert.match(moved.dev.reason, /^連帶：/);
  // 位移超過能解釋的量（多推了 10px）→ 還是待修
  const B2 = B.map((x) => (x.tpl === '報名進出' ? { ...x, box: [0, 97, 80, 29] } : x));
  const out2 = classify(
    diffParts({ parts: A }, { parts: B2 }).map((r) => ({ ...r, pop: 'more' })),
    DEVIATIONS,
    1440,
  );
  assert.equal(out2.find((r) => r.status === '位置').bucket, '待修');
});

test('連帶：自己變大最多推動整個增量；容器變大只在稿上置中時才推動內容', async () => {
  const { diffParts, classify } = await import('./diff.mjs');
  const style = { display: 'block', padding: '0px' };
  const p = (key, kind, tpl, box, text = tpl) => ({
    key,
    parent: key.split('>').slice(0, -1).join('>') || null,
    kind,
    role: kind === 'control' ? 'button' : 'banner',
    tpl,
    text,
    box,
    style,
  });
  const dev = [{ status: '尺寸', detail: '^寬', reason: 'R', source: 's' }];
  // 靠右的帳戶鈕：文字變長變寬 35（資料差），整顆左移 35 → 資料差
  const A = [
    p('>b', 'landmark', '', [0, 0, 1440, 56]),
    p('>b>control:button[帳戶]', 'control', '帳戶', [1075, 8, 163, 40], '林主任'),
  ];
  const B = [
    p('>b', 'landmark', '', [0, 0, 1440, 56]),
    p('>b>control:button[帳戶]', 'control', '帳戶', [1040, 8, 198, 40], 'Demo Admin'),
  ];
  const r = classify(diffParts({ parts: A }, { parts: B }), dev, 1440);
  assert.equal(r.find((x) => x.status === '位置').bucket, '資料差');
  // 左移 36（超過增量＋容差就不行）：36 ≤ 35＋4 仍可解釋；50 不行
  const B2 = B.map((x) => (x.kind === 'control' ? { ...x, box: [1025, 8, 198, 40] } : x));
  assert.equal(
    classify(diffParts({ parts: A }, { parts: B2 }), dev, 1440).find((x) => x.status === '位置')
      .bucket,
    '待修',
  );
});
