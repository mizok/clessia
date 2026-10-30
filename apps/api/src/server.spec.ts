import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * **Node 自架入口起得來**（憲法 c12，#2100）：真的跑 `server.ts`，未登入打 API 要 401。
 *
 * #2100 之前 env 是用 `app.use` 補的，排在 auth 之後，每支 API 都 500 —— 而沒有任何測試發現，
 * 因為其他 spec 都是直接 `app.request(path, init, env)`，根本不經過這個入口。
 *
 * 不碰資料庫（同 index.spec.ts 的不變量）：DATABASE_URL 指向連不到的位址，
 * 沒有 cookie 的請求不該去連它；真的去連了會是 500，這條一樣會紅。
 */
describe('server.ts（Node 自架入口）', () => {
  let child: ChildProcess | null = null;
  afterAll(() => {
    child?.kill();
  });

  it('起得來，未登入打 /api/me 回 401（不是 500）', async () => {
    child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: new URL('..', import.meta.url),
      env: {
        PATH: process.env['PATH'],
        PORT: '0',
        ENVIRONMENT: 'test',
        SUPABASE_URL: 'http://127.0.0.1:1',
        SUPABASE_SECRET_KEY: 'sb_secret_test',
        WEB_URL: 'http://localhost:4200',
        ALLOWED_ORIGINS: '',
        BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
        BETTER_AUTH_URL: 'http://localhost:8787',
        DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:1/postgres',
      },
    });

    // server.ts 起好時印「在 http://localhost:<port> 執行中」；PORT=0 由系統挑
    const port = await new Promise<number>((resolve, reject) => {
      let out = '';
      child!.stdout!.on('data', (chunk: Buffer) => {
        out += chunk.toString();
        const m = out.match(/localhost:(\d+)/);
        if (m) resolve(Number(m[1]));
      });
      child!.stderr!.on('data', (chunk: Buffer) => (out += chunk.toString()));
      child!.on('exit', (code) => reject(new Error(`server.ts 結束了（${code}）：${out}`)));
    });

    const res = await fetch(`http://localhost:${port}/api/me`);
    expect(res.status).toBe(401);
  }, 60_000);
});
