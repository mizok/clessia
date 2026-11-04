#!/usr/bin/env node
/**
 * 部署後帶身分的列表探針（#1435）。判斷規則在 `lib/live-probe.mjs`。
 *
 *   API_URL=https://… PROBE_COOKIE='__Secure-better-auth.session_token=…' node tools/agent-harness/live-probe.mjs
 *
 * 寫 `result=ok|skipped|auth|broken|unknown` 到 $GITHUB_OUTPUT；結束碼一律 0，紅不紅、回不回滾由 workflow 判。
 * 沒設 PROBE_COOKIE（自架、還沒建探針帳號）→ skipped＋notice，不紅燈（c12）。
 */
import { appendFileSync } from 'node:fs';

import { PROBE_PATHS, RETRIES, RETRY_INTERVAL_MS, classifyProbe } from './lib/live-probe.mjs';

const out = (line) =>
  process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
const summary = (line) =>
  process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);

const cookie = process.env.PROBE_COOKIE;
const base = (process.env.API_URL ?? '').replace(/\/$/, '');
if (!cookie) {
  console.log('::notice::PROBE_COOKIE 未設定 —— 略過帶身分的探針（自架或還沒建探針帳號）');
  out('result=skipped');
  process.exit(0);
}
if (!base) {
  console.error('API_URL 未設定');
  process.exit(1);
}

async function status(path) {
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { cookie },
      signal: AbortSignal.timeout(15_000),
    });
    return res.status;
  } catch {
    return 0; // 打不通
  }
}

// 剛部署完的 Worker 偶爾第一下不穩：不是 200 的再打 RETRIES 次、每次隔 RETRY_INTERVAL_MS，用最後一次定案
async function settled(path) {
  let s = await status(path);
  for (let i = 0; i < RETRIES && s !== 200; i++) {
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
    s = await status(path);
  }
  return s;
}

const me = await settled('/api/me');
const lists = [];
for (const path of PROBE_PATHS) lists.push({ path, status: await settled(path) });
const { kind, failed } = classifyProbe(me, lists);

out(`result=${kind}`);
summary(`### 帶身分的列表探針：${kind}`);
for (const r of [{ path: '/api/me', status: me }, ...lists])
  summary(`- \`${r.path}\` → ${r.status || '打不通'}`);
if (kind === 'unknown') {
  summary(
    '> 只有打不通（逾時、DNS、連線錯）：多半是 runner 的網路，**不回滾**。重跑這個 job 確認。',
  );
}
if (kind === 'auth') {
  summary(
    '> 401／403 是探針憑證的問題（cookie 過期、帳號停用、權限不足），**不回滾**。換 PROBE_COOKIE 的方法見 #1435 的 PR 描述。',
  );
}
for (const r of failed) console.log(`${r.path} → ${r.status || '打不通'}`);
