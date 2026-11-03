---
title: 改共用的 git config，別席的 git push 直接推上 main
summary: 所有席位 worktree 共用同一份 .git/config；有席位為了推到不同名的上游下了 push.default=upstream，另一席從 origin/main 開的分支追蹤 main，裸 git push 就把 charter 直接推上 main（0c0652ed）。對策是不准改共用 git config、開分支加 --no-track、推送寫全。
category: lessons
tags: [lessons, git, herdr, worktree, config]
status: active
updated: 2026-11-03
---

# 改共用的 git config，別席的 git push 直接推上 main

## 發生了什麼

2026-10-30：

1. 14:40 左右，某席（labor-20261030-1436）為了把分支推到**名字不同的遠端分支**，在 repo 下了
   `git config push.default upstream`。
2. 15:14，另一席（labor-20261030-1312-a）寫交接 charter：分支是從 `origin/main` 開的，於是這支分支的 upstream 是 `origin/main`。
3. 它跑裸 `git push`。在 `push.default=upstream` 下，git 把它推到 upstream —— **`main`**。
   commit `0c0652ed`（`docs(herdr): labor-20261030-1312-a 交接 charter`）沒有經過 PR 就進了 main。

計畫席裁定不 revert（只是新增一份 charter；revert 也得推 main）。共用 config 隨後 unset 還原。

## 為什麼表面看不出來

- **所有 worktree 共用同一份 `.git/config`**。在自己的 worktree 裡下 `git config`（不加 `--worktree`）改的是全部席位的設定，
  但下指令的人看到的只是「我這邊可以推了」。
- 被影響的是**另一個席位**、在**半小時之後**，兩件事在時間和位置上都不相鄰。
- 預設的 `push.default=simple` 會擋下「本地分支名跟上游不同名」的推送 —— 這道防護一直都在，
  **直到有人為了自己方便把它關掉**。在那之前，「從 origin/main 開分支、裸 `git push`」是安全的，所以沒有人覺得它危險。
- `git switch -c X origin/main`／`git worktree add -b X <路徑> origin/main` 會自動把 upstream 設成 `origin/main`，畫面上沒有任何提示。

## 以後怎麼做

- **不准改共用的 git config**（`git config` 不帶 `--global` 也是共用的）。要推到不同名的遠端分支，就把目標寫在指令裡：
  `git push origin HEAD:<遠端分支>`。
- **從 origin/main 開分支一律加 `--no-track`**：`git switch -c <分支> --no-track origin/main`。
- **第一次推一律寫全**：`git push -u origin <分支名>`，不用裸 `git push`。
- 推完不確定時用 `git ls-remote origin <分支名>` 確認推到的是分支。
- 懷疑共用設定被動過：`git config --get push.default` 應該是空的（用預設 `simple`）。

## See Also

- [[lessons/herdr-seat-worktree-workspace]]
- [[lessons/herdr-team-orchestration]]
- [[lessons/merged-does-not-mean-main]]
