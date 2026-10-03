/**
 * `qrcode`（angularx-qrcode 的間接依賴）沒有附型別。只宣告用得到的部分 ——
 * 到班卡產生 QR（`toDataURL`）、測試走矩陣（`create`）。不為兩個函式加 `@types/qrcode`。
 */
declare module 'qrcode' {
  type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';
  const QRCode: {
    create(
      text: string,
      options?: { errorCorrectionLevel?: ErrorCorrectionLevel },
    ): { modules: { size: number; get(row: number, col: number): boolean } };
    toDataURL(
      text: string,
      options?: { errorCorrectionLevel?: ErrorCorrectionLevel; margin?: number; width?: number },
    ): Promise<string>;
  };
  export default QRCode;
}
