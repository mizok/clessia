import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contractTags, scopeContractProblems } from './lib/scope-contracts.mjs';

const ok = { reason: 'r', evidence: 'e', ruling: 'x' };
const base = {
  endpoints: [
    'GET /api/x',
    'GET /api/x/:id',
    'GET /api/me/a',
    'GET /api/meals',
    'GET /api/public/p',
  ],
  adminPrefixes: ['/api/x', '/api/me', '/api/meals'],
  tags: contractTags([{ file: 'c.ts', source: '// scope-contract: GET /api/x\n' }]),
  org: [{ prefix: '/api/me', ...ok }],
  baseline: { 'GET /api/x/:id': '缺口', 'GET /api/meals': '債' },
};

test('A30：標記、ORG 前綴、baseline 都認；非 admin 掛載不看', () => {
  assert.deepEqual(scopeContractProblems(base), []);
});

test('A30：新端點三者都不在 → 紅', () => {
  const [p] = scopeContractProblems({ ...base, endpoints: [...base.endpoints, 'POST /api/x'] });
  assert.match(p, /^POST \/api\/x 沒有分校範圍契約/);
});

test('A30：ORG 前綴不吃到同字首的別支（/api/me 不蓋 /api/meals）', () => {
  const problems = scopeContractProblems({ ...base, baseline: { 'GET /api/x/:id': '缺口' } });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /GET \/api\/meals 沒有/);
});

test('A30：baseline 有了契約認領就要刪（只降不升）', () => {
  const tags = contractTags([
    { file: 'c.ts', source: '// scope-contract: GET /api/x\n  // scope-contract: GET /api/x/:id' },
  ]);
  assert.match(scopeContractProblems({ ...base, tags }).join(), /已有契約認領/);
});

test('A30：過期的標記、ORG、baseline 都紅；ORG 少欄位紅', () => {
  const problems = scopeContractProblems({
    ...base,
    tags: contractTags([{ file: 'c.ts', source: '// scope-contract: GET /api/gone' }]),
    org: [
      { prefix: '/api/me', ...ok },
      { endpoint: 'GET /api/gone', reason: 'r' },
    ],
    baseline: { ...base.baseline, 'DELETE /api/gone': '' },
  });
  const text = problems.join('\n');
  assert.match(text, /標記 GET \/api\/gone 對不到/);
  assert.match(text, /GET \/api\/gone 少了 reason/);
  assert.match(text, /org\.json 的 GET \/api\/gone 對不到/);
  assert.match(text, /baseline\.json 的 DELETE \/api\/gone 已不存在/);
  assert.match(text, /GET \/api\/x 沒有/); // 標記被換掉，原本認領的那支掉回來
});
