// 從 tools/app-icon/logo.png（正方形 master）產生 PWA／favicon 全套。
// 用法：node tools/app-icon/make.mjs   （依賴 node_modules 既有的 sharp，不另裝）
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'logo.png');
const out = join(here, '..', '..', 'apps', 'web', 'public');
const icons = join(out, 'assets', 'icons');
await mkdir(icons, { recursive: true });

const meta = await sharp(src).metadata();
const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true });
const px = (x, y) => {
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const bg = px(4, 4);
// 內容外框：跟底色差超過門檻的像素
let x0 = info.width, x1 = 0, y0 = info.height, y1 = 0;
for (let y = 0; y < info.height; y += 2)
  for (let x = 0; x < info.width; x += 2) {
    const c = px(x, y);
    if (Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) > 60) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
const pct = (v, t) => Math.round((100 * v) / t);
console.log(`master ${meta.width}x${meta.height} 底色 ${hex(bg)}；內容 x ${pct(x0, info.width)}–${pct(x1, info.width)}% y ${pct(y0, info.height)}–${pct(y1, info.height)}%`);

const png = (size, file) => sharp(src).resize(size, size, { fit: 'cover' }).png({ compressionLevel: 9, palette: true }).toFile(join(icons, file));
await Promise.all([
  png(512, 'icon-512.png'),
  png(192, 'icon-192.png'),
  png(512, 'icon-maskable-512.png'), // 內容在中央 ~45%，落在 maskable 安全區（80%）內，直接用同一張
  png(192, 'icon-maskable-192.png'),
  png(180, 'apple-touch-icon.png'),
]);

// favicon.ico：把 16／32／48 的 PNG 包進 ICO（ICO 允許 PNG 內嵌）
const sizes = [16, 32, 48];
const blobs = await Promise.all(sizes.map((s) => sharp(src).resize(s, s).png({ compressionLevel: 9, palette: true }).toBuffer()));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
const dir = Buffer.alloc(16 * sizes.length);
let offset = 6 + dir.length;
blobs.forEach((b, i) => {
  const o = i * 16, s = sizes[i];
  dir.writeUInt8(s === 256 ? 0 : s, o); dir.writeUInt8(s === 256 ? 0 : s, o + 1);
  dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
  dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(b.length, o + 8); dir.writeUInt32LE(offset, o + 12);
  offset += b.length;
});
await writeFile(join(out, 'favicon.ico'), Buffer.concat([header, dir, ...blobs]));
console.log('寫出：icon-192/512、maskable 192/512、apple-touch-icon 180、favicon.ico(16/32/48)');
