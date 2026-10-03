import jsQR from 'jsqr';
import QRCode from 'qrcode';

/**
 * #1127：卡片用 `qrcode`（`angularx-qrcode` 底下那個）產生、機台用 `jsqr` 讀 ——
 * 兩個不同的函式庫，這裡用真的（不 mock）走一次「學生 id → QR 矩陣 → 影像 → 解回來」。
 * 鏡頭與 `BarcodeDetector` 測不到（jsdom 沒有），iPad 真機要人工驗；這條守的是格式本身對得上。
 */
it('學生 id 印成 QR 再用 jsqr 讀回來，字串原樣', () => {
  const studentId = '8a75bc76-7927-41e3-af0b-e2b019616120';
  const { modules } = QRCode.create(studentId, { errorCorrectionLevel: 'M' });
  const scale = 6;
  const quiet = 4; // 規格要求的四格白邊
  const side = (modules.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) {
      if (!modules.get(y, x)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((y + quiet) * scale + dy) * side + (x + quiet) * scale + dx;
          data.fill(0, px * 4, px * 4 + 3);
        }
      }
    }
  }

  expect(jsQR(data, side, side)?.data).toBe(studentId);
});
