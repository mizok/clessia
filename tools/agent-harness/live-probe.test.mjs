import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PROBE_PATHS, classifyProbe } from './lib/live-probe.mjs';

const lists = (status) => PROBE_PATHS.map((path) => ({ path, status }));

test('全部 200 → ok', () => {
  assert.equal(classifyProbe(200, lists(200)).kind, 'ok');
});

test('身分沒問題、有一支列表 400（#1423 的形狀）→ broken，回滾', () => {
  const r = classifyProbe(200, [...lists(200).slice(1), { path: '/api/courses', status: 400 }]);
  assert.equal(r.kind, 'broken');
  assert.deepEqual(r.failed, [{ path: '/api/courses', status: 400 }]);
});

test('/api/me 自己 500 或打不通 → broken（部署把身分那條也弄壞了）', () => {
  assert.equal(classifyProbe(500, lists(200)).kind, 'broken');
  assert.equal(classifyProbe(0, lists(0)).kind, 'broken');
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
