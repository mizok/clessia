---
title: 家長端讀取已發布教務日誌（v1b）
summary: 家長端第二實例，照 parent-read-endpoints.md 的樣板抄：childDb 兩層防線、複用 admin 的 select/mapper、allowlist 欄位過濾。這支的特殊之處是 class_logs 是班級層級不是學生層級，childDb 現有 API 假設表上有 student_id 欄位，需要擴充一個新方法。等 STOP 批准，teacher-pages 的 v1b 讀取頁與發布按鈕卡在這支上。
category: architecture
status: draft
updated: 2026-09-05
tags: [architecture, parent, authorization, teaching-log]
---

# 家長端讀取已發布教務日誌（v1b）

> **這份文件要計畫席批准才能動工。** 下游卡得很硬：teacher-pages 的教務日誌
> v1b（家長讀取頁 + 發布啟用）整個建立在這支上，他的原話——「發布如果還是沒有
> 下游，我就還是不該放那顆按鈕」。

## 這是第二實例，照第一實例的樣板抄

[[architecture/parent-read-endpoints]]（#351，已批准/已驗收）立的三道防線是這個
專案目前的授權樣板，這支照抄：

1. `childId` 必填 query 參數，一次只看一個孩子
2. `isChildAllowed(scope, childId)` 越權指名回 403 不回空
3. 複用 admin 端（`routes/class-logs.ts`）的 select 與 mapper，不照抄一份
4. allowlist 欄位過濾（明確列出保留的欄位，不是刪除要遮的）

## 一、「已發布」的判定：`published_at IS NOT NULL`

這是 v1a 收斂時定案的，不是新決定——`class_logs.published_at` 的欄位註解已經寫得
明白：「NULL = 草稿；有值 = 已發布」，admin 端的 `isPublished: Boolean(published_at)`
就是這個判準。**家長端沿用同一個判準，不重新定義**。

## 二、家長看不到未發布的

**不行。** 理由三條，互相獨立就已經各自成立：

1. **`published_at` 是「廣播扳機」**（`class_logs.ts` 檔頭原話）——它存在的唯一
   理由就是把「寫」跟「公開」分兩個動作。讓草稿對家長可見等於拔掉這個扳機，
   這支端點會變成「教務日誌即時同步」，那是另一個功能。
2. **`teaching-log-rules.md` 明講**：「紙本傳的是公司內部群組，老師會寫不給
   家長看的話。」草稿階段的內容沒有經過「這句話家長看了沒問題嗎」這道篩選，
   已發布的才篩過。
3. **teacher-pages 的下游依賴**：他還沒放發布按鈕，是因為「發布」目前沒有任何
   可觀察的效果（P4 的 LINE 推播與這支都還沒做）。這支端點**就是**讓發布產生
   效果的那個下游——用「已發布」當唯一的可見性條件，才對得上他放按鈕時的心智
   模型：按下去 = 家長現在看得到。

查詢條件：`published_at IS NOT NULL`，沒有例外、沒有管理員視角的參數可以繞過
（這支端點角色層本來就只開放 `parent`）。

## 三、scope 機制：class_logs 是班級層級，`childDb` 現有 API 假設表上有 `student_id`

### 落差在哪

`lib/child-db.ts` 的 `createChildDb().from(table, studentIdColumn)` 假設每張表都有
一欄可以直接拿 `studentId` 去 `.in()`。`attendance_records` / `academy_scores` /
`school_scores` / `invoices` 都符合，`class_logs` 不符合——它是 `class_id` + `log_date`，
沒有任何一欄指向學生。

### 兩步驟查詢，兩個都要通過授權

1. **第一步（真的 student_id 查詢，用 `childDb.from().pluck()`）**：查這個孩子的
   `enrollments`（`class_id, effective_from, effective_to`），**一次拿到兩樣東西**：
   完整列（給下面的 `countEnrolledOn` 用）與品牌化的 `class_id` 清單（給第二步用）。
   一次做完是刻意的——如果查詢跟品牌化分成兩步，品牌化那步就得接受「任意 rows」，
   又把同一個洞打開一次。
2. **第二步（`class_id` 查詢，`childDb` 需要擴充）**：用第一步拿到的品牌化清單
   查 `class_logs`。**這裡的安全性不是靠 `.in()` 對照 `studentScope`**（class_logs
   跟學生範圍無關），**是靠型別保證這份清單只可能來自第一步的合法查詢**——見下方
   `ScopedIds` 的設計。

### 提案：`ScopedIds` 品牌型別 + `pluck()` / `fromScopedIds()`

> **修正（計畫席審查）**：第一版寫 `fromScopedIds(table, column, ids: readonly string[])`，
> 安全性只寫在註解裡（「呼叫端必須自己證明 ids 合法」）。**這句話就是問題本身** ——
> `readonly string[]` 接受任何陣列，一個合法呼叫和一個災難性呼叫在型別上長得
> 一模一樣。這是第二實例，後面會被照抄；抄的人只看得到方法名（聽起來安全）跟
> 簽名（收 `string[]`），看不到那句只活在文件裡的警語。**改成型別擋，不是註解擋**：

```ts
// lib/child-db.ts
declare const scopedIdsBrand: unique symbol;
/** 只能由 childDb 自己的 `pluck()` 產生，見下方。 */
export type ScopedIds = readonly string[] & { readonly [scopedIdsBrand]: true };
```

`from()` 回傳的物件新增一個 `pluck()`（跟既有的 `select()` 平行，一樣先套
`studentScope` 的 `.in()`）：

```ts
from(table: string, studentIdColumn: string) {
  const scopedQuery = () => {
    const query = supabase.from(table);
    return scope === null ? query : query.in(studentIdColumn, [...scope]);
  };
  return {
    select(columns: string, options?: {...}) { ... 現有邏輯 ... },
    /**
     * 查這張表，**一次拿到完整列與品牌化的 `ScopedIds`**（某一欄去重後的值）。
     * 兩樣一起回是刻意的：呼叫端往往兩樣都要（完整列做進一步的業務判斷，
     * `ids` 拿去查另一張沒有 `student_id` 的表），分成兩次查詢還得保證
     * 「後面那次的 ids 真的是從前面那次算出來的」——這裡直接用同一個
     * scoped 查詢的結果算兩種輸出，不留那個縫。
     */
    async pluck(
      columns: string,
      idColumn: string,
    ): Promise<{ rows: Record<string, unknown>[]; ids: ScopedIds; error: unknown }> {
      const { data, error } = await scopedQuery().select(columns);
      if (error) return { rows: [], ids: [] as unknown as ScopedIds, error };
      const rows = (data ?? []) as Record<string, unknown>[];
      const ids = [...new Set(rows.map((row) => row[idColumn] as string))];
      return { rows, ids: ids as unknown as ScopedIds, error: null };
    },
  };
},
fromScopedIds(table: string, column: string, ids: ScopedIds) {
  return {
    select(columns: string, options?: {...}) {
      return supabase.from(table).select(columns, options).in(column, ids);
    },
  };
},
```

**驗證過可行**：branded type 這招在這個結構上跑得通——寫了一個對照組原型
（陽性：`pluck()` 產生的 `ScopedIds` 傳給 `fromScopedIds` 型別過；陰性：拿掉
`@ts-expect-error` 直接塞一個裸 `string[]` 進 `fromScopedIds`，`tsc --strict`
正確回報 `TS2345: Property '[scopedIdsBrand]' is missing`）。

**現在「呼叫端必須自己證明合法」從一句請求變成一個編譯錯誤**：想塞一個從別處
算來的 id 清單進 `fromScopedIds`，唯一的路是寫一個看得見的 `as unknown as ScopedIds`
——那正是這個設計要的效果：**錯的寫法比對的寫法還長、還顯眼**，不是拿掉。

**日期邊界要另外做，不能只憑「曾經在籍」的班級清單**：轉班的孩子如果只用
「曾經在籍的班級清單」查 `class_logs`，會看到**轉班前那個班在他加入之前**的日誌
——那是過度曝光（別班在他不在的時候寫了什麼，跟他無關）。所以拿到 `class_logs`
的原始資料後，還要在應用層用第一步 `pluck()` 回傳的 `rows`（轉成
`lib/session-roster.ts` 的 `EnrollmentRange[]`）過一次
`countEnrolledOn(enrollmentRanges, row.classId, row.logDate) > 0`（已經是共用函式，
`session-summary.ts` 也在用同一份），只留下「那一天真的在籍」的日誌。

**這條防線很容易漏，寫測試時要專門釘一個「轉班」情境**：孩子 3 月從 A 班轉到 B 班，
查詢要漏掉「A 班 4 月的日誌」（他已經不在）與「B 班 2 月的日誌」（他還沒加入）。

## 四、欄位過濾

| 欄位               | 家長端回不回        | 理由                                                                                                                                                                                      |
| ------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `homework`         | ✅ 回               | `teaching-log-rules.md` 定案：作業安排家長可見                                                                                                                                            |
| `teachingRecord`   | ❌ 不回             | 定案：教學紀錄預設內部，紙本現實是「不給家長看的話」                                                                                                                                      |
| `publishedAt`      | ✅ 回               | 家長可能想知道「什麼時候發的」，不是內部資訊                                                                                                                                              |
| `className`        | ✅ 回               | 家長看多個班的日誌時要分得清是哪一班                                                                                                                                                      |
| `lastEditedByName` | ✅ 回（計畫席拍板） | 跟出缺席的 `recordedBy` 不同——那是**內部經手人 id**，對家長零意義；這裡是**姓名**，回答了家長真的會問的問題（「這是哪位老師寫的？」）。家長本來就知道孩子的老師是誰，沒有揭露不該知道的事 |
| `id`               | ✅ 回               | 前端需要它當 row key                                                                                                                                                                      |

## 五、端點形狀

`GET /api/me/class-logs?childId=&dateFrom=&dateTo=&page=&pageSize=`

回應：

```ts
{
  data: Array<{
    id: string;
    classId: string;
    className: string | null;
    logDate: string;
    homework: string;
    publishedAt: string; // 這裡一定非 null——查詢條件已經濾掉草稿
    lastEditedByName: string | null; // 計畫席已拍板：回
  }>;
  meta: {
    total: number;
    page: number;
    pageSize: number;
    /** 過去 7 天內發布的篇數，跟 GET /api/me/grades 的 recentCount 同一個判準 */
    recentCount: number;
  }
}
```

`recentCount` 一樣走獨立的 count 查詢（`published_at >= 7 天前` + 應用層的
`countEnrolledOn` 過濾），不靠當頁筆數——跟 [[architecture/parent-read-endpoints]]
的三支端點同一個判準（分頁截斷不能拿來算總數）。

**分頁在應用層做**（跟 `/api/me/grades` 合併 academy/school 兩種來源同一個理由）：
`class_logs` 本身可以在 DB 分頁，但 `countEnrolledOn` 的過濾在拿到資料**之後**才能
判斷，DB 分頁會把「這一頁 20 筆」的 20 筆裡混進之後會被過濾掉的列，導致回傳筆數
少於預期且無法用 `range()` 好好對齊。做法：抓一個較寬鬆的候選集合（例如
`.in('class_id', enrolledClassIds)` 全撈，不下 `range()`），過濾後才在記憶體裡切頁。

**候選集合要有上限，天花板寫出來，不是留給以後才發現**（計畫席審查補的要求）：
候選查詢加 `.limit(500)`（一個孩子讀滿 3 年、跨 5 個班，一天一篇也才約 750 個
上課日——500 對 v1 的實際量級留了餘裕，數字本身不是精算，是「肉眼可判斷夠不夠」
的量級）。**升級路徑寫在扣到上限那一刻**：如果候選集合真的頂到 500（表示
`enrolledClassIds` 涵蓋的班級數 × 日誌篇數超出預期），改成用 `log_date` 區間分段
掃（例如每次只掃 90 天）取代一次全撈，而不是無限拉高上限。這是**已知的天花板**，
不是債——寫出來的捷徑是工程，沒寫出來的是債。

## 明確不做（這輪）

- **已閱（`log_acknowledgements`）的讀取與寫入**——那是 v1b 讀取頁生效之後的
  下一步（可能是 v1c），這支只回日誌內容，不回、也不管已閱狀態
- **LINE 推播**——P4 的另一塊，這支只管站內
- **教學紀錄的可見性開關**——`class_logs` 的欄位設計已經預留了未來做開關的空間
  （見 migration 註解），但這輪維持「教學紀錄一律內部」的定案，不做開關
- **`junior_high_ack_enabled` 的讀取**——這個 org 層開關只在「已閱」功能生效時
  才有意義，這輪不碰

## 審批狀態

**2026-09-05 計畫席批准，帶三個條件，全部已收進本文件：**

1. `fromScopedIds` 改用 `ScopedIds` 品牌型別擋，不能只靠註解——已改為
   `pluck()` / `fromScopedIds()` 的設計，並驗證過 `tsc --strict` 真的擋得住
   裸陣列
2. 候選集合分頁要寫出上限與升級路徑——已補 `.limit(500)` 與「頂到上限時改
   分段掃」
3. `lastEditedByName` 回——已拍板，欄位過濾表與回應形狀都更新了

**保留類（授權邏輯）**：這支 PR 屬合併授權 v2 保留給使用者親合的三類之一，
標記後由計畫席報進使用者窗口，不自行合併、不請 steward 代合。

**實作前提**：等 [[architecture/parent-read-endpoints]]（#351）進 `main` 之後才
開工——它是第一實例，這支的三道防線都是照它抄的，在它還可能被改的時候做第二支
等於照一份未定稿的樣板抄。
