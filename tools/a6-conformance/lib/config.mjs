import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '../../..');
const cache = path.join(os.homedir(), '.cache/clessia-a6-conformance');

/** A6 稿不進版控：路徑走環境變數，預設 repo 內 gitignore 掉的那份。 */
export const A6_DIR =
  process.env.A6_DIR ?? path.join(root, '.design-explorations/973-layout/a6-editorial');
export const APP_URL = process.env.A6_APP_URL ?? 'http://localhost:4200';
export const API_URL = process.env.A6_API_URL ?? 'http://localhost:8787';
export const STATE = process.env.A6_STATE ?? path.join(cache, 'state-admin.json');
export const OUT = process.env.A6_OUT ?? path.join(cache, 'out');

export const WIDTHS = [
  { tag: 'd', width: 1440 },
  { tag: 'm', width: 360 },
];

/**
 * 刻意偏離 A6 的地方（#1314 gate 10-15：每條要 key／條件＋理由＋出處，不能用「近似」帶過）。
 * 命中的差異列歸「已記錄偏離」，不算待修。欄位是 regex 字串：status（差異類別，必填）、
 * detail（差異文字）、a6／app（part key）、kind（part 種類）。頁面專屬的放 PAGES[頁].deviations。
 */
export const DEVIATIONS = [
  {
    status: '尺寸',
    kind: 'control',
    detail: '^高 \\d+→(4[4-9]|[5-9]\\d)',
    reason: '可點元素基底高 ≥44px（觸控下限）；稿較矮的高度不照抄',
    source: 'kb/wiki/architecture/constitution-enforcement.md:101（A27）',
  },
];

/** 殼層的彈出物：A6 popover id → app popover id（每頁都有）。 */
export const SHELL_POPOVERS = { more: 'shell-more', acct: 'shell-account' };

/**
 * 頁面對照：稿檔 ↔ app 路由。兩邊的原生 `[popovertarget]` 會自動逐一打開；
 * `appOpen` 放 app 端不是原生 popover 的彈出物（id 用 A6 那邊的，才配得上）；
 * `popovers` 放 A6 id → app id 的額外對照（殼層的在 SHELL_POPOVERS）；
 * `mapping` 放自動配不上的 part（A6 key → app key）。
 */
export const PAGES = {
  students: {
    a6: 'students.html',
    app: '/admin/students',
    // app 的篩選是 PrimeNG Popover（不是原生 popover）：點哪顆、內容根在哪
    appOpen: { filt: { click: 'button:has-text("篩選：")', root: '.p-popover' } },
  },
  schedule: { a6: 'schedule.html', app: '/admin/sessions' },
  billing: { a6: 'billing.html', app: '/admin/payments' },
};
