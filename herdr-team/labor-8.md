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

## 驗證失敗的退路，不能是被驗證的東西本身

#758 的方法要 `db:reset`，而 `db:reset` 被 `.claude/settings.json` 的 `deny` 擋著
（刻意的全隊安全欄，`.claude/settings.md:72` 寫明理由）。我去找替代路，
驗到「容器內 `pg_dump` 的快照與還原在拋棄式 DB 上保真」就停住了，**沒有去驗還原回正式的庫**：

> 要驗證 `pg_restore --clean` 打在 live DB 上安不安全，就得真的打一次；
> **而萬一它中途失敗，收拾的手段正是那條被 deny 的 `db:reset`。**

**一般化：設計驗證步驟時，先問「這一步失敗了我拿什麼收拾」。**
答案如果是「就是我正在驗的那個東西」，那不是一個驗證，是一次沒有安全網的嘗試。

**它的上游是另一條**：工單的方法裡若有一個「出事就靠它復原」的動作，
**動工前先確認那個動作真的做得到** —— #758 的前提句「`db:reset` 就回來」
技術上為真、政策上為假，而**沒有人把它拿去對照專案自己的規則**。

## 「這個東西有沒有發生過」的檢查，要問「還有什麼別的原因會讓它成立」

等 reset 的時候我查了 DB，看到 `admin10 = []` —— 那是 `seed.sql` **最後一段**寫的，
於是我推「最後一行對了 ⇒ seed 跑完了 ⇒ reset 成功」。

**錯的，而且錯得很安靜**：更早之前我曾經單獨執行過 seed 的那一段（#759 的權限 fixture）。
**那個值有兩個生產者，而我的檢查分不出來。**（reset 其實根本沒跑成。）

**分得出來的檢查**是查一個「只有那件事會改、而我沒動過」的東西 ——
最好的一種是**自己留的哨兵**（本輪是 `QA-758-R<輪次>` 這個前綴）：
它證明的不是「表被重建」，是「**我上一輪弄髒的東西真的沒了**」，後者才是你要的前提。

⚠️ 順帶一條方向性：`pg_class.oid` 這類「重建就會變」的憑證是**單向**的 ——
**變了是硬證據，沒變不是反證**（新庫的計數器重新起算，可能撞回同一個數）。

## 宿主頁會不定時重載，把一次寫入序列縮進一次工具呼叫

量 #758 時 `window.__P` 被清掉過三次（Vite HMR）。它的形狀是：
**下一次呼叫直接 `ReferenceError`，而你正做到一半的對話框已經不見了。**

兩個處置：

1. **探針要能一次貼完重裝**，不要分段建（`Object.assign(window.__P, {get w(){…}})`
   會在複製時**執行** getter 而炸掉 —— 直接整個覆寫 `window.__P = {…}`）
2. **一顆寫入鈕的「開對話框 → 填 → 送出 → 讀結果」寫在同一次呼叫裡**，
   縮小被重載切斷的窗口；**而真正的保險是每顆按完查一次 DB**，
   不要用「上一次呼叫的畫面」推論這一次的結果

## 「可自行復原」要看 UI 有沒有那個入口，不是看 API 有沒有那支端點

#758 第 2 輪我建了一個測試人員，打算走完生命週期再刪掉 —— **封存之後才發現 UI 上沒有刪除入口**，
於是那筆資料留在本機等 reset。

`DELETE /api/staff/{id}` 是存在的（`staff.ts:1630`）。**而我自己做的待按清單早就寫著答案**：
它逐元件列「這個元件真的呼叫到哪幾支 method」，`staff` 那兩列只有
`create / update / activate / archive / createLoginLink / deactivate` —— **`delete` 不在上面。**

> **判準：按下「建立」之前，先在清單上找它的反向動作。**
> 找不到就是單向的，不管 API 那邊有沒有那支端點。
>
> 更一般的：**我做了一份正確的清單，然後沒有在需要它的那一刻讀它。**
> 清單的價值不在做出來，在**掛到會用到它的那個動作上**。

## 查空之前先懷疑查法（這一輪撞了兩次，兩次都是我錯）

1. `select … from ba_verification where identifier like '%qa-758%'` 回 **0** ——
   我差點寫成「登入連結不留痕跡」。**`identifier` 存的是 token 本身，不是 email**，
   換個查法就看到那一列了。
2. 改名之後 `ba_user.name` 還是舊的 —— 我差點寫成缺陷。
   **顯示名稱住在 `staff.display_name`**，而 `ba_*` 可讀不可寫（c2），所以它本來就不會變。

兩次都是**問錯了表／欄位**，而兩次的空結果看起來都像一個發現。
（第 2 條還多一層：它「看起來像缺陷」比「看起來像沒有」更誘人寫下去。）

## `db:reset` 被 deny 擋住，但 `npx supabase migration up` 沒有

`.claude/settings.json` 的 deny 只擋 `db reset` 的五個變體。**`npx supabase migration up`
不在清單上，而它只套尚未執行的 migration、不動資料** —— 別席合了一支 migration 進 main 之後，
本機要它生效**不需要 reset**。

```sh
psql "$DATABASE_URL" -At -c \
  "select count(*) from supabase_migrations.schema_migrations where version='<version>'"
npx supabase migration up
```

⚠️ **worktree 要先有那個檔** —— 從舊的 origin/main 開的分支看不到它，先 `git fetch` 再從最新
origin/main 開分支（或單獨 checkout 那個檔）。

> **為什麼這條值得寫下來**：套沒套過那支 migration，**它的失敗長得跟「程式沒接」一模一樣**。
> 有人回報「新加的 audit / 新欄位寫不進去」時，**第一個該問的是他套過那支 migration 沒有**，
> 不是去讀路由的程式碼。（labor-9 指出這一點比我原本寫的重要。）

## 只看一欄就說「沒有記錄」—— 空欄位跟空紀錄是兩件事

我回報 #832「`organization` 的 `resource_name` 是空的，所以稽核答不出改成什麼」。
**錯的**：那筆的 `details` 是
`{"fields":["attendance_mode"],"values":{"attendance_mode":"daily_checkin"}}` ——
資訊完整，只是不在我看的那一欄。而 `resource_name` 留空是**刻意**的
（被改的不是那個叫「Clessia Demo」的東西，是一個設定欄位）。

**查完六種 resource_type 之後結論還反過來**：那兩支新寫的是最完整的，
`subject.update` 是唯一記得下 before 值的（`{"from":…,"to":…}`），
而**真正空的是 `campus`**（五筆 `details` 全 `{}`）。

> **判準：說「這裡沒有記錄 X」之前，把那張表的每一個欄位都看一遍。**
> 這是「grep 回空先懷疑 pattern」在**欄位**上的形式 ——
> 而它比 grep 那一版更容易犯，因為你**確實看到了一個空值**，
> 那比「什麼都沒找到」更像一個發現。

## 給下一個接手的人

- **charter 會腐化，接手時先驗一遍再信它。**
- 這一席退場前會把「會再次用到的知識」蒸餾到這裡；現在是空的就是還沒做到那一步。
