// 拋棄式：before/after 截圖並排＋紅色差異圖，印差異像素比例。不進 repo。
import { chromium } from 'playwright';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const dir = process.argv[2];
const b = await chromium.launch(); const p = await b.newPage();
for (const f of readdirSync(dir).filter((f) => f.startsWith('after-')).sort()) {
  const name = f.slice(6, -4);
  const u = (k) => 'data:image/png;base64,' + readFileSync(`${dir}/${k}-${name}.png`).toString('base64');
  const r = await p.evaluate(async ([A, B]) => {
    const load = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = s; });
    const [a, c] = await Promise.all([load(A), load(B)]);
    const w = Math.max(a.width, c.width), h = Math.max(a.height, c.height);
    const cv = document.createElement('canvas'); cv.width = w * 3 + 20; cv.height = h; const x = cv.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, h); x.drawImage(a, 0, 0); x.drawImage(c, w + 10, 0);
    const da = x.getImageData(0, 0, w, h).data, db = x.getImageData(w + 10, 0, w, h).data;
    const out = x.createImageData(w, h); let n = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      const hit = d > 30; if (hit) n++;
      out.data[i] = hit ? 255 : da[i] * 0.3 + 178; out.data[i + 1] = hit ? 0 : da[i + 1] * 0.3 + 178; out.data[i + 2] = hit ? 0 : da[i + 2] * 0.3 + 178; out.data[i + 3] = 255;
    }
    x.putImageData(out, w * 2 + 20, 0);
    return { pct: ((n / (w * h)) * 100).toFixed(2), url: cv.toDataURL('image/png'), wh: `${a.width}x${a.height}→${c.width}x${c.height}` };
  }, [u('before'), u('after')]);
  writeFileSync(`${dir}/sbs-${name}.png`, Buffer.from(r.url.split(',')[1], 'base64'));
  console.log(name.padEnd(18), r.pct + '%', r.wh);
}
await b.close();
