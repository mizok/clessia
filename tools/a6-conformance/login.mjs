// 用 login-link.ts 印出的一次性連結換一份 Playwright storageState（不進版控）。
//   node tools/a6-conformance/login.mjs <magic-link> [state 路徑]
// 連結一次有效：別先用 curl 看它（那樣就用掉了）。產連結時 WEB_URL 用 API 已信任的 origin
// （別席起的 8787 只信任 4200；callbackURL 不被信任會回 403）。
import { renameSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';
import { API_URL, STATE } from './lib/config.mjs';

const [link, out = STATE] = process.argv.slice(2);
if (!link) throw new Error('用法：node login.mjs <magic-link> [state 路徑]');
const b = await chromium.launch();
const ctx = await b.newContext();
// 不跟 302（callback 指向的 web port 可能沒人聽）；Set-Cookie 直接進 context 的 cookie jar
const r = await ctx.request.get(link, { maxRedirects: 0 });
const me = await ctx.request.get(API_URL + '/api/me');
// 先寫暫存檔，verify（成功是 302）＋/api/me 200 才蓋過正式的 state —— 失敗時不留空登入態給別席
// （11-13：callbackURL 不被信任 → 403，空 state 蓋掉了共用的 state-parent03.json）
const ok = r.status() < 400 && me.ok();
const tmp = `${out}.tmp`;
await ctx.storageState({ path: tmp });
await b.close();
if (ok) renameSync(tmp, out);
else rmSync(tmp, { force: true });
console.log(
  `verify → ${r.status()}；/api/me → ${me.status()}；${ok ? `state 存到 ${out}` : 'state 沒有寫（原檔不動）'}`,
);
if (!ok) process.exit(1);
