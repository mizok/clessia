// 用 login-link.ts 印出的一次性連結換一份 Playwright storageState（不進版控）。
//   node tools/a6-conformance/login.mjs <magic-link> [state 路徑]
// 連結一次有效：別先用 curl 看它（那樣就用掉了）。產連結時 WEB_URL 用 API 已信任的 origin
// （別席起的 8787 只信任 4200；callbackURL 不被信任會回 403）。
import { chromium } from 'playwright';
import { API_URL, STATE } from './lib/config.mjs';

const [link, out = STATE] = process.argv.slice(2);
if (!link) throw new Error('用法：node login.mjs <magic-link> [state 路徑]');
const b = await chromium.launch();
const ctx = await b.newContext();
// 不跟 302（callback 指向的 web port 可能沒人聽）；Set-Cookie 直接進 context 的 cookie jar
const r = await ctx.request.get(link, { maxRedirects: 0 });
const me = await ctx.request.get(API_URL + '/api/me');
await ctx.storageState({ path: out });
console.log(`verify → ${r.status()}；/api/me → ${me.status()}；state 存到 ${out}`);
await b.close();
if (!me.ok()) process.exit(1);
