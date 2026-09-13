---
title: 開一個新席位 —— 為什麼 workspace create 不夠，要用 worktree create
summary: 席位要出現在 herdr 側邊欄的專案樹底下（clessia-plan → review-steward / ops-warden），靠的是「cwd 是同名的 git worktree」，不是 workspace 的 label。用 workspace create 起的席位 label 對但位置錯；用 tab create 起的則整個掛在計畫席底下。正確做法是 herdr worktree create 一次把 worktree 與 workspace 建起來。含 2026-09-12 連錯三次的實際過程與每一次錯在哪。
category: lesson
status: active
updated: 2026-09-12
tags: [lessons, herdr, worktree, runbook, agent-ops]
---

# 開一個新席位 —— 為什麼 `workspace create` 不夠

> **這頁是操作用的。** 下次要加席位照著走，不要重新發明。

## 一行版

```sh
herdr worktree create \
  --workspace <計畫席的 workspace id> \
  --branch labor-1 \
  --base origin/main \
  --path <repo>/.worktrees/labor-1 \
  --label labor-1

herdr agent start labor-1 --kind claude --pane <回傳的 pane_id> --timeout 120000
```

**命名慣例（2026-09-13 使用者改定）：生產席一律 `labor-<開席時間戳>`，格式 `labor-YYYYMMDD-HHMM`（例：`labor-20260913-0945`）。** 之前的 `labor-{N}` 流水號到 labor-9 為止；常設席（`labor-reviewer`、`labor-db-reset`、`ops-warden`）用職務名不用時間戳。理由：流水號要查「上一個是幾號」，時間戳自帶開席時刻，而且不會撞號。

## 為什麼是這一條而不是別條

herdr 側邊欄的樹**照 git worktree 分組**，不是照 workspace label：

```
○ clessia-plan
  main
  ├─ ○ review-steward      ← cwd = .worktrees/review-steward
  └─ ● ops-warden          ← cwd = .worktrees/ops-warden
```

**一個席位要出現在專案底下，它的 cwd 必須是那個 repo 的 worktree，而樹上顯示的是 worktree 的名字。**

所以：

| 做法 | 結果 |
| --- | --- |
| `workspace create --cwd <repo 根>` | 席位浮在樹外，跟專案沒有關係 |
| `workspace create --cwd .worktrees/design-web --label labor-1` | **label 是 labor-1，樹上卻顯示 design-web** —— 因為顯示的是 worktree 名 |
| `tab create --workspace <計畫席>` | 整個掛在計畫席底下，變成它的第二個分頁 |
| **`worktree create`** | ✅ worktree 與 workspace 一次建好，名字一致 |

## 2026-09-12 我連錯三次的過程

記在這裡是因為**三次的推論都站得住腳，而三次都不對**：

1. **獨立 workspace** —— 對照 ops-warden 的 `workspace_id=wK` 推出來的。**它確實是獨立 workspace，但那是結果不是原因。**
2. **計畫席底下的 tab** —— 讀成「開在你這個 workspace 下面」。**位置錯了一層。**
3. **獨立 workspace + 沿用別席的 worktree** —— 回到 1，並補上 cwd。**label 對了，樹上仍然顯示 `design-web`。**

**卡住的原因是我一直在調整「workspace 怎麼開」，而決定顯示位置的是「cwd 是哪個 worktree」。** 使用者貼了側邊欄的截圖才看得出來——**那個資訊在 `herdr workspace list` 的輸出裡不存在**（它只有 label 和數量，沒有樹的父子關係）。

> **CLI 的查詢結果與 UI 的顯示邏輯可以是兩套。** 對著 `list` 的欄位推 UI 會怎麼畫，是在推一個它沒告訴你的東西。

## 收尾

- 席位停用時 `herdr workspace close <id>`；**worktree 本身留著**，下次 `herdr worktree open` 可以直接接回去
- 沿用舊席的 worktree 之前先 `git checkout --detach origin/main` 或建新分支，**不要接在別人的工作分支上**
- **`.worktrees/` 底下可能有跑著的 dev server**（2026-09-07 有一支跑了快兩天、指向已離職席位的 worktree，害可用性測試整輪測到舊版前端）。`herdr worktree remove` 之前先 `lsof -nP -iTCP -sTCP:LISTEN` 看一眼
