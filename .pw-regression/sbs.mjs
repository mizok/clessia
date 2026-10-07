import { chromium } from "playwright"; import { readFileSync } from "node:fs";
const [out, w, ...imgs] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +w, height: 400 } });
await p.setContent(`<body style="margin:0;display:flex;gap:24px;align-items:flex-start;font:14px sans-serif;background:#fff">${imgs.map((s) => { const [lab, src] = s.split('='); return `<figure style="margin:0"><figcaption style="padding:6px 0;font-weight:600">${lab}</figcaption><img src="data:image/png;base64,${readFileSync(src).toString("base64")}"></figure>`; }).join('')}</body>`);
await p.waitForTimeout(500);
await p.screenshot({ path: out, fullPage: true }); await b.close();
