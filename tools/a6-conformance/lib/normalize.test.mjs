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

test('第三層：只給螢幕閱讀器的文字另列、不當成「出現」比', async () => {
  const { delta, compareDelta } = await import('./behave.mjs');
  const snap = (parts) => ({ parts, overlays: 0, focus: '', scroll: 0 });
  const live = { tpl: '符合篩選的#位學生。', kind: 'text', inRows: 0, attrs: {}, sr: true };
  const d = delta({ before: snap([]), after: snap([live]) });
  assert.deepEqual(d.appeared, []);
  assert.deepEqual(d.sr, ['符合篩選的#位學生。']);
  assert.deepEqual(compareDelta(delta({ before: snap([]), after: snap([]) }), d), []);
});

test('多出功能歸組：分頁器整組、選項組依標籤命名、工具列上不同的鈕分開', async () => {
  const { collectExtras } = await import('./extras.mjs');
  const P = (key, kind, role, tpl, box, extra = {}) => ({
    key,
    parent: key.split('>').slice(0, -1).join('>') || null,
    kind,
    role,
    tpl,
    box,
    inRows: 0,
    ...extra,
  });
  const parts = [
    P('>landmark:main[]', 'landmark', 'main', '', [0, 0, 1440, 1000]),
    P('>landmark:main[]>landmark:search[篩選]', 'landmark', 'search', '篩選', [0, 0, 1440, 60]),
    P(
      '>landmark:main[]>landmark:search[篩選]>control:button[更多動作]',
      'control',
      'button',
      '更多動作',
      [1000, 10, 40, 40],
    ),
    P(
      '>landmark:main[]>landmark:search[篩選]>control:button[新增學生]',
      'control',
      'button',
      '新增學生',
      [1050, 10, 100, 40],
    ),
    P(
      '>landmark:main[]>control:button[First Page]',
      'control',
      'button',
      'First Page',
      [600, 900, 40, 40],
      { host: 'p-paginator' },
    ),
    P(
      '>landmark:main[]>control:button[Next Page]',
      'control',
      'button',
      'Next Page',
      [650, 900, 40, 40],
      { host: 'p-paginator' },
    ),
    P('pop[filt]>landmark:dialog[]', 'landmark', 'dialog', '', [0, 0, 300, 300]),
    P('pop[filt]>landmark:dialog[]>text:span[狀態]', 'text', 'span', '狀態', [10, 200, 30, 20]),
    P(
      'pop[filt]>landmark:dialog[]>control:button[在籍]',
      'control',
      'button',
      '在籍',
      [50, 200, 30, 44],
    ),
    P(
      'pop[filt]>landmark:dialog[]>control:button[已停用]',
      'control',
      'button',
      '已停用',
      [90, 200, 40, 44],
    ),
  ];
  const row = (app, extra = {}) => ({ status: '多', app, detail: '', bucket: '待修', ...extra });
  const rows = [
    row('>landmark:main[]>landmark:search[篩選]', {
      detail: '含 2 個子 part',
      inner: parts.slice(2, 4).map((p) => ({ key: p.key, kind: p.kind, tpl: p.tpl })),
    }),
    row('>landmark:main[]>control:button[First Page]'),
    row('>landmark:main[]>control:button[Next Page]'),
    ...['狀態', '在籍', '已停用'].map((t) =>
      row(parts.find((p) => p.tpl === t).key, { pop: 'filt' }),
    ),
  ];
  const { pages } = collectExtras([
    { page: 'students', cfg: {}, widths: [{ width: 1440, tag: 'd', rows, parts, height: 1000 }] },
  ]);
  assert.deepEqual(
    pages[0].features.map((f) => f.name).sort(),
    ['分頁器', '更多動作', '新增學生', '狀態（在籍／已停用）'].sort(),
  );
});

test('多出功能：同型 ≥3 項合成一份資料清單；下拉的內部按鈕不列', async () => {
  const { collectExtras } = await import('./extras.mjs');
  const P = (key, kind, role, tpl, box, extra = {}) => ({
    key,
    parent: key.split('>').slice(0, -1).join('>') || null,
    kind,
    role,
    tpl,
    box,
    inRows: 0,
    ...extra,
  });
  const names = ['王柏翰', '李思妤', '張宇軒'];
  const parts = [
    P('>landmark:main[]', 'landmark', 'main', '', [0, 0, 1440, 1000]),
    ...names.map((n, i) =>
      P(
        `>landmark:main[]>control:button[${n}：看學生檔案]`,
        'control',
        'button',
        `${n}：看學生檔案`,
        [0, 100 + i * 200, 1000, 64],
      ),
    ),
    P(
      '>landmark:main[]>control:button[dropdown trigger]',
      'control',
      'button',
      'dropdown trigger',
      [0, 900, 40, 36],
      { host: 'p-select' },
    ),
  ];
  const rows = parts
    .slice(1)
    .map((p) => ({ status: '多', app: p.key, detail: '', bucket: '待修' }));
  const { pages } = collectExtras([
    { page: 'class', cfg: {}, widths: [{ width: 1440, tag: 'd', rows, parts, height: 1000 }] },
  ]);
  assert.deepEqual(
    pages[0].features.map((f) => f.name),
    ['資料清單 3 項（例：王柏翰：看學生檔案、李思妤：看學生檔案）'],
  );
  assert.ok(pages[0].skipped.some((x) => /下拉／日期元件的內部/.test(x.why)));
});

test('extras.md 每列格數＝表頭欄數；extras.json 欄位齊全', async () => {
  const { collectExtras, extrasMarkdown, extrasJson } = await import('./extras.mjs');
  const P = (key, kind, role, tpl, box) => ({
    key,
    parent: key.split('>').slice(0, -1).join('>') || null,
    kind,
    role,
    tpl,
    box,
    inRows: 0,
  });
  const parts = [
    P('>landmark:main[]', 'landmark', 'main', '', [0, 0, 1440, 1000]),
    P(
      '>landmark:main[]>control:button[匯入家長]',
      'control',
      'button',
      '匯入家長',
      [10, 10, 80, 38],
    ),
  ];
  const rows = [{ status: '多', app: parts[1].key, detail: '', bucket: '待修' }];
  const data = collectExtras([
    {
      page: 'parents',
      cfg: { app: '/admin/parents', a6: 'parents.html' },
      widths: [{ width: 1440, tag: 'd', rows, parts, height: 1000 }],
    },
  ]);
  const md = extrasMarkdown(data, () => ['extras/parents-1-1440.png']);
  const cells = (l) => l.split('|').length;
  const tables = md.split('\n').filter((l) => l.startsWith('|'));
  const header = tables.find((l) => l.startsWith('| 功能'));
  for (const l of tables) assert.equal(cells(l), cells(header), l);
  assert.match(md, /\| 功能 \| 1440/); // 判讀欄真的有值
  const [j] = extrasJson(data, () => ['extras/parents-1-1440.png']);
  assert.deepEqual(
    Object.keys(j).sort(),
    [
      'a6File',
      'appRoute',
      'currentStatus',
      'id',
      'judgment',
      'judgmentNote',
      'name',
      'presentation',
      'section',
      'shots',
      'size',
      'where',
    ].sort(),
  );
  assert.deepEqual(j, {
    ...j,
    id: 'parents-1',
    section: 'parents',
    appRoute: '/admin/parents',
    judgment: '功能',
    size: { d: '80×38' },
    currentStatus: null,
  });
});

test('帳單 gate：全站項收成一條、分頁器依宿主、search 包裝層裡多出的鈕另外拆列', async () => {
  const { classify } = await import('./diff.mjs');
  const { DEVIATIONS, SITE_WIDE } = await import('./config.mjs');
  const rows = [
    {
      status: '樣式',
      kind: 'landmark',
      a6: '>landmark:main[]',
      app: '>landmark:main[]',
      detail: 'backgroundColor rgba(0, 0, 0, 0) → rgb(255, 255, 255)',
    },
    {
      status: '位置',
      kind: 'landmark',
      a6: '>landmark:main[]',
      app: '>landmark:main[]',
      detail: 'Δy -269',
      limit: '結構範圍不同',
    },
    {
      status: '樣式',
      kind: 'text',
      a6: '>x',
      app: '>x',
      detail: 'fontSize 14px → 13px；fontWeight 400 → 500',
    },
    {
      status: '樣式',
      kind: 'text',
      a6: '>y',
      app: '>y',
      detail: 'fontSize 14px → 13px；color rgb(1, 1, 1) → rgb(2, 2, 2)',
    },
    {
      status: '多',
      kind: 'control',
      host: 'p-paginator',
      a6: null,
      app: '>main>control:button[Next Page]',
      detail: '',
    },
    {
      status: '多',
      kind: 'landmark',
      a6: null,
      app: '>main>landmark:search[帳單搜尋與篩選]',
      detail: '含 2 個子 part',
      inner: [
        {
          key: '>main>landmark:search[帳單搜尋與篩選]>control:button[篩選：全部]',
          kind: 'control',
          tpl: '篩選：全部',
        },
        {
          key: '>main>landmark:search[帳單搜尋與篩選]>control:button[更多動作]',
          kind: 'control',
          tpl: '更多動作',
        },
      ],
    },
  ];
  const out = classify(
    rows,
    [
      ...DEVIATIONS,
      { status: '多', app: 'control:button\\[更多動作\\]$', reason: 'R2', source: 's' },
    ],
    1440,
    SITE_WIDE,
  );
  const by = (b) => out.filter((r) => r.bucket === b);
  // main 兩條＋基底字級兩處 → 兩條「全站」，各自記命中數
  assert.deepEqual(
    by('全站')
      .map((r) => r.detail.match(/命中 (\d+)/)[1])
      .sort(),
    ['2', '2'],
  );
  // 只剩字級的樣式列整列拿掉；還有別的差的留下、但拿掉字級那項
  assert.deepEqual(
    out.filter((r) => r.status === '樣式').map((r) => r.detail),
    ['color rgb(1, 1, 1) → rgb(2, 2, 2)'],
  );
  assert.equal(out.find((r) => r.host === 'p-paginator').bucket, '已記錄偏離');
  // search 包裝層是 R7 偏離；裡面的「篩選：全部」沒有出處 → 待修，「⋯」命中 R2 → 偏離
  assert.equal(
    out.find((r) => r.app?.endsWith('landmark:search[帳單搜尋與篩選]')).bucket,
    '已記錄偏離',
  );
  assert.equal(out.find((r) => r.app?.endsWith('[篩選：全部]')).bucket, '待修');
  assert.equal(out.find((r) => r.app?.endsWith('[更多動作]')).bucket, '已記錄偏離');
});

test('配對：稿的 div 列對 app 的 ul／li 列（只差一層 list）', async () => {
  const { matchParts } = await import('./diff.mjs');
  const p = (key) => ({
    key,
    parent: key.split('>').slice(0, -1).join('>') || null,
    kind: key.endsWith('row') ? 'row' : key.endsWith('list') ? 'list' : 'control',
    role: 'x',
    tpl: '',
  });
  // 兩個章節都有列 → 只看最後一段「row」有歧義，要靠「拿掉 list 那層」才配得上
  const A = ['逾期', '到期'].flatMap((g) => [
    p(`>landmark:region[${g}]`),
    p(`>landmark:region[${g}]>row`),
    p(`>landmark:region[${g}]>row>control:link`),
  ]);
  const B = ['逾期', '到期'].flatMap((g) => [
    p(`>landmark:region[${g}]`),
    p(`>landmark:region[${g}]>list`),
    p(`>landmark:region[${g}]>list>row`),
    p(`>landmark:region[${g}]>list>row>control:link`),
  ]);
  const m = matchParts(A, B);
  assert.equal(m.get('>landmark:region[逾期]>row'), '>landmark:region[逾期]>list>row');
  assert.equal(
    m.get('>landmark:region[到期]>row>control:link'),
    '>landmark:region[到期]>list>row>control:link',
  );
});

test('連帶：參考容器 padding 不同，裡面的子項整體位移跟著它；D6 寬度差看完整文字', async () => {
  const { diffParts } = await import('./diff.mjs');
  const st = (padding) => ({ display: 'block', padding });
  const p = (key, kind, tpl, box, style, extra = {}) => ({
    key,
    parent: key.split('>').slice(0, -1).join('>') || null,
    kind,
    role: kind === 'landmark' ? 'region' : 'span',
    tpl,
    text: tpl,
    box,
    style,
    ...extra,
  });
  const A = [
    p('>landmark:region[逾期]', 'landmark', '逾期', [0, 0, 1000, 300], st('32px 0px')),
    p('>landmark:region[逾期]>text:p[#張]', 'text', '#張', [0, 32, 100, 27], st('0px')),
    p('>landmark:region[逾期]>text:span[已收]', 'text', '已收', [500, 32, 114, 20], st('0px'), {
      full: '已收 NT$ 174,100',
    }),
  ];
  const B = [
    p('>landmark:region[逾期]', 'landmark', '逾期', [0, 0, 1000, 268], st('0px')),
    p('>landmark:region[逾期]>text:p[#張]', 'text', '#張', [0, 0, 100, 27], st('0px')),
    p('>landmark:region[逾期]>text:span[已收]', 'text', '已收', [500, 0, 68, 20], st('0px'), {
      full: '已收 NT$ 0',
    }),
  ];
  const rows = diffParts({ parts: A }, { parts: B });
  const pos = rows.find((r) => r.status === '位置' && r.a6.endsWith('[#張]'));
  assert.ok(
    pos.because?.causes?.some((c) => c.style),
    JSON.stringify(pos),
  );
  assert.equal(rows.find((r) => r.a6?.endsWith('[已收]') && /^寬/.test(r.detail)).status, '資料差');
});

test('main 被排除後，章節量跟上方最近已配對 part 的間距（色面高度差不灌進來）', async () => {
  const { diffParts } = await import('./diff.mjs');
  const st = { display: 'block', padding: '0px' };
  const p = (key, kind, tpl, box) => ({
    key,
    parent: key.split('>').slice(0, -1).join('>') || null,
    kind,
    role: kind === 'landmark' ? 'region' : 'search',
    tpl,
    text: tpl,
    box,
    style: st,
  });
  // 稿：色面 0–263、工具列 263–325、main 從 325 起、章節 325；app：main 包住色面（從 56 起），色面高 300、工具列 300–362、章節 362
  const A = [
    p('>landmark:region[摘要]', 'landmark', '摘要', [0, 0, 1440, 263]),
    p('>control:searchbox[搜尋]', 'control', '搜尋', [0, 263, 400, 62]),
    p('>landmark:main[]', 'landmark', '', [0, 325, 1440, 900]),
    p('>landmark:main[]>landmark:region[逾期]', 'landmark', '逾期', [208, 325, 1024, 600]),
  ];
  const B = [
    p('>landmark:main[]', 'landmark', '', [0, 0, 1440, 1300]),
    p('>landmark:main[]>landmark:region[摘要]', 'landmark', '摘要', [0, 0, 1440, 300]),
    p('>landmark:main[]>control:searchbox[搜尋]', 'control', '搜尋', [0, 300, 400, 62]),
    p('>landmark:main[]>landmark:region[逾期]', 'landmark', '逾期', [208, 362, 1024, 600]),
  ];
  const rows = diffParts({ parts: A }, { parts: B });
  // 逾期緊接在工具列下面，兩邊間距都是 0 → 不報位置差（色面多出的 37px 是色面自己的尺寸差）
  assert.equal(
    rows.filter((r) => r.status === '位置' && r.a6.endsWith('[逾期]')).length,
    0,
    JSON.stringify(rows.filter((r) => r.status === '位置')),
  );
});

test('包裝層拆列只拆最上層、按鈕裡的文字不另列', async () => {
  const { classify } = await import('./diff.mjs');
  const W = '>main>landmark:search[篩選]';
  const row = {
    status: '多',
    kind: 'landmark',
    a6: null,
    app: W,
    detail: '',
    inner: [
      { key: `${W}>control:button[篩選：全部]`, kind: 'control', tpl: '篩選：全部' },
      {
        key: `${W}>control:button[篩選：全部]>text:span[篩選：全部]`,
        kind: 'text',
        tpl: '篩選：全部',
      },
      { key: `${W}>control:button[開立帳單]>text:span[開立帳單]`, kind: 'text', tpl: '開立帳單' },
    ],
  };
  const out = classify(
    [row],
    [{ status: '多', app: 'landmark:search\\[[^\\]]*\\]$', reason: 'R7', source: 's' }],
    1440,
  );
  assert.deepEqual(
    out.map((r) => r.app.split('>').at(-1)),
    ['landmark:search[篩選]', 'control:button[篩選：全部]'],
  );
});

test('不帶文案的短後綴不當配對依據；子項位移連帶自待修的 padding 時註明原因', async () => {
  const { matchParts, diffParts, classify } = await import('./diff.mjs');
  const p = (key, kind) => ({
    key,
    parent: key.split('>').slice(0, -1).join('>') || null,
    kind,
    role: kind,
    tpl: '',
  });
  // 真實的形狀：稿的摺疊組列沒配上，它底下的 text:span 不能靠「剩下的 text:span 剛好唯一」配到逾期列裡
  const A2 = [
    p('>landmark:main[]', 'landmark'),
    p('>landmark:main[]>row', 'row'),
    p('>landmark:main[]>row>control:button', 'control'),
    p('>landmark:main[]>row>control:button>text:span', 'text'),
  ];
  const B2 = [
    p('>landmark:main[]', 'landmark'),
    p('>landmark:main[]>landmark:region[逾期]', 'landmark'),
    p('>landmark:main[]>landmark:region[逾期]>list', 'list'),
    p('>landmark:main[]>landmark:region[逾期]>list>row', 'row'),
    p('>landmark:main[]>landmark:region[逾期]>list>row>control:link', 'control'),
    p('>landmark:main[]>landmark:region[逾期]>list>row>control:link>text:span', 'text'),
  ];
  const m2 = matchParts(A2, B2);
  assert.equal(
    m2.has('>landmark:main[]>row>control:button>text:span'),
    false,
    JSON.stringify([...m2]),
  );

  const st = (padding) => ({ display: 'block', padding });
  const q = (key, kind, tpl, box, style) => ({
    key,
    parent: key.split('>').slice(0, -1).join('>') || null,
    kind,
    role: kind === 'landmark' ? 'region' : 'span',
    tpl,
    text: tpl,
    box,
    style,
  });
  const A = [
    q('>landmark:region[逾期]', 'landmark', '逾期', [0, 0, 1000, 300], st('32px 0px')),
    q('>landmark:region[逾期]>text:p[#張]', 'text', '#張', [0, 32, 100, 27], st('0px')),
  ];
  const B = [
    q('>landmark:region[逾期]', 'landmark', '逾期', [0, 0, 1000, 300], st('0px')),
    q('>landmark:region[逾期]>text:p[#張]', 'text', '#張', [0, 0, 100, 27], st('0px')),
  ];
  const out = classify(diffParts({ parts: A }, { parts: B }), [], 1440);
  const pos = out.find((r) => r.status === '位置');
  assert.equal(pos.bucket, '待修');
  assert.match(pos.detail, /連帶自待修「landmark:region\[逾期\] 樣式」/);
});

test('#1593：右邊插進「⋯」把左邊的鈕推走（含 gap）→ 跟著 R2；blockify 不算 display 差；頁面搜尋框框線歸全站', async () => {
  const { diffParts, classify, styleDiffs } = await import('./diff.mjs');
  const { SITE_WIDE } = await import('./config.mjs');
  const st = (extra = {}) => ({ display: 'flex', padding: '0px', columnGap: '16px', ...extra });
  const p = (key, kind, tpl, box, style = st()) => ({
    key,
    parent: key.split('>').slice(0, -1).join('>') || null,
    kind,
    role: kind === 'landmark' ? 'search' : 'button',
    tpl,
    text: tpl,
    box,
    style,
  });
  const W = '>landmark:main[]>landmark:search[帳單搜尋與篩選]';
  const A = [
    p('>landmark:main[]', 'landmark', '', [0, 0, 1440, 900]),
    p('>landmark:main[]>control:button[開立帳單]', 'control', '開立帳單', [1076, 333, 108, 36]),
  ];
  const B = [
    p('>landmark:main[]', 'landmark', '', [0, 0, 1440, 900]),
    p(W, 'landmark', '帳單搜尋與篩選', [160, 320, 1120, 60]),
    p(`${W}>control:button[開立帳單]`, 'control', '開立帳單', [1020, 333, 108, 36]),
    p(`${W}>control:button[更多動作]`, 'control', '更多動作', [1144, 333, 40, 36]),
  ];
  const devs = [
    { status: '多', app: 'landmark:search\\[[^\\]]*\\]$', reason: 'R7', source: 's' },
    { status: '多', app: 'control:button\\[更多動作\\]$', reason: 'R2', source: 's' },
  ];
  const out = classify(diffParts({ parts: A }, { parts: B }), devs, 1440);
  const moved = out.find((r) => r.status === '位置' && r.a6.endsWith('[開立帳單]'));
  assert.equal(moved.bucket, '已記錄偏離', JSON.stringify(moved));

  // blockify：父層是 flex 時 inline-flex 與 flex 等價
  const s = (display) => ({ display, padding: '0px' });
  assert.deepEqual(
    styleDiffs(
      { style: s('inline-flex'), parentDisplay: 'flex' },
      { style: s('flex'), parentDisplay: 'flex' },
    ),
    [],
  );
  assert.equal(
    styleDiffs(
      { style: s('inline-flex'), parentDisplay: 'block' },
      { style: s('flex'), parentDisplay: 'block' },
    ).length,
    1,
  );

  // D7：頁面搜尋框的框線、底色歸全站；頂欄的不算
  const row = (a6) => ({
    status: '樣式',
    kind: 'control',
    a6,
    app: a6,
    detail:
      'backgroundColor rgba(0, 0, 0, 0) → rgb(255, 255, 255)；borderTop none → 1px solid rgb(235, 231, 228)',
  });
  const res = classify(
    [row('>control:searchbox[搜尋帳單]'), row('>landmark:banner[]>control:searchbox[全站搜尋]')],
    [],
    1440,
    SITE_WIDE,
  );
  assert.equal(res.filter((r) => r.status === '樣式').length, 1);
  assert.match(res.find((r) => r.bucket === '全站').detail, /頁面搜尋框/);
});

test('連帶看「夠不夠」：R2 的「⋯」單獨就解釋得了，旁邊有待修的鄰居也不影響', async () => {
  const { classify } = await import('./diff.mjs');
  const rows = [
    {
      status: '多',
      kind: 'control',
      a6: null,
      app: '>w>control:button[更多動作]',
      detail: '',
      bucket: undefined,
    },
    {
      status: '尺寸',
      kind: 'control',
      a6: '>control:searchbox[搜尋]',
      app: '>w>control:searchbox[搜尋]',
      detail: '寬 350→320',
    },
    {
      status: '位置',
      kind: 'control',
      a6: '>control:button[匯出]',
      app: '>w>control:button[匯出]',
      detail: '相對頁面 Δx -56',
      because: {
        needs: { x: 56 },
        causes: [
          { app: '>w>control:button[更多動作]', amt: 56, ax: 'x' },
          { a6: '>control:searchbox[搜尋]', axis: '寬', amt: 30, ax: 'x' },
        ],
      },
    },
    {
      status: '位置',
      kind: 'control',
      a6: '>control:button[開立帳單]',
      app: '>w>control:button[開立帳單]',
      detail: '相對頁面 Δx -80',
      because: {
        needs: { x: 80 },
        causes: [
          { app: '>w>control:button[更多動作]', amt: 56, ax: 'x' },
          { a6: '>control:searchbox[搜尋]', axis: '寬', amt: 30, ax: 'x' },
        ],
      },
    },
  ];
  const out = classify(
    rows,
    [{ status: '多', app: 'control:button\\[更多動作\\]$', reason: 'R2', source: 's' }],
    1440,
  );
  assert.equal(out.find((r) => r.a6?.endsWith('[匯出]')).bucket, '已記錄偏離');
  // 80 要算上待修的搜尋框（30）才夠 → 仍待修，註明連帶自待修
  const k = out.find((r) => r.a6?.endsWith('[開立帳單]'));
  assert.equal(k.bucket, '待修');
  assert.match(k.detail, /連帶自待修「control:searchbox\[搜尋\] 尺寸」/);
});

test('列尾「⋯」的兩種寫法都認成 R2', async () => {
  const { classify } = await import('./diff.mjs');
  const { DEVIATIONS } = await import('./config.mjs');
  const r = (t) => ({
    status: '多',
    kind: 'control',
    a6: null,
    app: `>row>control:button~2`,
    detail: `「${t}」（在多出的區塊裡）`,
  });
  const out = classify(
    [r('更多：張宇軒的帳單動作'), r('出勤測試學生 1 的更多動作'), r('記錄張宇軒的催繳')],
    DEVIATIONS,
    1440,
  );
  assert.deepEqual(
    out.map((x) => x.bucket),
    ['已記錄偏離', '已記錄偏離', '待修'],
  );
});
