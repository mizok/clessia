// compare 用：把某個 git ref 的 web 起在一個臨時 port 上。臨時 worktree（detached）共用這份 repo 的
// node_modules，量完就收（停 server、移掉 worktree）。只起 web；API 用 A6_API_URL（兩邊共用，表上會註明）。
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const git = (cwd, ...a) =>
  execFileSync('git', a, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 << 20, // package-lock 將近 1MB，預設上限會爆
  }).trim();
const repo = git(import.meta.dirname, 'rev-parse', '--show-toplevel');

// IPv4、IPv6 各試一次：vite 聽在 [::1] 時，不指定 host 的 listen 照樣成功（10-16 base 占 ::1:4310，head 又挑 4310）
const taken = (port, host) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (e) => resolve(e.code !== 'EADDRNOTAVAIL')); // 機器沒有 IPv6 不算占用
    s.listen(port, host, () => s.close(() => resolve(false)));
  });
export async function freePort(from) {
  for (let p = from; ; p++)
    if (!(await taken(p, '127.0.0.1')) && !(await taken(p, '::1'))) return p;
}

/** origin 與本機同名分支各一顆：挑新的（本機有未推的 commit 時用本機，本機久沒更新時用 origin），分叉就報錯。 */
export function pickNewer(remote, local, isAncestor) {
  if (!remote || !local || remote === local) return remote ?? local;
  if (isAncestor(remote, local)) return local;
  if (isAncestor(local, remote)) return remote;
  throw new Error(`origin（${remote}）與本機（${local}）分叉了，請直接給 sha`);
}

/** ref → sha（sha、origin/<ref>、本機 <ref> 都試；分支名兩邊都有時見 pickNewer）。 */
export function resolveRef(ref) {
  git(repo, 'fetch', '-q', 'origin');
  const sha = (r) => {
    try {
      return git(repo, 'rev-parse', '--verify', '--short', `${r}^{commit}`);
    } catch {
      return null;
    }
  };
  const anc = (a, b) => {
    try {
      return (git(repo, 'merge-base', '--is-ancestor', a, b), true);
    } catch {
      return false;
    }
  };
  const got = pickNewer(sha(`origin/${ref}`), sha(ref), anc);
  if (!got) throw new Error(`找不到 ref：${ref}`);
  return got;
}

/** nx serve 的 ready line（`➜  Local:`）帶顏色碼：`Local\x1b[22m:`，先去色再比（10-16 notify 席兩次等滿 600 秒） */
const plain = (log) => log.replace(/\x1b\[[\d;]*m/g, '');
export const isReady = (log, port) =>
  (port ? new RegExp(`Local:\\s+http://localhost:${port}/`) : /Local:/).test(plain(log));
/** 挑 port 和 nx 開始聽之間有空檔，兩個 compare 同時起會挑到同一個 → 換下一個重起 */
export const portTaken = (log) => /Port \d+ is already in use/.test(plain(log));
/** 編譯錯誤：nx 照樣印 ready line，不擋的話會量到 vite 的錯誤畫面（10-16 head 80479203 缺 altcha） */
export const buildFailed = (log) => /✘ \[ERROR\]/.test(plain(log));

/** 這個 ref 的 package-lock 跟共用 node_modules（本 repo 工作目錄）那份一樣嗎。 */
export const lockMatches = (
  sha,
  shared = fs.readFileSync(path.join(repo, 'package-lock.json'), 'utf8'),
) => git(repo, 'show', `${sha}:package-lock.json`) === shared.trim();

const CACHE = path.join(os.homedir(), '.cache/clessia-a6-conformance');
/** 每次執行一個 worktree（10-16：同 sha 的兩個 compare 共用時，先收尾的把另一個的 worktree 移掉）。 */
export const wtDir = (sha) =>
  path.join(CACHE, 'wt', `${sha}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`);

// 新 worktree 沒有 nx／esbuild 快取，冷編譯實測超過 300 秒（10-15）；給 600 秒
export async function startWeb(ref, { timeoutMs = 600_000 } = {}) {
  const sha = resolveRef(ref);
  const dir = wtDir(sha);
  git(repo, 'worktree', 'add', '-q', '--detach', dir, sha);
  const nm = path.join(dir, 'node_modules');
  if (lockMatches(sha)) fs.symlinkSync(path.join(repo, 'node_modules'), nm);
  else {
    // 依賴跟共用的不同：自己裝（冷裝幾分鐘）
    const ilog = path.join(CACHE, `install-${path.basename(dir)}.log`);
    console.warn(
      `  ${ref}（${sha}）的 package-lock 跟共用的 node_modules 不同 → npm ci（log：${ilog}）`,
    );
    const ifd = fs.openSync(ilog, 'w');
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], {
      cwd: dir,
      stdio: ['ignore', ifd, ifd],
    });
  }
  let port, log, child;
  const spawnWeb = async (from) => {
    port = await freePort(from);
    // log 放在 worktree 外：失敗時 worktree 會被收掉，log 要留著查。檔名帶這次的 worktree，同時跑不互蓋
    log = path.join(CACHE, `serve-${path.basename(dir)}-${port}.log`);
    const fd = fs.openSync(log, 'w');
    child = spawn('npx', ['nx', 'serve', 'web', '--port', String(port)], {
      cwd: dir,
      detached: true, // 自己一個 process group：收的時候整組殺，不留 esbuild／vite 孤兒
      stdio: ['ignore', fd, fd],
      env: { ...process.env, NX_DAEMON: 'false' },
    });
  };
  const kill = () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* 已經停了 */
    }
  };
  await spawnWeb(4310);
  const stop = async ({ keep = false } = {}) => {
    kill();
    await new Promise((r) => setTimeout(r, 1500));
    if (keep) return;
    try {
      git(repo, 'worktree', 'remove', '--force', dir);
    } catch {
      /* 移不掉就留著；只會是自己這次的 */
    }
  };
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > timeoutMs) {
      await stop({ keep: true });
      throw new Error(`${ref}（${sha}）的 web 起不來，log：${log}（worktree 留在 ${dir} 供查）`);
    }
    const url = `http://localhost:${port}`;
    const ok = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false);
    const text = fs.readFileSync(log, 'utf8');
    if (buildFailed(text)) {
      await stop({ keep: true });
      throw new Error(`${ref}（${sha}）的 web 編譯失敗，log：${log}（worktree 留在 ${dir} 供查）`);
    }
    if (portTaken(text)) {
      kill();
      await spawnWeb(port + 1);
      continue;
    }
    if (ok && isReady(text, port)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const url = `http://localhost:${port}`;
  console.warn(`  ${ref}（${sha}）→ ${url}`);
  return { url, sha, stop };
}
