/**
 * 把系統時鐘往前推 `TT_MONTHS` 個月（預設 3），用來抓「fixture 日期寫死」的測試。
 *
 * **為什麼需要它**（#670）：那種測試寫的時候綠、review 的時候綠、合併的時候綠，
 * 沒有任何 commit 弄壞它，然後在一個**跟程式碼無關的時刻**自己爆掉 ——
 * 而那一刻下一個人看到的是「我的 PR 弄壞了測試」。09-12 那次是一支純文件的 PR 中彈，
 * 查了三輪才確認跟它無關。
 *
 * 用法：`npm run test:timetravel`（或帶 `TT_MONTHS=12`）。
 *
 * ⚠️ **必須在 top-level 動手，不能包進 `beforeAll`。** setupFiles 的 top-level 在
 * spec 模組被 import 之前跑，`beforeAll` 在之後。spec 常有 module top-level 的
 * `const MONDAY_THIS_WEEK = format(startOfWeek(new Date()), …)` 這種**寫得完全正確**
 * 的相對日期；包進 `beforeAll` 的話它們會用真時鐘算，於是被誤判成炸彈
 * （第一版就是這樣誤報了 4 支，全部是好的測試）。
 *
 * 只 fake `Date`，不 fake timer —— fake 掉 `setTimeout` 會讓 Angular 的非同步卡住。
 */
import { vi, afterAll } from 'vitest';

const months = Number(process.env['TT_MONTHS'] ?? 3);
const future = new Date();
future.setMonth(future.getMonth() + months);

vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
vi.setSystemTime(future);

afterAll(() => vi.useRealTimers());
