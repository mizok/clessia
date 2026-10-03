/**
 * 打卡站的 QR 解碼（#1127）。門口平板不限類型（使用者裁）：
 * 有原生 `BarcodeDetector` 且支援 `qr_code` 就用它（Android／ChromeOS），
 * 否則退到 `jsqr`（iPad Safari）—— **動態 import，只有走後備的裝置才下載那個 chunk**。
 *
 * `jsqr` 的選型理由（零依賴、純 JS、不碰網路）寫在 #1127 的設計留言。
 */

import { InjectionToken } from '@angular/core';

/** 讀不到（這一格沒有 QR、或影像還沒準備好）回 null */
export type QrDecoder = (video: HTMLVideoElement) => Promise<string | null>;

/** `jsqr` 吃的格式；抽出來是為了測試不必真的畫 canvas */
export interface Frame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
export type FrameGrabber = (video: HTMLVideoElement) => Frame;

/** TS 的 lib.dom 還沒有 BarcodeDetector —— 只宣告用得到的部分 */
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
interface BarcodeDetectorCtor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

/** jsqr 那條路縮到這個寬度再解：平板整天開著，整張 1080p 每 250ms 解一次太燙 */
const JSQR_WIDTH = 640;

export async function createQrDecoder(
  win: Window = window,
  grab: FrameGrabber = grabFrame,
): Promise<QrDecoder> {
  const Detector = (win as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  // 只看類別在不在會選錯：有些 Chromium 有類別、格式清單卻是空的
  if (Detector && (await Detector.getSupportedFormats()).includes('qr_code')) {
    const detector = new Detector({ formats: ['qr_code'] });
    return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
  }

  const jsQR = (await import('jsqr')).default;
  return async (video) => {
    if (!video.videoWidth || !video.videoHeight) return null;
    const frame = grab(video);
    return (
      jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })?.data ?? null
    );
  };
}

/**
 * 元件拿解碼器走這個 token，不直接呼叫 `createQrDecoder` —— 測試要換成可控的替身，
 * 而 Angular 的 unit-test builder 會把本地模組打包進去，`vi.mock('./qr-camera')` 換不到。
 */
export const QR_DECODER_FACTORY = new InjectionToken<() => Promise<QrDecoder>>(
  'QR_DECODER_FACTORY',
  { providedIn: 'root', factory: () => () => createQrDecoder() },
);

let canvas: HTMLCanvasElement | null = null;

function grabFrame(video: HTMLVideoElement): Frame {
  const width = Math.min(JSQR_WIDTH, video.videoWidth);
  const height = Math.round((video.videoHeight * width) / video.videoWidth);
  canvas ??= document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * `getUserMedia` 失敗的兩種畫面：
 * - `denied`：使用者或瀏覽器政策擋掉 → 步驟說明＋「重新要求權限」（設計稿 b6 `#denied`）
 * - `unavailable`：沒有鏡頭、被別的 app 占用、不支援（非 HTTPS 時 `mediaDevices` 不存在）→ 請接掃碼槍或用卡號欄
 */
export function cameraErrorState(err: unknown): 'denied' | 'unavailable' {
  const name = (err as { name?: string } | null)?.name;
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable';
}
