// compare 用：把某個 git ref 的 web 起在一個臨時 port 上。臨時 worktree（detached）共用這份 repo 的
// node_modules，量完就收（停 server、移掉 worktree）。只起 web；API 用 A6_API_URL（兩邊共用，表上會註明）。
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const repo = git(import.meta.dirname, 'rev-parse', '--show-toplevel');

const freePort = (from) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(freePort(from + 1)));
    s.listen(from, () => s.close(() => resolve(from)));
  });

/** ref → sha（先試 origin/<ref>，再試本地）。 */
export function resolveRef(ref) {
  git(repo, 'fetch', '-q', 'origin');
  // 分支名先用 origin 的（本地同名分支可能很久沒更新）；sha 兩個都試得到
  for (const r of [`origin/${ref}`, ref]) {
    try {
      return git(repo, 'rev-parse', '--verify', '--short', `${r}^{commit}`);
    } catch {
      /* 換下一個 */
    }
  }
  throw new Error(`找不到 ref：${ref}`);
}

/** nx serve 的 ready line（`➜  Local:`）帶顏色碼：`Local\x1b[22m:`，先去色再比（10-16 notify 席兩次等滿 600 秒） */
export const isReady = (log) => /Local:/.test(log.replace(/\x1b\[[\d;]*m/g, ''));

// 新 worktree 沒有 nx／esbuild 快取，冷編譯實測超過 300 秒（10-15）；給 600 秒
export async function startWeb(ref, { timeoutMs = 600_000 } = {}) {
  const sha = resolveRef(ref);
  const dir = path.join(os.homedir(), '.cache/clessia-a6-conformance/wt', sha);
  if (!fs.existsSync(dir)) {
    git(repo, 'worktree', 'add', '-q', '--detach', dir, sha);
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'));
  }
  const port = await freePort(4310);
  // log 放在 worktree 外：失敗時 worktree 會被收掉，log 要留著查
  const log = path.join(os.homedir(), '.cache/clessia-a6-conformance', `serve-${sha}-${port}.log`);
  const fd = fs.openSync(log, 'w');
  const child = spawn('npx', ['nx', 'serve', 'web', '--port', String(port)], {
    cwd: dir,
    detached: true, // 自己一個 process group：收的時候整組殺，不留 esbuild／vite 孤兒
    stdio: ['ignore', fd, fd],
    env: { ...process.env, NX_DAEMON: 'false' },
  });
  const url = `http://localhost:${port}`;
  const stop = async ({ keep = false } = {}) => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* 已經停了 */
    }
    await new Promise((r) => setTimeout(r, 1500));
    if (keep) return;
    try {
      git(repo, 'worktree', 'remove', '--force', dir);
    } catch {
      /* 留著也無害，下次同 sha 直接重用 */
    }
  };
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > timeoutMs) {
      await stop({ keep: true });
      throw new Error(`${ref}（${sha}）的 web 起不來，log：${log}（worktree 留在 ${dir} 供查）`);
    }
    const ok = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok && isReady(fs.readFileSync(log, 'utf8'))) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.warn(`  ${ref}（${sha}）→ ${url}`);
  return { url, sha, stop };
}
