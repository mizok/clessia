---
title: 成績的刪除路徑 —— 清空分數後儲存就是刪除那一列
summary: 登錄過成績的考試刪不掉、成績沒有任何刪除路徑，是三道關卡疊出來的功能缺口。修法是讓「清空分數後儲存」在後端走 delete 而不是把欄位設成 null，三道關卡一次解開；status 為 absent/makeup 的 null 是有意義的狀態，不在此列。
category: architecture
status: active
updated: 2026-09-30
tags: [architecture, grades, scores, deletion, audit]
---

# 成績的刪除路徑

> #886 的設計。**這是功能缺口不是呼叫錯**：系統裡沒有「把一筆成績拿掉」這條路。

## 問題

一場考試只要登錄過一筆成績，它與它的成績就再也刪不掉 —— 三道關卡疊起來：

| #   | 關卡                                                                                   | 位置                                                             |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | 列選單的 `刪除` 在 `scoreCount > 0` 時 `disabled`                                      | `exams.component.ts:354`                                         |
| 2   | `DELETE /api/academy-exams/{id}` 在 `scoreCount > 0` 回 400 `HAS_SCORES`               | `academy-exams.ts:1385-1396`（`school-exams.ts:1203-1213` 同形） |
| 3   | **沒有出路** —— 兩支路由都沒有刪除成績的端點，只有 `POST /{id}/scores` 且它是 `upsert` | `academy-exams.ts:1662`、`school-exams.ts:1466`                  |

`scoreCount` 數的是**列數**，所以把 `score` 更新成 `null` 沒有用：列還在、計數不變、刪除照樣被擋。

### 一個容易誤導的地方

`academy_scores.exam_id → academy_exams(id)` 是 **`ON DELETE CASCADE`**
（`20260410000001_create_academy_exams.sql:65`，`school_scores` 同形）。
**看 FK 會以為刪考試就一次收乾淨** —— 而那條 CASCADE 永遠不會被觸發，
因為刪除在更上游（關卡 1、2）就被擋住了。

## 決策：清空分數後儲存 ＝ 刪除那一列

後端把 `POST /{id}/scores` 從「單一 upsert」改成**分流**：

- `score === null && status === 'scored'` 的項目 → **delete 那一列**
- 其餘 → 照舊 upsert

前端兩個編輯器把**現在用來排除這種列的那個條件反過來**：不再濾掉，而是照常送出。

### 為什麼是這條路

1. **不用加新按鈕。** 使用者已經在做的動作（把分數欄清空、按儲存）變成有意義的。
2. **三道關卡一次解。** 列被刪掉 ⇒ `scoreCount` 自然歸零 ⇒ 關卡 1 與 2 自動解鎖，
   **兩處守衛一行都不用改**。
3. **入口已經在那裡**：`save()` 現在濾掉的正是該被刪的列 —— 那個 `return` 就是缺口本身。

### 被拒絕的替代方案

| 方案                                           | 為什麼不                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 加一顆「刪除成績」按鈕                         | 多一個操作面、多一組權限與確認流程，而使用者要表達的意思（這個人沒有成績）已經有一個自然的動作 |
| 讓考試刪除走「連同成績一起刪」的明示確認       | 解得掉關卡 1、2，**解不掉「只想拿掉其中一個學生的成績」** —— 而那才是誤登錄的常見形狀          |
| 只補一句提示，維持不可刪                       | 補完那句話要說「要移除成績請…」，**而現在沒有那條路可以指**。一句沒有出口的提示不是修法        |
| 把 `scoreCount` 改成只數 `score !== null` 的列 | 讓關卡鬆開，但**幽靈列留在 DB 裡**；而且 `absent` 的列本來就是 null，會被一起放行              |

## 四個必須回答的問題

### ① FK：刪一列成績會不會撞到別的東西 —— 不會

- **零命中**：`grep -rn "references public.academy_scores\|references public.school_scores" supabase/migrations/` 沒有任何結果。
  **沒有任何表的 FK 指向這兩張表**，所以刪一列不會撞到 RESTRICT。
- 它們自己往外指的 FK 與這件事無關（`exam_id` CASCADE、`student_id` RESTRICT
  —— 那是「刪學生」要面對的問題，不是「刪成績」）。
- 唯一鍵：`academy_scores UNIQUE (exam_id, student_id)`、
  `school_scores UNIQUE (school_exam_id, student_id, subject_id)`
  —— **delete 的 where 條件就用這組鍵**，跟 upsert 的 `onConflict` 同一組，不會不一致。

### ② audit：記，而且**不需要任何 migration**

`audit_logs.action` 是 `text NOT NULL`，**沒有 CHECK**
（`20260223130000_create_audit_logs.sql:9`）—— 有 CHECK 的只有 `resource_type`。

所以沿用既有形狀就好：

```ts
resourceType: 'academy_exam',        // 已在 union 與 CHECK 裡，不動
resourceId: id,                       // 考試本身
action: 'academy_exam.scores.delete', // 新字串，零 migration
details: { removed: [studentId, …] }, // 誰的成績被拿掉
```

**兩件刻意的**：

- **`resource_type` 不加 score 級的值** —— 那要改 CHECK ⇒ migration ⇒ 保留類，
  而它換到的只是分類細一階。exam 級 ＋ `details` 已經答得出「誰的、哪一場」。
- **`details` 記 `studentId` 清單而不是只記 `affected` 數字** ——
  既有的 `*.scores.upsert` 記的是 `{ affected: n }`，那對「改了幾筆」夠用；
  **但刪除要答得出「哪一筆不見了」**，只有數字的話事後查不回來。
  （labor-8 那條：「說『這裡沒有記錄 X』之前，把那張表的每一個欄位都看一遍」的預防版
  —— 先讓欄位答得出來。）

同一批次若同時有刪與改，**記兩筆 audit**（`.scores.upsert` ＋ `.scores.delete`），
不要合成一筆 —— 合起來就分不出哪幾個 studentId 是被刪的。

### ③ `absent` / `makeup` 的 null **不是**清空

`public.score_status` 是 enum `'scored' | 'absent' | 'makeup'`
（`20260410000001_create_academy_exams.sql:16-20`）。

- **`absent` 的 `score` 本來就是 null** —— `onStatusChange` 選「缺考」時會主動把 `score` 設 null
  （`academy-score-editor.component.ts:209-215`，`score-edit-dialog.component.ts:162-167` 同形）。
  「缺考」是一個**被登錄過的事實**，不是「沒有成績」。
- **`makeup`（補考）同樣是使用者選得到的狀態** —— 兩個編輯器的狀態下拉都有「補考」
  （`academy-score-editor.component.ts:52`、`score-edit-dialog.component.ts:74`）。

> ⚠️ 探索時一度被回報成「`makeup` 沒有任何寫入點、UI 沒有補考入口」。**那是錯的**，
> 而它會讓判準寫成 `score === null` 就刪 —— **那會把所有缺考與補考紀錄一起刪掉**。
> 判準必須是 **`score === null && status === 'scored'`** 兩個條件並存。

這個判準不是我發明的：**前端兩處現在就是用它來排除那些列的**
（`academy-score-editor.component.ts:243-245` 與 `score-edit-dialog.component.ts:302-303`），
只是它們的處置是「不送出」。這支改的是處置，不是判準。

### ④ school-exams 同形 —— **同一支 PR 一起做**

兩邊在這件事上逐字同形：同樣的 upsert、同樣的 `HAS_SCORES` 守衛、
同樣的 `details: { affected }`、前端同樣的排除條件（只是一個寫成 `filter`、
一個寫成 `for` + `continue`）。差別只在 school 多一層科目
（唯一鍵多 `subject_id`、多一道科目限制檢查）。

**分兩支的代價比較大**：這是一條語意（清空＝刪除），拆開就會有一段時間
「補習班考試清得掉、學校考試清不掉」，而那個不一致沒有任何理由可以對使用者解釋。

## 順帶修掉的兩件

1. **「按了什麼都不發生」** —— `save()` 那個 `if (dirtyRows.length === 0) return;`
   靜默 return（`academy-score-editor.component.ts:246`）。清空的列不再被濾掉之後，
   這條路自然不會走到；**但那個靜默 return 本身要補訊息**，因為「完全沒有改動就按儲存」
   仍然會走到它。
2. ~~**`recordedCount` 灌水**~~ —— **實作時判斷錯了，不改。** 訂正如下。

   設計時我寫「`recordedCount: typedScoreRows.length` 數列數而平均分只算
   `score !== null` 的，所以幽靈列會讓『已登錄』比實際多」。**兩個理由都不成立**：

   - **`rows.length` 才是對的語意。** 畫面上它跟 `absentCount` 成對顯示成
     「**已登錄 / 缺考**」（`class-scores-dialog.component.html:137`）——
     「已登錄」本來就**包含缺考**，而缺考的 `score` 就是 null。
     改成只數 `score !== null` 會讓缺考從「已登錄」裡消失。
   - **幽靈列在這支修法之後產不出來。** 唯一能造出 `score=null, status='scored'` 的路
     是「清空後儲存」，而它現在走 delete。修之前前端也把那種列濾掉了 ——
     **所以那個灌水從頭到尾就沒有發生過**，它是我從程式碼推出來的，不是量到的。

   > 留著這一段而不是刪掉：**一個站得住腳的推導掛在一個沒查過的前提上**
   > （「幽靈列存在」）—— 這個 repo 最常見的錯法。理由寫得越順，越沒有人想去查它。

## 影響的既有元件

| 檔                                               | 改什麼                                    |
| ------------------------------------------------ | ----------------------------------------- |
| `apps/api/src/routes/academy-exams.ts`           | `POST /{id}/scores` 分流 + 第二筆 audit   |
| `apps/api/src/routes/school-exams.ts`            | 同上（唯一鍵多 `subject_id`）             |
| `apps/web/.../academy-score-editor.component.ts` | `save()` 不再濾掉清空的列；空改動時給訊息 |
| `apps/web/.../score-edit-dialog.component.ts`    | `buildSavePayload()` 同上                 |

**不動**：`exams.component.ts` 的 `disabled`、兩支路由的 `HAS_SCORES` 守衛、
`scoreCount` 的算法、任何 migration、任何 `resource_type`。

## 測試覆蓋的現況（動手前的基準）

- `academy-exams.spec.ts` / `school-exams.spec.ts` **沒有任何測試命中
  `POST /{id}/scores` 或 `DELETE /{id}` 的 handler** —— 這條路是零覆蓋，
  所以新測試是純增量、不會撞紅既有斷言。
- 前端 `academy-score-editor.component.spec.ts:119-135` 有兩條 save 相關的，
  **都沒有「把已有分數清成 null 再 save」的情境** —— 那正是這支要新增的行為。
- ⚠️ `apps/api` **有** `test` target（`project.json` 的 targets 含 `test`），
  api 的測試會被 `nx run-many -t test` 跑到。探索時一度被回報成「沒有 test target、
  不會被 CI 執行」，**那是錯的** —— 新寫的 api 測試會進 CI，要當真。
