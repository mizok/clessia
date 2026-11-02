---
title: 疊單 merge main，git 把同一段複製成兩份
summary: 疊單的下一張 merge main 時，git 自動合併可能把上一張已經 squash 進 main 的那段程式再貼一次——沒有衝突、merge-tree 不報、spec 照綠；對策是看 diff --stat 的檔案與行數，再 grep 關鍵宣告的次數。
category: lessons
tags: [lessons, git, merge, stacked-pr, silent-failure]
status: active
updated: 2026-11-03
---

# 疊單 merge main，git 把同一段複製成兩份

## 發生了什麼

#1842 Google 登入拆成一串疊單（#2169 → #2174；#2167 → #2168 → #2178）。上一張 squash 進 main 之後，
下一張要 `git merge origin/main`（已推的分支不 rebase）。2026-11-02 這樣合了三次，**三次 `apps/api/src/auth.ts`
的 Google provider 整段都變成兩份**：

| 哪一次 merge                       | 誰發現                          | 怎麼發現                               |
| ---------------------------------- | ------------------------------- | -------------------------------------- |
| #2169 merge main                   | 作者（labor-20261102-2035）自己 | 看 diff 行數不對                       |
| #2168 merge main（#2167 合了之後） | 接手席 labor-20261102-2223      | `grep -c "providers\['google'\]"` 回 2 |
| #2178 merge main（#2168 合了之後） | 同上                            | 同上                                   |

更早的 #2154 也遇過同一件事（labor-20261102-2035 交接 charter 第四節第 1 點）。

## 為什麼表面看不出來

- **沒有衝突**：squash 後 main 上那段的前後文，跟疊單分支上那段的前後文不一樣，git 把兩邊各當成一筆獨立的新增，
  兩筆都收。`git merge-tree` 也是 0 衝突。
- **編譯照過、spec 照綠**：重複的是 `providers['google'] = { … }` 這種**同一個 key 指派兩次**，JavaScript 不會報錯，
  第二次覆蓋第一次，行為跟一份完全一樣。
- 同一型如果重複的是宣告（`const x`、class 成員），至少 tsc 會紅（#1884 的 TS2300 就是那樣被抓到的）；
  **物件屬性、Map 的 set、陣列裡的設定項**重複時，一點訊號都沒有。
- 疊單本身又讓 diff 很難讀：base 換成 main 之前，PR 的 diff 是相對上一張分支算的，重複那段不會出現在 PR 畫面上。

## 以後怎麼做

疊單每次 merge main 之後、推之前：

1. **`git diff origin/main --stat`**：檔案清單要**只剩這張 PR 自己的檔**（對照 `gh pr view <n> --json files`），
   行數要跟這張本身的改動對得上。多出一支「這張根本沒動」的檔，就是被複製進來的那段。
2. **grep 關鍵宣告的出現次數**：疊單裡大家都會碰的那段（這次是 `grep -c "providers\['google'\]" apps/api/src/auth.ts`）
   必須是 1。
3. 修法：**這張 PR 沒有要改的檔，直接取 main 的版本**（`git checkout origin/main -- <檔>`），
   不要手動刪掉重複的那一份 —— 手刪容易刪錯邊。
4. 派疊單維護給別的席位時，把第 1、2 步寫進交辦，連要 grep 的字串一起給。

## See Also

- [[lessons/silent-tool-failures]] —「沒有結果」與「結果是沒有」長得一樣
- [[lessons/local-green-is-not-repo-green]]
- [[lessons/merged-does-not-mean-main]]
