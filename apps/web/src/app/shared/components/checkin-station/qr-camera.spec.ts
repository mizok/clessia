import { vi } from 'vitest';

import { cameraErrorState, createQrDecoder } from './qr-camera';

const jsQRMock = vi.fn();
vi.mock('jsqr', () => ({ default: (...args: unknown[]) => jsQRMock(...args) }));

/**
 * #1127：門口平板不限類型（使用者裁）—— Android／ChromeOS 有原生 `BarcodeDetector`，
 * iPad Safari 沒有，退到 `jsqr`。**只看類別存不存在會選錯**：有些 Chromium 有這個類別、
 * 但支援格式清單是空的。
 */
describe('createQrDecoder', () => {
  const video = { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement;

  beforeEach(() => jsQRMock.mockReset());

  function nativeWindow(formats: string[], rawValue = 'stu-native') {
    const detect = vi.fn().mockResolvedValue([{ rawValue }]);
    class FakeDetector {
      static getSupportedFormats = vi.fn().mockResolvedValue(formats);
      detect = detect;
    }
    return { win: { BarcodeDetector: FakeDetector } as unknown as Window, detect };
  }

  it('有 BarcodeDetector 且支援 qr_code：用原生，不碰 jsqr', async () => {
    const { win, detect } = nativeWindow(['ean_13', 'qr_code']);
    const decode = await createQrDecoder(win);

    expect(await decode(video)).toBe('stu-native');
    expect(detect).toHaveBeenCalledWith(video);
    expect(jsQRMock).not.toHaveBeenCalled();
  });

  it('有類別但格式不含 qr_code：退 jsqr', async () => {
    const { win, detect } = nativeWindow(['ean_13']);
    jsQRMock.mockReturnValue({ data: 'stu-js' });
    const decode = await createQrDecoder(win, () => ({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    }));

    expect(await decode(video)).toBe('stu-js');
    expect(detect).not.toHaveBeenCalled();
  });

  it('沒有 BarcodeDetector（iPad Safari）：jsqr；讀不到回 null', async () => {
    jsQRMock.mockReturnValue(null);
    const decode = await createQrDecoder({} as Window, () => ({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    }));

    expect(await decode(video)).toBeNull();
    expect(jsQRMock).toHaveBeenCalledTimes(1);
  });

  it('影像還沒準備好（寬度 0）：不解碼，回 null', async () => {
    const grab = vi.fn();
    const decode = await createQrDecoder({} as Window, grab);

    expect(await decode({ videoWidth: 0, videoHeight: 0 } as HTMLVideoElement)).toBeNull();
    expect(grab).not.toHaveBeenCalled();
  });
});

describe('cameraErrorState', () => {
  it('使用者或系統拒絕 → denied（畫步驟說明＋重新要求權限）', () => {
    expect(cameraErrorState(new DOMException('no', 'NotAllowedError'))).toBe('denied');
    expect(cameraErrorState(new DOMException('no', 'SecurityError'))).toBe('denied');
  });

  it('其他（沒有鏡頭、鏡頭被占用、不支援）→ unavailable（請接掃碼槍或用卡號欄）', () => {
    expect(cameraErrorState(new DOMException('no', 'NotFoundError'))).toBe('unavailable');
    expect(cameraErrorState(new DOMException('busy', 'NotReadableError'))).toBe('unavailable');
    expect(cameraErrorState(new Error('whatever'))).toBe('unavailable');
  });
});
