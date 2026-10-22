import { defineConfig } from 'vitest/config';

// Angular 的 unit-test builder 透過 project.json 的 `runnerConfig` 合併這份設定（其餘設定由 builder 給）。
// 只為了時區：`test:timetravel` 在命令列帶 `--setup-files`，放 setupFiles 會被它蓋掉。
// 測試一律在 UTC 跑，跟 CI 一致（#1558）。本機時區＝台北時，拿掉 '+0800'／'Asia/Taipei' 這類突變
// 全綠、只有 CI 紅；那些「台北日界線 ±1 分鐘」的 fixture 也只在 UTC 下才有作用。
// 設在 config 而不是 npm script：config 在主行程、worker 起來之前就跑，worker 繼承環境變數，
// 所以 nx、直接 `npx vitest`、突變腳本都吃得到。
// 只在沒設時給 UTC：要用別的時區驗（例：`TZ=America/Los_Angeles` 驗負時區）照帶就生效（review3 二讀）
process.env['TZ'] ??= 'UTC';

export default defineConfig({});
