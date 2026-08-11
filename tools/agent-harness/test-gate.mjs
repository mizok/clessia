#!/usr/bin/env node
/**
 * 測試結果的基線比對。吃 vitest/nx 的輸出（stdin），只在**新增**的失敗上擋人。
 *
 *   <test output> | node tools/agent-harness/test-gate.mjs            # --check：有新紅燈 → exit 1
 *   <test output> | node tools/agent-harness/test-gate.mjs --write     # 把當下的失敗記成基線
 *
 * 為什麼要基線：這個 repo 在 harness 建立之前就有紅燈。一個「非全綠不可」的收工閘門會在每一
 * 輪都擋人，而擋的是跟這輪改動無關的東西 —— 那種閘門的下場是被關掉，等於沒有。基線讓閘門
 * 只回答一個問題：「這一輪有沒有弄壞新的東西？」
 *
 * 基線是**債務**不是豁免：基線裡的項目開始通過時會提示移除，但不擋人（fvg 的 audit allowlist
 * 也是 stale entries non-fatal），因為為了逼人清乾淨而擋住無關的工作同樣是本末倒置。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = join(ROOT, 'tools/agent-harness/test-baseline.json');

/** vitest 失敗行長這樣：` FAIL  web apps/web/…/x.spec.ts > Suite > case` */
export function failingSpecs(text) {
  const specs = new Set();
  for (const line of text.split('\n')) {
    if (!/\bFAIL\b/.test(line)) continue;
    const match = /([\w./-]+\.spec\.ts)/.exec(line);
    if (match) specs.add(match[1]);
  }
  return [...specs].sort();
}

/** 回傳 { regressions, recovered }；純函式，方便測試。 */
export function compareToBaseline(failing, knownFailing) {
  const known = new Set(knownFailing);
  return {
    regressions: failing.filter((spec) => !known.has(spec)),
    recovered: [...known].filter((spec) => !failing.includes(spec)).sort(),
  };
}

function main() {
  const mode = process.argv.includes('--write') ? 'write' : 'check';
  const failing = failingSpecs(readFileSync(0, 'utf8'));

  if (mode === 'write') {
    const payload = {
      note: '收工閘門的已知紅燈基線。清掉一支就從這裡移除一支；清空 knownFailing 後閘門回到「非全綠不可」。重錄：npm run test:baseline',
      recorded: new Date().toISOString().slice(0, 10),
      knownFailing: failing,
    };
    writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`✓ 已記錄 ${failing.length} 支已知紅燈為基線`);
    return;
  }

  const baseline = existsSync(BASELINE)
    ? JSON.parse(readFileSync(BASELINE, 'utf8'))
    : { knownFailing: [] };
  const { regressions, recovered } = compareToBaseline(failing, baseline.knownFailing ?? []);

  if (recovered.length > 0) {
    console.error(`ℹ 基線裡有 ${recovered.length} 支已經恢復，可以從 test-baseline.json 移除：`);
    for (const spec of recovered) console.error(`  - ${spec}`);
  }

  if (regressions.length > 0) {
    console.error(`✖ 這一輪弄壞了 ${regressions.length} 支測試：`);
    for (const spec of regressions) console.error(`  - ${spec}`);
    process.exit(1);
  }

  if (failing.length > 0) {
    console.error(`⚠ 仍有 ${failing.length} 支已知紅燈（在基線內，不擋收工）`);
  }
}

if (process.argv[1]?.endsWith('test-gate.mjs')) main();
