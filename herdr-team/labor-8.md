# labor-8 席 charter（通用執行席）

> **開席日 2026-09-13。** 內容先薄 —— 退場前才蒸餾「下一個接手的人必須知道的事」。
> **這一頁只放別處沒有的**：量測方法看
> [`kb/wiki/specs/sitemap/README.md`](../kb/wiki/specs/sitemap/README.md)，
> 團隊通則看 [`README.md`](README.md)，前兩任的坑看
> [`labor-6.md`](labor-6.md) / [`labor-7.md`](labor-7.md)
> （**labor-7 第十節是 #760 的未完成清單**，開工前先讀它）。

## 開席前置

- **新 worktree 沒有 `node_modules`，root 與 `apps/api` 各 `npm ci` 一次**
  （理由見 [`labor-6.md`](labor-6.md)：少了 `apps/api` 那次，`login-link.ts` 會缺 `pg`）。
- 登入、dev server 版本確認、magic link 的三個環境變數坑：方法頁「環境」一節。

## 佇列怎麼查（不寫快照）

```sh
gh issue list --label seat:labor-8 --state open
gh pr list --state open --search "labor-8"   # 共用 GitHub 帳號，要用分支名或標題過濾
```

## 給下一個接手的人

- **charter 會腐化，接手時先驗一遍再信它。**
- 這一席退場前會把「會再次用到的知識」蒸餾到這裡；現在是空的就是還沒做到那一步。
