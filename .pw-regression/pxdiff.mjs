// 拋棄式：兩張 png 像素差＋並排圖。node pxdiff.mjs a.png b.png sbs.png
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
const [a, b, o] = process.argv.slice(2);
const A = PNG.sync.read(readFileSync(a)), B = PNG.sync.read(readFileSync(b));
const w = Math.max(A.width, B.width), h = Math.max(A.height, B.height);
const S = new PNG({ width: w * 2 + 10, height: h }); S.data.fill(255);
const put = (I, ox) => PNG.bitblt(I, S, 0, 0, I.width, I.height, ox, 0);
put(A, 0); put(B, w + 10);
let n = 0;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const ia = x < A.width && y < A.height ? (y * A.width + x) * 4 : -1, ib = x < B.width && y < B.height ? (y * B.width + x) * 4 : -1;
  if (ia < 0 || ib < 0) { n++; continue; }
  if (Math.abs(A.data[ia]-B.data[ib]) + Math.abs(A.data[ia+1]-B.data[ib+1]) + Math.abs(A.data[ia+2]-B.data[ib+2]) > 12) n++;
}
writeFileSync(o, PNG.sync.write(S));
console.log(a.split('/').pop(), `${A.width}x${A.height} vs ${B.width}x${B.height}`, (n / (w * h) * 100).toFixed(2) + '%');
