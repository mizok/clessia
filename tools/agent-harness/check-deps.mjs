#!/usr/bin/env node
/**
 * 依賴有沒有裝：根與 apps/api 是**兩套獨立 lock**（#2541）。根 `npm ci` 不會裝 apps/api，
 * 缺 `pg` 會讓 harness 紅、而且紅得像是程式碼的問題。這支只看「裝了沒」，缺的直接印出該跑的指令。
 * 掛在 `npm run harness` 最前面；缺依賴 exit 1，其他什麼都不檢查。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// npm ci 完成後一定會留下 node_modules/.package-lock.json（symlink 過來的 worktree 也成立）
const suites = [
  { dir: '.', label: '根' },
  { dir: 'apps/api', label: 'apps/api（獨立 lock）' },
];

const missing = suites.filter((s) => !existsSync(join(root, s.dir, 'node_modules/.package-lock.json')));

for (const s of missing) {
  console.error(`✗ ${s.label} 依賴未安裝 → (cd ${s.dir} && npm ci)`);
}
if (missing.length) process.exit(1);
console.log('✓ 依賴已安裝（根、apps/api）');
