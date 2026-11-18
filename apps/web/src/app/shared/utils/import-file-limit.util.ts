/**
 * Excel／CSV 匯入的檔案大小上限（#2540，計畫席 11-18 裁）。
 *
 * **補償控制**：SheetJS 讀檔有過原型污染與 ReDoS 公告，惡意檔案會在管理員自己的分頁裡被解析。
 * 換到 0.20.3 已修，這道上限在 `XLSX.read` 之前擋 —— 不讓超大檔進解析器，也是 ReDoS 的主要壓制。
 * 數千列的家長名單 .xlsx 只有數百 KB，2MB 不會擋到正常使用。
 */
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

/** 超過上限回給人看的訊息；沒超過回 null */
export function importFileTooLarge(file: File): string | null {
  if (file.size <= MAX_IMPORT_FILE_BYTES) return null;
  const mb = (file.size / 1024 / 1024).toFixed(1);
  return `檔案太大（${mb} MB），上限 2 MB，請分批匯入`;
}
