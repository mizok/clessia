import { afterEach, beforeEach } from 'vitest';

/**
 * **把「靜默失敗」變成測試紅燈。**
 *
 * `utils/audit.ts` 的 `logAudit` 把所有例外包在自己的 try/catch 裡，只印一行
 * `[audit] log failed`。那個設計是對的 —— **稽核寫入失敗不該讓使用者的操作失敗**。
 * 但副作用是：測試替身少一個鏈式方法（`maybeSingle`、`gte`…）時，整支稽核在測試裡
 * 悄悄消失，而**沒有任何測試會紅**。
 *
 * 這一族已經出現兩次（#233 的 `maybeSingle`、以及後續的其他方法），逐次補比一次
 * 把訊號打開貴。所以這裡在測試環境把它接起來：**只要有測試印出那行警告，
 * 那個測試就紅**，並指出要補什麼。
 *
 * 只在測試生效，正式站的吞例外行為完全不變。
 */
const SILENT_FAILURE_MARKERS = ['[audit] log failed'];

let captured: string[] = [];
let originalWarn: typeof console.warn;

beforeEach(() => {
  captured = [];
  originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const line = args.map((arg) => String(arg)).join(' ');
    if (SILENT_FAILURE_MARKERS.some((marker) => line.includes(marker))) {
      captured.push(line);
      return;
    }
    originalWarn(...(args as []));
  };
});

afterEach(() => {
  console.warn = originalWarn;
  if (captured.length === 0) return;

  const lines = captured.join('\n  ');
  captured = [];
  throw new Error(
    '這個測試裡有東西靜默失敗了（正式站會被 try/catch 吞掉，測試裡不該吞）：\n  ' +
      lines +
      '\n\n通常是假的 supabase 替身少了鏈式方法。`logAudit` 走的是\n' +
      "  from('profiles').select().eq().maybeSingle()  →  from('audit_logs').insert()\n" +
      '兩段都要在替身上存在。',
  );
});
