---
title: 「送出中」要在 finalize 裡解除，spec 要守「失敗後可以再按」
summary: 送出鈕的 busy 旗標（sending／saving）在 next 跟 error 各寫一次 set(false)，漏一邊就永遠卡在「送出中」，而 submit() 開頭的守門又擋住重送。2026-10 審核席在 #1673、#1738、#1740、#1741、#1748 連抓五次突變全綠。寫法用 finalize；spec 斷言「失敗 → 按鈕可以再按、再按真的有送」。
category: lesson
status: active
updated: 2026-10-19
tags: [lessons, forms, rxjs, testing, mutation]
---

# 「送出中」要在 finalize 裡解除

## 形狀

```ts
protected submit(): void {
  if (this.sending()) return; // 守門：送出中不能重送
  this.sending.set(true);
  this.api.create(body).subscribe({
    next: () => { this.sending.set(false); /* … */ },
    error: () => { this.sending.set(false); /* … */ }, // ← 漏這行就卡死
  });
}
```

解除寫在兩個分支，**任一邊漏掉，失敗後畫面永遠停在「送出中…」**，而開頭的守門讓家長連重按都沒用。
既有 spec 通常只驗「錯誤訊息有出現」，所以拿掉那行 spec 照樣綠 —— 審核席的突變每次都抓到。

## 寫法

```ts
this.api
  .create(body)
  .pipe(finalize(() => this.sending.set(false))) // 成功、失敗、取消訂閱都會跑
  .subscribe({ next: …, error: … });
```

不是 Observable 的（`await`）用 `try { … } finally { this.sending.set(false); }`。

## spec 要守的

失敗那支 spec 除了錯誤訊息，**再加兩行**：

```ts
expect(btn(/送出/)!.getAttribute('aria-disabled')).toBe('false'); // 或 .disabled === false
btn(/送出/)!.click();
expect(api.create).toHaveBeenCalledTimes(2); // 真的有再送一次
```

只斷言旗標不夠 —— 要點下去、看 API 被叫第二次，才擋得住「旗標放了、守門換成別的條件」那種變形。

實例：`features/parent/pages/enrollment/enrollment.component.spec.ts` 的「送出失敗」（#1748）。
