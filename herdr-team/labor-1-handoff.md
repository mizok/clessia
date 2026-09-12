# labor-1 交接清單（2026-09-12）

> 這一席交出去的東西、沒做完的東西、以及**已交付但有已知洞的東西**。
> 「這一席怎麼工作」在 [`labor-1.md`](labor-1.md)，UI 地圖的方法在
> [`kb/wiki/specs/sitemap/README.md`](../kb/wiki/specs/sitemap/README.md)。

## 已交付（全部已合）

| PR   | 內容                                          |
| ---- | --------------------------------------------- |
| #679 | `#661` A 類六支搜尋收進 `switchMap` 管線      |
| #688 | `#685` Phase 0：生成器 + 方法頁 + 三頁範本    |
| #700 | `ADMIN_ACADEMICS` 5 頁 + `_shared` 兩支對話框 |
| #709 | `ADMIN_LEARNING_CENTER` 5 頁 + 方法頁三段訂正 |
| #715 | 成績登錄（`LEARNING_CENTER` 6/6）             |

**`ADMIN_ACADEMICS`（5）與 `ADMIN_LEARNING_CENTER`（6）兩群全部完成，每頁兩向比對 0 筆差異。**

## 沒做完的

| 項目                            | 狀態                                                       |
| ------------------------------- | ---------------------------------------------------------- |
| `ADMIN_STUDENT_AFFAIRS`（6 頁） | **已交棒 labor-2**（2026-09-12），它在做 `/admin/students` |
| `#661` B 類三支                 | **沒人做**。issue 已重開，見下                             |
| `#693` 生成器角色欄             | 計畫席移給 labor-2，我沒碰                                 |

### ⚠️ `#661` B 類三支還沒做，而且我曾經害它消失過

`parents/parents.page`、`school-score-editor`、`class-picker-dialog` ——
三支都有 `debounceTime(300)` + `distinctUntilChanged`，**但沒有 `switchMap`**。

我在 PR #679 寫了 `Closes #661` 而只做了 A 類，**issue 被整個關掉**，
B 類三支從此不在任何人的佇列上。後來開工前查狀態才撞見並重開。

**跨多片的 issue 用 `Refs #N`，最後一片才用 `Closes`。**

## ⚠️ 已交付但有已知洞的三處

### 1. 四頁可能漏掉可點的列（`[tabindex]` 修正之前畫的）

方法頁的取樣器原本沒有 `[tabindex]:not([tabindex="-1"])`，所以**可點但沒有 `role` 的
`<tr>` / `<div>` 一個都看不到**（labor-2 在 `/admin/enrollments` 抓到，那一頁差 12 個）。

**我畫過的頁逐頁查過，沒有中** —— `admin/pages` 底下帶 `tabindex` 的 5 個檔裡我只佔 2 個
（`courses`、`class-detail`），而那兩處都**同時帶 `role="button"`**，舊選擇器抓得到。

**但別席的要查**：`payments`（labor-4 已交）、`contact-book`（labor-2 批次內）
也在那 5 個檔裡。修正本身在這支 PR 裡。

### 2. `_shared/audit-log-dialog` 的欄位有一半是讀原始碼得到的

我只實地開過空狀態（`/admin/courses`）。labor-4 後來在 `/admin/payments` 補驗，
**推翻了兩處我從原始碼推的結論**（「每列可展開」在桌機下根本不存在、分頁器樣板永遠不會出現）。

**那一頁現在是對的**，但它示範了一件事：**讀原始碼寫出來的欄位清單，
讀起來跟量過的一模一樣。** 剩下 4 個開啟點仍未實地開過。

### 3. `/admin/grades/overview/class` 有一個沒解的不一致

文字層看得到「文山旗艦校」，但 `dropdown trigger` 只數到 2 個（年級、科目）——
**兩者對不起來**，我沒釐清那一格是下拉還是純文字。已記在該頁未驗表。

## 未驗清單總覽（逐頁詳情在各自的「未驗到的」表）

| 頁                                                                                                                     | 未驗項 |
| ---------------------------------------------------------------------------------------------------------------------- | ------ |
| `admin/sessions`                                                                                                       | 8      |
| `admin/courses`                                                                                                        | 8      |
| `admin/courses/:courseId/classes/:classId`                                                                             | 9      |
| `admin/grades/exams/:type/:id/scores`                                                                                  | 8      |
| `admin/grades/exams`                                                                                                   | 7      |
| `_shared/shell-layout`                                                                                                 | 7      |
| `admin/dashboard` / `admin/changes` / `grades-overview-student` / `grades-overview-class` / `_shared/audit-log-dialog` | 各 6   |
| `_shared/confirm-dialog`                                                                                               | 5      |
| `admin/attendance`                                                                                                     | 4      |
| `admin/grades` / `grades-overview`                                                                                     | 各 3   |

**多數的原因是同一類，按數量排：**

1. **會寫入** —— 全程零寫入是工單邊界，所以「按下確認之後」一律沒驗
2. **本機資料造不出那個狀態** —— 例如沒有未指派老師的課堂、沒有超過 20 筆的異動月份、
   沒有可刪除的班級（7 個班全部有歷史課堂）
3. **載入中 / 錯誤** —— 沒有攔截 API 的手段，而關掉共用的 8787 會影響別席
4. **手機寬度** —— 本輪只量 1504/1568px 桌機；手機版是另一套 DOM（每頁都有 3–10 個
   不可見元素是它），**應該另開一輪而不是順手補**

### 最值得下一輪優先做的三個

1. **`/admin/attendance` 帶 query 參數轉址後，參數有沒有被 `/admin/sessions` 套用** ——
   那是儀表板「未點名課堂」卡片的整條路徑，正要驗的時候 session 被踢掉就沒補
2. **班級詳情 `待付款` / `暫停` 兩種狀態的學生選單** —— 只量過「在籍」，
   另外兩種很可能不同（「暫停」應該是恢復不是停權）。**沒量就沒寫**，那是「出現條件」
   欄最容易被想當然的地方
3. **成績登錄的「儲存成績」** —— 做不出 dirty 狀態（焦點掉了），條件目前是從原始碼讀的

## 開過的 issue

| #    | 內容                                                                         |
| ---- | ---------------------------------------------------------------------------- |
| #686 | 儀表板把停課的課堂顯示成「未點名」，還算進「還沒點名」的數字                 |
| #698 | 一整頁 admin 出勤元件接不到（路由改成 redirect，元件 + 21.8KB 測試留在原地） |

兩支都**沒有順手修**，照工單邊界開單給計畫席。

## 我沒查的東西（免得下一個人以為查過了）

- **#698 那支元件為什麼被改成 redirect** —— 沒翻 git log。正確處置是「刪掉」還是
  「接回來」是產品決定，不是我的
- **`/admin/grades` 的三條舊路由 redirect**（`academy-exams` / `school-exam-entry` /
  `score-records`）—— 只從 `app.routes.ts` 讀到，沒實測
- **`admin/leave` 傳給 audit-log 的 `resourceTypes`** —— 那頁在交棒出去的批次裡，
  已請 labor-2 補進 `_shared/audit-log-dialog` 的表
