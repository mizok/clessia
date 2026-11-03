---
title: conformance 拿空稿比對，照樣出一張像樣的表
summary: 新席位 worktree 只複製了 A6 稿的 a6-editorial/、漏了它引用的 ../shared/，稿的 script 全掛、A6 側抽到 0 個 part，compare 卻照樣 exit 0、出表，數字作廢（#2195、#2196）；對策是量完先看 a6-d.json 的 part 數。
category: lessons
tags: [lessons, a6, conformance, silent-failure, verification]
status: active
updated: 2026-11-03
---

# conformance 拿空稿比對，照樣出一張像樣的表

## 發生了什麼

A6 稿（`.design-explorations/973-layout/`）在 `.gitignore` 裡，新開的席位 worktree 沒有它，要從別的席位複製。
2026-11-02 labor-20261102-2223 只複製了 `a6-editorial/`。但稿的 html 引用了上一層的共用檔：

```html
<link rel="stylesheet" href="../shared/world.css" />
<script src="../shared/data.js"></script>
<script src="../shared/flow.js"></script>
<script src="../shared/proto.js"></script>
```

缺了 `../shared/`，稿的 script 全部載入失敗，conformance 在 A6 那一側**抽到 0 個 part**。
用這個狀態量的 compare 貼進了 #2195（分頁器 PR2）、#2196（PR3）的內文，事後兩張都留言作廢、補上 `shared/` 重量、改寫內文。

重量之後才浮出兩件真的要處理的事（`app-pager` 在稿沒畫分頁器的頁要登記偏離；帳單桌機逾期章頭的「全部提醒」漏登記），
**用空稿量的那一版完全看不到它們**。

## 為什麼表面看不出來

- **compare 沒有報錯**：exit 0、照樣產出前後對照表、照樣寫「head 沒有新增待修」。
  app 被導去 /login 時工具會報錯，但「稿那一側是空的」沒有被當成錯誤。
- **表上的數字長得像真的**：每頁都是「殼層 1／1、頁面 1／1」這種小而整齊的數字。
  工具把 app 整個 `main` 當成「多」（因為稿那邊沒有 main 可以配），歸成一條；前後兩邊一樣，就成了「沒有回歸」。
- 會起疑的只有一個線索：**同一頁以前的報告是幾十、上百條**（例：grades-student 在 #2181 的殼層偏離是 19），這次一下子少了一個量級。
- `~/.cache/clessia-a6-conformance/out/<頁>/diff.md` 是 `diff` 指令寫的，`compare` 不會更新它；這次打開看到的是 10-15 的舊檔，裡面有「正常的」大量差異，更容易誤以為工具有在量。要看這次量到什麼，看同目錄的 `diff-d.json`／`a6-d.json`（compare 會覆寫它們）。

## 以後怎麼做

- **複製稿要複製整個 `.design-explorations/973-layout/`**，至少 `a6-editorial/` 加 `shared/`。
- **量完先看 A6 側的 part 數**再貼表：`~/.cache/clessia-a6-conformance/out/<頁>/a6-d.json` 的 part 數應該是幾十到幾百，
  不能是 0。或先跑一次 `node tools/a6-conformance/run.mjs inventory <頁>`，它會印「1440px N part」。
- 讀 compare 表時，**跟同一頁以前的報告比一下量級**；差一個量級先懷疑量測，不要先相信結果。
- 工具這端可以補一道防線：A6 側抽到 0 個 part 時直接報錯（跟「app 被導去 /login 就報錯」同一個思路）—— 另開工具單。

## See Also

- [[lessons/silent-tool-failures]]
- [[lessons/broken-looks-identical-to-normal]]
