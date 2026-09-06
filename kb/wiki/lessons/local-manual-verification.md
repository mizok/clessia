---
title: 本機實機驗證怎麼進得去
summary: 這個系統沒有密碼登入，要用 login-link 腳本產生一次性 magic link；連同它需要的環境變數、瀏覽器 session 的搶佔行為、以及 seed 裡「沒有任何 parent 角色」這個會讓家長端完全打不開的事實。
category: lessons
tags: [lessons, local-dev, verification, auth]
status: active
updated: 2026-09-06
---

# 本機實機驗證怎麼進得去

要在本機**用真的畫面**驗一件事（觸控可點性、版面、載入態…）之前會撞到的幾道門。
每一道都花過時間，而它們原本不在任何文件裡。

## 一、沒有密碼登入

`supabase/seed.sql` 的註解寫得很清楚，**這不是漏做**：

> scrypt 超過 Cloudflare Workers 的 10ms CPU 上限；而且共用密碼的 seed
> 等於「一間補習班的資料庫外洩，所有客戶的最高權限都一樣」。

所以 `ba_account` 裡**沒有密碼憑證**，登入只有一條路：**一次性 magic link**。

## 二、產連結的兩個環境變數

```bash
set -a; . ./apps/api/.dev.vars; set +a          # DATABASE_URL 在這裡
LOGIN_EMAIL=teacher0003@demo.clessia.app npx tsx apps/api/src/scripts/login-link.ts
```

- **兩個都少不了**：只給 `LOGIN_EMAIL` 會停在「缺少環境變數 DATABASE_URL」
- token **一次有效、24 小時過期**，用掉就要重跑
- 產出的 `callbackURL` 寫死 `localhost:4200`。**cookie 是 host 層級、不分 port**，
  所以連結照用、之後直接開自己的 port 即可，不需要改它
  （改成別的 port 反而可能因為白名單而失敗）

**這支腳本會自己擋掉沒有角色的帳號**，訊息是
「`<email>` 沒有任何角色，登進去也看不到東西。未產生連結。」——
那句話是下一節的來源。

## 三、seed 裡沒有任何 `parent` 角色 —— 家長端本機打不開

```
user_roles 的角色分佈：teacher 88、admin 12、parent 0
parents 表 15 筆、parent_student_relations 15 筆、全部有 user_id
```

**家長使用者存在、孩子關聯也存在，但沒有一個掛上 `parent` 角色**，
於是 `roleGuard('parent')` 擋掉所有 `/parent/**`。

> **後果**：家長端那些頁**在本機從來沒有被真的打開過**。
> 這正是 [[lessons/broken-looks-identical-to-normal]] 底下那條
> 「**本機資料的形狀決定哪些 bug 看得見**」——
> `/select-role` 對單角色使用者說錯話能活很久，是因為 seed 裡沒有多重角色帳號；
> 家長端是同一件事的更極端版本：**連一次都跑不到**。

要驗家長端得先讓某個帳號有 `parent` 角色，而**正路是 admin API 不是直接寫 SQL**
（AGENTS.md：新增使用者走 `admin.createUser()`；改設定的正路是 admin API）。

## 四、瀏覽器已經有 session 時，magic link 不會蓋過它

進去之後看到的是**上一個人的身分**，而且畫面完全正常 ——
`/api/me` 是唯一能問清楚的地方：

```js
await fetch('http://localhost:8787/api/me', {credentials:'include'}).then(r=>r.json())
```

要換身分得先登出：

```js
await fetch('http://localhost:8787/api/auth/sign-out',
  {method:'POST', credentials:'include', headers:{'content-type':'application/json'}, body:'{}'})
```

**那個 cookie 是共享的瀏覽器狀態** —— 多席同時在跑時，登出會把別人踢掉。
照 `herdr-team/README.md` 的共享資源協定：**開是加法誰都可以，關要先問**。
登出是可逆的（再跑一次 login-link 就補回來），所以問的是「你在不在用」，
不是「可不可以」。

## 五、起 dev server 之前先看 port 是誰的

```bash
lsof -ti:4200 | head -1 | xargs -I{} ps -o args= -p {} # 看它屬於哪個 worktree
```

被佔就**換 port**（例如 4300），不要 kill。
API（8787）可以直接用別席已經起好的那支 —— 唯讀打它不影響對方。
supabase 是 docker，通常已經有人開著，**別關**。

## 六、挑一個「畫面上真的有東西」的帳號

空的畫面驗不到東西，而**空的原因可能只是這個帳號這週沒課**：

```sql
select u.email, count(*) from ba_user u
join user_roles ur on ur.user_id=u.id and ur.role='teacher'
join staff st on st.user_id=u.id
join sessions s on s.teacher_id=st.id
where s.session_date between current_date-7 and current_date+7
group by u.email order by 2 desc limit 5;
```

> **零命中不代表沒問題，可能只是那一頁上什麼都沒渲染。**
> 老師端課表的動作鈕只有在有課的那幾天才存在 —— 拿一個沒課的老師去掃，
> 會得到一個看起來很乾淨的結果。見 [[lessons/silent-tool-failures]]。

## See Also

- [[lessons/silent-tool-failures]] —— 零輸出／綠燈其實代表「這個檢查沒有發生」
- [[lessons/broken-looks-identical-to-normal]] —— 本機資料的形狀決定哪些 bug 看得見
- [[lessons/local-green-is-not-repo-green]] —— 本機綠不等於 repo 綠
