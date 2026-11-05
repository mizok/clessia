// UX 走查用的常駐 Playwright：POST /new {state,width,height,name} 開頁；POST /run?name= body=JS（async，可用 page）
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_FROM + '/');
const { chromium } = require('playwright');
import http from 'node:http';
const API = process.env.UX_WALK_API ?? 'http://localhost:8796', BUILT = 'http://localhost:8787';
const b = await chromium.launch();
const pages = {};
const S = new URL('./shots/', import.meta.url).pathname; await import('node:fs').then((fs) => fs.mkdirSync(S, { recursive: true }));
async function mk({ state, width, height = width < 500 ? 780 : 900, name, role }) {
  const ctx = await b.newContext({ viewport: { width, height }, storageState: state, isMobile: width < 500, hasTouch: width < 500, deviceScaleFactor: 1 });
  await ctx.route(BUILT + '/**', async (r) => { try { await r.fulfill({ response: await r.fetch({ url: r.request().url().replace(BUILT, API) }) }); } catch { await r.abort('failed').catch(() => {}); } });
  if (role) await ctx.addInitScript((r) => { try { localStorage.setItem('clessia:active-role', r); } catch {} }, role);
  const page = await ctx.newPage();
  page.log = [];
  page.on('pageerror', (e) => page.log.push('ERR ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) page.log.push(r.status() + ' ' + r.request().method() + ' ' + r.url().replace(BUILT, '')); });
  page.shot = async (f, full = false) => { await page.screenshot({ path: S + f + '.png', fullPage: full }); return S + f + '.png'; };
  pages[name] = page;
}
http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const u = new URL(req.url, 'http://x');
  try {
    let out;
    if (u.pathname === '/new') { await mk(JSON.parse(body)); out = 'ok'; }
    else { const page = pages[u.searchParams.get('name')]; const fn = new Function('page', `return (async()=>{${body}})()`); out = await fn(page); if (page.log.length) { out = { out, log: page.log.splice(0) }; } }
    res.end(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
  } catch (e) { res.end('EXC ' + e.message.slice(0, 800)); }
}).listen(9496, '127.0.0.1');
console.log('driver ready');
