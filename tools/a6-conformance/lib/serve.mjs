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
const WT = path.join(CACHE, 'wt');
/** 每次執行一個 worktree（10-16：同 sha 的兩個 compare 共用時，先收尾的把另一個的 worktree 移掉）。 */
export const wtDir = (sha) =>
  path.join(WT, `${sha}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`);

/**
 * 這次行程起的東西（server、worktree）的收尾。run.mjs 的 finally 照收，但 finally 跑不到的情況也要收（#1962）：
 * route handler 裡沒人接的 rejection（route.fetch 逾時）會讓 Node 直接結束行程、被 SIGINT／SIGTERM 中斷。
 * `exit` 事件在這些情況都會觸發，只能做同步的事 —— 殺 process group、git worktree remove 都是同步的。
 */
const cleanups = new Set();
let hooked = false;
export function track(fn) {
  cleanups.add(fn);
  if (!hooked) {
    hooked = true;
    process.on('exit', () => {
      for (const f of cleanups) {
        try {
          f();
        } catch {
          /* 收一個失敗不擋其他的 */
        }
      }
      cleanups.clear();
    });
    // 訊號預設直接結束、不發 exit 事件：轉成 exit（128＋訊號號碼，跟 shell 的慣例一樣）
    for (const [sig, code] of [
      ['SIGINT', 130],
      ['SIGTERM', 143],
      ['SIGHUP', 129],
    ])
      process.once(sig, () => process.exit(code));
  }
  return () => cleanups.delete(fn);
}

/** 只動工具自己的 wt/ 底下（不碰席位的 .worktrees/labor-*）；git 認不得的就直接刪目錄 */
function removeWorktree(dir, wt = WT) {
  if (path.dirname(dir) !== wt) throw new Error(`不是 compare 的暫存 worktree：${dir}`);
  try {
    git(repo, 'worktree', 'remove', '--force', dir);
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const SERVER_PID = '.a6-server-pid';
const killGroup = (pid) => {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    /* 已經停了 */
  }
};

/**
 * 啟動時清的舊 worktree：超過 maxAgeMs，而且建立它的 compare（目錄名 `<sha>-<pid>-<亂數>` 的 pid）已經不在。
 * 10-16 前的舊命名（只有 sha）沒有 pid 可查，只看年紀。不是 worktree 目錄名的（其他檔案）不碰。
 */
export function staleWorktrees(entries, { now = Date.now(), maxAgeMs = 3600_000, alive }) {
  return entries
    .filter(({ name, mtimeMs }) => {
      const m = /^[0-9a-f]{7,40}(?:-(\d+)-[0-9a-f]+)?$/.exec(name);
      if (!m || now - mtimeMs <= maxAgeMs) return false;
      return !m[1] || !alive(Number(m[1]));
    })
    .map((e) => e.name);
}
const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};
const groupMembers = (pgid) =>
  sh('ps', ['-A', '-o', 'pid=,pgid='])
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter(([, g]) => g === pgid)
    .map(([pid]) => pid);
const cwdOf = (pid) =>
  sh('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
    .split('\n')
    .find((l) => l.startsWith('n'))
    ?.slice(1) ?? null;
const startOf = (pid) => Date.parse(sh('ps', ['-o', 'lstart=', '-p', String(pid)]).trim());

/**
 * 記下的 pid 那一組還是當時在這個 worktree 裡起的嗎（#2146）。行程早就結束的話 pid／pgid 可能已經被重用
 * （別席的 wrangler 迴圈、vitest 的 process group），直接 kill(-pid) 會打掉別人的東西。
 * 成立條件：那一組裡至少一個行程的 cwd 在這個 worktree 裡，而且是記下 pid（`sinceMs`）之後才啟動的。
 */
export function ownsGroup(
  pgid,
  dir,
  sinceMs,
  { members = groupMembers, cwd = cwdOf, start = startOf } = {},
) {
  return members(pgid).some((pid) => {
    const at = cwd(pid);
    return (
      at != null && (at === dir || at.startsWith(dir + path.sep)) && start(pid) >= sinceMs - 60_000
    );
  });
}

/**
 * 清掉崩潰留下的：先殺它當時起的 server（建立它的 compare 已經不在，沒人會收），再移 worktree。
 * 對不上（pid 已經是別人的）就只移 worktree、不送訊號。
 */
export function sweepStale({ wt = WT, kill = killGroup, owns = ownsGroup } = {}) {
  if (!fs.existsSync(wt)) return;
  const entries = fs
    .readdirSync(wt, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, mtimeMs: fs.statSync(path.join(wt, d.name)).mtimeMs }));
  for (const name of staleWorktrees(entries, { alive: pidAlive })) {
    const dir = path.join(wt, name);
    const pidFile = path.join(dir, SERVER_PID);
    if (fs.existsSync(pidFile)) {
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      if (pid && owns(pid, fs.realpathSync(dir), fs.statSync(pidFile).mtimeMs)) kill(pid);
      else if (pid) console.warn(`  ${name}：記下的 server pid ${pid} 已經不是它的，不送訊號`);
    }
    removeWorktree(dir, wt);
    console.warn(`  清掉舊的暫存 worktree：${name}`);
  }
  git(repo, 'worktree', 'prune');
}
let swept = false;

// 新 worktree 沒有 nx／esbuild 快取，冷編譯實測超過 300 秒（10-15）；給 600 秒
export async function startWeb(ref, { timeoutMs = 600_000 } = {}) {
  if (!swept) {
    swept = true;
    sweepStale();
  }
  const sha = resolveRef(ref);
  const dir = wtDir(sha);
  git(repo, 'worktree', 'add', '-q', '--detach', dir, sha);
  let child;
  const kill = () => child && killGroup(child.pid);
  // 從這裡起不管怎麼結束都要收：server 整組殺、worktree 移掉
  const untrack = track(() => {
    kill();
    removeWorktree(dir);
  });
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
  let port, log;
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
    // 崩潰留下的 worktree 下次啟動時清，要知道當時起的 server 是哪一組
    fs.writeFileSync(path.join(dir, SERVER_PID), String(child.pid));
  };
  const stop = async () => {
    kill();
    await new Promise((r) => setTimeout(r, 1500));
    removeWorktree(dir);
    untrack();
  };
  try {
    await spawnWeb(4310);
  } catch (e) {
    await stop();
    throw e;
  }
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > timeoutMs) {
      await stop();
      throw new Error(`${ref}（${sha}）的 web 起不來，log：${log}`);
    }
    const url = `http://localhost:${port}`;
    const ok = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false);
    const text = fs.readFileSync(log, 'utf8');
    if (buildFailed(text)) {
      await stop();
      throw new Error(`${ref}（${sha}）的 web 編譯失敗，log：${log}`);
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
