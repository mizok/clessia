---
title: 本機綠不等於 repo 綠
summary: 導入 CI 的過程連紅六次，每一次的根因都是「本機狀態 ≠ 版控狀態」。附上推送前該怎麼自我驗證。
category: lesson
status: active
updated: 2026-08-11
tags: [lessons, local-green-is-not-repo-green]
---

# 本機綠不等於 repo 綠

2026-08-11 為本專案建立 GitHub Actions CI。**在它第一次變綠之前連紅了六次**，而六次的根因
全都是同一族：本機工作區的狀態與版控裡的狀態不一致，於是「本機測試全過」這句話對 repo 並不成立。

## 六次紅燈

| #   | 根因                                                                               | 本機為什麼測不出來                                                       |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | workflow 只掛 `push: main` + `pull_request`，而開發在長期 feature branch 上        | YAML 正確、每個步驟本機都能跑，就是**不會觸發**                          |
| 2   | harness gate 從 `.agents/skills/` 磁碟生成 skill 表，但該目錄被 gitignore          | 本機磁碟有 10 個，CI 的 clone 只有 9 個                                  |
| 3   | `.agents/skills/` 在 CI 是**部分存在**（多數檔案在 ignore 規則加上去之前就已追蹤） | 「目錄不存在就跳過」的判斷不成立                                         |
| 4   | 某個 skill 自帶 `.git`，git 只存了 `160000` gitlink 且無 `.gitmodules`             | `git ls-files` 列得出該路徑；要 `git ls-files -s` 看 mode 才知道是空指標 |
| 5   | `apps/api` 是獨立 npm package，依賴不會被根目錄的 `npm ci` 裝起來                  | 本機 `apps/api/node_modules` 早就存在                                    |
| 6   | 三支已修好的 spec **從未 commit**                                                  | 工作區綠、repo 紅；而測試基線寫著 `knownFailing: []`                     |

## 為什麼值得記下來

這六個跟同一天在程式碼裡挖到的 bug 是**同一個形狀**：

- `profiles` 已成死表，但 auth middleware 還在讀它
- `enrollments.ts` 查一張任何 migration 都沒有的 `attendances` 表
- `AGENTS.md` 的 skill 表有 76% 指向不存在的 skill

**宣稱與現實脫節，而且沒有任何東西在比對兩者。** CI 的價值不在於「跑測試」——
測試本機就會跑；它的價值在於**強迫在一個乾淨、與你的機器無關的環境裡重放一次**。

## 推送前該做什麼

不要推上去賭。在乾淨 clone 上跑完整序列：

```bash
probe=$(mktemp -d)/probe
git clone -q --local --branch <branch> . "$probe"
cd "$probe"
npm ci && (cd apps/api && npm ci)
npm run harness && npm run harness:test
npx nx run-many -t typecheck && npx nx run-many -t test
```

第 5、6 個問題就是這樣抓到的 —— 直接推的話會是第七、八次紅燈。

這個做法**測得出**：未 commit 的改動、gitignore 掉的依賴、gitlink、缺少的安裝步驟。
**測不出**：作業系統差異（CI 是 Ubuntu、本機是 macOS）、node patch 版本差異、時區與 locale。
那些只能靠真的跑一次 CI。

## 可遷移的原則

1. **「我這邊測過了」要先問「我這邊有什麼是 repo 沒有的」。** node_modules、未 commit 的檔案、
   被 ignore 的目錄、巢狀 repo —— 每一項都會讓本機比 repo「多知道一些事」。
2. **報告狀態時要說清楚範圍。** 說「265 個測試全綠」而那三個修正還沒 commit，就是報告失準：
   綠的是工作區，不是別人拿得到的東西。
3. **gate 不可以依賴不在版控裡的東西**，否則它在 CI 上只會驗證「CI 的殘缺副本」。

---

同一個家族的另一種假綠：[[lessons/awakened-tests-bite]] —— 那裡的測試不是「在別的
環境會紅」，而是**根本沒跑到那行**，所以綠得毫無意義，直到一次機械重構把它接上電。
