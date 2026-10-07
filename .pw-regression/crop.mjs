import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const [src, out, x, y, w, h] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.setContent(`<body style="margin:0"><img src="data:image/png;base64,${readFileSync(src).toString('base64')}" style="position:absolute;left:-${x}px;top:-${y}px">`);
await p.screenshot({ path: out }); await b.close();
