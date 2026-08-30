---
title: 「MERGED」只說明它合進了某個東西，沒說是 main
summary: 疊 PR 的下層先合併之後，上層的 base 不會自動轉回 main —— 它會靜靜地合進一條已經死掉的分支，GitHub 標成 MERGED、CI 照樣綠，而那份工作從此不在 main 上。
category: lesson
status: active
updated: 2026-08-30
tags: [lessons, merged-does-not-mean-main, git, ci]
---

# 「MERGED」只說明它合進了某個東西，沒說是 main

2026-08-30，一支已經標成 **MERGED**、CI 全綠的 PR（#89，警示色收斂到琥珀），
它的內容**從來沒有進入 `main`**。

## 怎麼發生的

當時 `main` 是紅的（另一個問題），所以 #89 沒有開在 `main` 上，而是疊在修那個
紅燈的 #88 分支上 —— 不疊就綠不了。

```
main ──────────────●  ← #88 先合進來
                  ╱
fix/c8-allowlist ●    ← #88 的分支，合併後已被吸收，成為死分支
                  ╲
                   ●  ← #89 合進了「這裡」
```

**下層先合併，不會把上層的 base 轉回 `main`。** #89 於是被 merge 進一條已經
沒有出口的分支。GitHub 照樣顯示 MERGED、merge commit 真的存在、CI 也真的綠 ——
每一個訊號都正常，只是它們講的都不是「進了 main」這件事。

同一批裡 #93 沒事，因為有人**手動**把它的 base 轉回了 `main`。差別只在這一步。

## 是怎麼被發現的

不是靠看 PR 列表 —— 那上面一切正常。是靠**一條本來應該消失的警告又出現了**：

`npm run harness` 報「20 處直接引用 PrimeNG 原始調色盤」，而消掉這條提醒
正是 #89 的工作內容。既然 #89 已經 MERGED，這條提醒不該還在。

順著這個矛盾往下查：

```bash
git merge-base --is-ancestor <commit> origin/main   # → 不是祖先
gh pr view 89 --json mergeCommit,baseRefName        # → base 不是 main
```

> **一條「應該消失卻還在」的警告，比 PR 頁面上的綠勾更可信。**
> 前者描述的是倉庫的實際狀態，後者只描述某次操作成功了。

## 怎麼避免

- 疊 PR 的**下層一合併，立刻人工把上層的 base 轉回 `main`**，並刪掉下層分支
  （刪掉它，下一次就沒有東西可以誤合進去）
- 合併前掃一次：`git merge-base --is-ancestor <pr 的 head> origin/main`
- 更根本的預防：**先修紅燈再疊工作**。#89 之所以要疊，是因為 `main` 紅著；
  如果紅燈修得夠快，這批 PR 根本不需要疊層

## 相關

- [[lessons/local-green-is-not-repo-green]] —— 同一個家族：本機／PR 頁面上的綠，
  不等於 `main` 的實際狀態
- [[lessons/awakened-tests-bite]] —— 同樣是「綠燈在說謊」，那裡是測試根本沒跑到
