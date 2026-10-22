import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changes, maxJumps } from './jump.mjs';

test('一次跳 300px：maxJump 300，記下哪一幀、哪一塊', () => {
  const r = maxJumps([
    { t: 0, tops: [0, 200] },
    { t: 16, tops: [0, 200] },
    { t: 33, tops: [0, 500] },
  ]);
  assert.equal(r.maxJump, 300);
  assert.equal(r.at, 33);
  assert.equal(r.block, 1);
});

test('滑過去（每幀幾 px）：maxJump 是最大那一步，不是總位移', () => {
  const tops = [200, 230, 260, 280, 295, 300];
  const r = maxJumps(tops.map((y, i) => ({ t: i * 16, tops: [0, y] })));
  assert.equal(r.maxJump, 30);
});

test('區塊剛出現或消失不算跳；兩幀都有才比', () => {
  const r = maxJumps([
    { t: 0, tops: [0, null] },
    { t: 16, tops: [0, 800] },
    { t: 33, tops: [0, null] },
  ]);
  assert.equal(r.maxJump, 0);
});

test('changes 只留有變化的幀', () => {
  const f = [
    { t: 0, tops: [0, 1] },
    { t: 1, tops: [0, 1] },
    { t: 2, tops: [0, 2] },
  ];
  assert.deepEqual(
    changes(f).map((x) => x.t),
    [0, 2],
  );
});
