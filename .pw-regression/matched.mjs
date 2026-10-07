import { chromium } from 'playwright';
const [url, trigger, target, prop] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext({ storageState: '../state-admin.json', viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
if (trigger !== '-') { await p.locator(trigger).first().click(); await p.waitForTimeout(500); }
const cdp = await ctx.newCDPSession(p);
await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: target });
const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
console.log('inline:', JSON.stringify((m.inlineStyle?.cssProperties || []).filter(c => c.name.includes(prop)).map(c => c.value)));
for (const r of m.matchedCSSRules) { const ps = r.rule.style.cssProperties.filter(c => c.name.includes(prop) && c.value); if (ps.length) console.log((r.rule.layers || []).map(l => l.text).join('/') || '(unlayered)', '|', r.rule.selectorList.text.slice(0, 90), '|', ps.map(c => c.name + ':' + c.value).join('; ')); }
await b.close();
