import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PROBE_PATHS, RETRIES, RETRY_INTERVAL_MS, classifyProbe } from './lib/live-probe.mjs';

const lists = (status) => PROBE_PATHS.map((path) => ({ path, status }));

test('全部 200 → ok', () => {
  assert.equal(classifyProbe(200, lists(200)).kind, 'ok');
});

test('me 200、列表 400（#1423 的形狀：select 沒選 order 的欄位）→ broken，回滾；404 也一樣', () => {
  const r = classifyProbe(200, [...lists(200).slice(1), { path: '/api/courses', status: 400 }]);
  assert.equal(r.kind, 'broken');
  assert.deepEqual(r.failed, [{ path: '/api/courses', status: 400 }]);
  assert.equal(
    classifyProbe(200, [...lists(200).slice(1), { path: '/api/courses', status: 404 }]).kind,
    'broken',
  );
});

test('/api/me 自己 500（部署把中介層弄壞）→ broken，回滾', () => {
  assert.equal(classifyProbe(500, lists(200)).kind, 'broken');
  assert.equal(
    classifyProbe(200, [...lists(200).slice(1), { path: '/api/staff', status: 502 }]).kind,
    'broken',
  );
});

// 審核席 #2276：runner 的網路問題（逾時、DNS、連線被拒）不能把好好的部署退掉
test('打不通（0：逾時／DNS／連線錯）→ unknown，紅燈但不回滾', () => {
  assert.equal(classifyProbe(0, lists(0)).kind, 'unknown');
  assert.equal(
    classifyProbe(200, [...lists(200).slice(1), { path: '/api/courses', status: 0 }]).kind,
    'unknown',
  );
});

test('真的 HTTP 錯誤跟打不通混在一起 → broken（伺服器回了錯，那是真訊號）', () => {
  assert.equal(
    classifyProbe(200, [...lists(0).slice(1), { path: '/api/courses', status: 500 }]).kind,
    'broken',
  );
});

// 最重要的一條：憑證壞掉不能被當成部署壞掉 —— 否則 cookie 一過期就把好好的部署退掉
test('401／403（cookie 過期、帳號停用、權限不足）→ auth，不回滾；即使列表也失敗', () => {
  assert.equal(classifyProbe(401, lists(401)).kind, 'auth');
  assert.equal(
    classifyProbe(200, [...lists(200).slice(1), { path: '/api/staff', status: 403 }]).kind,
    'auth',
  );
  assert.equal(classifyProbe(401, lists(500)).kind, 'auth');
});

test('探針不打要細部權限才讀得到的端點（唯讀帳號會 403，誤判成憑證問題）', () => {
  assert.ok(!PROBE_PATHS.some((p) => p.startsWith('/api/invoices')));
});

test('重試：不是 200 的再打 2 次、間隔 5 秒才定案（計畫席 11-04 裁）', () => {
  assert.equal(RETRIES, 2);
  assert.equal(RETRY_INTERVAL_MS, 5_000);
});
