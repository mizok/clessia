# P3 老師端 —— 開工前盤點

> 2026-08-30，billing-api 席。**唯讀盤點，零程式碼改動。**
> 基準：`origin/main` @ `20774de`（含 #61 #62 #63）。
>
> P3 = 老師端補完：點名、成績登錄、聯絡簿撰寫、教務日誌撰寫（roadmap）。
> 約束：roadmap 說老師端**幾乎只在手機上用**，手機優先要在這階段做，不是留到 P6。

---

## TL;DR

| 面向              | 狀況                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| 聯絡簿 / 教務日誌 | **後端已完備**（含老師範圍與寫入），P3 是**純前端切片**                                                |
| 點名              | 後端完備，前端可用但**課表在 375px 需要橫向捲動**                                                      |
| 成績登錄          | **後端整條缺**：API 是 ADMIN_ONLY，且 `academy-exams` / `scores` **完全沒有 teacher-scope 程式碼**     |
| 老師端 spec       | 六份有**四份是二月 PRD 時代**、未經 8 月的架構決定校正，含**指向不存在的資料表**與**不存在的出勤狀態** |
| 手機優先          | 老師端四頁的 SCSS **零個 media query**（全 app 有 39 個檔案在用 `respond-to`，admin 佔 30）            |

---

## 一、specs/teacher/*.md 的時效驗證

比照 finance specs 被抓出「與訪談定案矛盾」的先例逐頁對照。

| 檔案               | `updated`  | 判定                                           |
| ------------------ | ---------- | ---------------------------------------------- |
| `attendance.md`    | 2026-08-19 | 🟡 路徑已校正，但**狀態機錯誤**（見 A）        |
| `assessments.md`   | 2026-02-13 | 🔴 描述一個不存在的頁面 + 不存在的權限（見 B） |
| `dashboard.md`     | 2026-02-13 | 🔴 指向不存在的資料表（見 C）                  |
| `schedule.md`      | 2026-02-13 | 🟡 大致成立，但依賴 B、C 的功能（見 D）        |
| `students.md`      | 2026-02-13 | 🟡 統計摘要未實作，且引用不存在的欄位（見 E）  |
| `notifications.md` | 2026-02-13 | 🟢 與現況相符                                  |

### A. `attendance.md`：出勤狀態機是錯的

spec 寫「點擊學生可切換狀態：**出席 → 遲到 → 請假 → 缺席**」。

但 `attendance_status` enum 實際是 `('present', 'absent', 'on_leave')`
（`20260330000003_create_attendance_records.sql:4`）—— **沒有「遲到」**。

> 這是同一隻幽靈的第二次出現。A2 的工單也寫過「present/late」，當時已經確認過
> `late` 不存在。**spec 是它的來源**，不修的話還會有第三次。

同頁「僅限當天課堂」也不精確：實際是 org 設定的補登窗
（`organizations.attendance_retroactive_days`）。**而且那個窗只在前端擋**
（`teacher/schedule.page.ts:124` 讀設定，API 沒有對應檢查）—— 見「要裁決的事」第 3 點。

### B. `assessments.md`：整頁描述一個不存在的東西

- **路徑 `/teacher/assessments` 不存在**（老師端只有 dashboard / schedule / students / notifications 四頁）
- spec 寫「僅顯示自己任課的班」「從自己的課堂中選」—— 但 `academy-exams` / `school-exams` / `scores` 三支
  API 全是 `ADMIN_ONLY`（`index.ts:257-259`），而且 **`grep -c teacher-scope` = 0**：
  那三支路由裡沒有任何「縮限到自己任課班級」的程式碼。
- 換句話說：spec 描述的老師端考試管理，**後端一行都還沒寫**。

### C. `dashboard.md`：指向不存在的資料表

`資料依賴` 表列了 **`teacher_logs`** —— 這張表不存在。

教務日誌實際叫 **`class_logs`**（`20260829100000`，#48）。grilling 總表明說命名是為了
**避開既有 teaching-log 撞名**，所以這不是改名，是 spec 引用了一個從未存在的表。

同頁「待處理提醒（未填聯絡簿、未登錄成績）」也未實作 —— 現況的老師儀表板只有
本週課堂、今日課堂、學生數三塊（`dashboard.component.ts:40-47`）。

### D. `schedule.md`：主體成立，但依賴尚未存在的功能

「課堂詳情 Popup → 編輯聯絡簿按鈕」「待處理標記（●）：聯絡簿未填或成績未登錄」
兩者都依賴 B、C 沒有的東西。課表本體與點名入口是實作了的。

### E. `students.md`：統計摘要未實作

spec 寫「出勤統計摘要（出席率、**遲到次數**、缺席次數）」「成績統計摘要」——
頁面模板裡沒有任何統計區塊，而且「遲到次數」同樣建立在不存在的狀態上（見 A）。

---

## 二、既有四頁 × P3 新需求的落差

### 點名：後端完備，前端夠用但手機有問題

- 資料走 `/api/attendance`（`['admin','teacher']`，`attendance/teacher-scope.ts` 有縮限）
- 點名 UI 是 `attendance-roster-panel`，以 dialog 開啟（`schedule.page.ts:145`，`width: '480px'`）
- **480px 的 dialog 在 375px 螢幕上不會爆版** —— `styles.scss` 有全域的 mobile override
  （`.p-dialog` 的 `max-width: calc(var(--window-width, 100vw) - var(--space-2) * 2)`）。這一項已經被處理過了。
- 真正的問題在課表本體，見第三節。

### 聯絡簿 / 教務日誌：**後端已完備，P3 是純前端切片**

|          | 端點                                        | 角色                  | 老師範圍                        |
| -------- | ------------------------------------------- | --------------------- | ------------------------------- |
| 聯絡簿   | `PUT /api/contact-book`（upsert）           | `['admin','teacher']` | ✅ 讀寫都過 `loadTeachingScope` |
| 教務日誌 | `PUT /api/class-logs`、`POST /{id}/publish` | `['admin','teacher']` | ✅ 讀寫都過 `loadTeachingScope` |

`#48` 的 API 涵蓋得很完整，`teacher-scope` 也夠 —— 老師只能碰自己**固定任課**
（`schedules.teacher_id`，不含代課）的班。**這兩塊 P3 不需要任何後端工作。**

（另有 `GET /api/contact-book/missing`（#69，待合）給「今天該寫還沒寫」的待辦清單。）

### 成績登錄：**整條缺，而且不是改個 mount 就好**

- 寫入路徑是 `POST /api/academy-exams/{examId}/scores`（`academy-exams.service.ts:176`）
- `scores.ts` **只有 GET**，沒有任何寫入端點
- 三支路由都是 `ADMIN_ONLY`，而且**沒有 teacher-scope 程式碼**

把 mount 改成 `['admin','teacher']` 是**不安全的**：那會讓任何老師讀寫全校的考試與成績。
要開給老師，得先在 `academy-exams` / `school-exams` / `scores` 補上範圍限制
（`lib/teacher-scope.ts` 已有可複用的 `taughtClassIds`）。**這是 P3 最大的後端工作量。**

---

## 三、手機優先的現況體檢（375px）

**老師端四頁的 SCSS 沒有任何一個 media query。**

```
apps/web/src/app/features/teacher/**/*.scss  →  0 個 @media / respond-to
全 app                                        →  39 個檔案用 respond-to（admin 佔 30）
```

breakpoint 的慣例（`respond-to('mobile')`）在這個 repo 是成熟且被廣泛使用的 —— 老師端
只是**從來沒有採用**。這不是缺工具，是缺工。

### 最嚴重的一處：課表在手機上必須橫向捲動

`schedule.page.scss:33-45`

```scss
&__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  overflow-x: auto;
}
&__day {
  min-width: 120px;
}
```

7 欄 × 120px = **至少 840px**。375px 的螢幕上，老師的主畫面要橫向捲動才看得完一週。
`overflow-x: auto` 讓它不爆版，但那是「不壞掉」不是「好用」——
而這一頁正是 roadmap 說「幾乎只在手機上用」的那一頁。

同檔 `&__week-label { min-width: 200px }` 在窄螢幕的 header 也會擠壓旁邊的按鈕。

---

## 四、P3 開工清單

### 先做：spec 重寫（**擋住後面所有切片**）

`assessments.md` 與 `dashboard.md` 的錯誤會直接複製到實作裡 —— 尤其「遲到」狀態已經
擴散過一次（A2 工單）。建議順序：

1. `attendance.md` —— 修狀態機（拿掉「遲到」）、把「僅限當天」改成補登窗
2. `assessments.md` —— 依「老師端成績登錄要不要做、做到哪」重寫（要裁決，見下）
3. `dashboard.md` —— `teacher_logs` → `class_logs`；待處理提醒的定義對齊 `/contact-book/missing`
4. `students.md` —— 拿掉「遲到次數」；統計摘要的範圍要裁決

### 後端缺口（依大小排序）

| 缺口                                                         | 大小   | 備註                                                           |
| ------------------------------------------------------------ | ------ | -------------------------------------------------------------- |
| `academy-exams` / `school-exams` / `scores` 的 teacher-scope | **大** | 三支路由都要加，且要決定老師能不能**建立**考試還是只能登錄成績 |
| 老師端待處理提醒的聚合端點                                   | 中     | 「未填聯絡簿 + 未登錄成績」；聯絡簿那半 #69 已有               |
| 學生統計摘要（出勤率、成績）                                 | 中     | `scores.ts` 已有 `/student/{id}/summary`，出勤那半要確認       |
| 補登窗的伺服器端檢查                                         | 小     | 目前只有前端擋                                                 |

### 前端切片建議（每片可獨立出貨）

1. **課表手機化** —— 只動 `schedule.page.scss`，把 7 欄 grid 在 mobile 改成單日／可滑動的日列表。零後端，先做掉最痛的
2. **聯絡簿撰寫** —— 後端已完備，純前端。從課堂詳情進入
3. **教務日誌撰寫** —— 同上，含 publish 動作
4. **待處理提醒** —— 依賴新的聚合端點
5. **成績登錄** —— 依賴最大的後端缺口，排最後

---

## 五、要使用者裁決的事

1. **老師能不能建立考試，還是只能登錄成績？** `assessments.md` 寫的是「建立考試 + 輸入成績」，
   但那是二月的設想。這決定 teacher-scope 要加在三支路由還是只加在 scores 的寫入路徑上 ——
   工作量差一倍。
2. **老師端要不要「學生統計摘要」？** `students.md` 承諾了出勤率與成績統計，兩年沒實作也沒人抱怨。
   如果不要，spec 該刪掉那段而不是留著當債。
3. **補登窗要不要在伺服器端擋？** 目前 `attendance_retroactive_days` 只在前端讀
   （`schedule.page.ts:124`）。這是業務規則不是授權，但「前端隱藏不構成授權」的同一個道理
   在這裡也成立 —— 老師直接打 API 可以改任何日期的出勤。
4. **課表手機版要什麼形狀？** 單日檢視 + 左右滑動？還是垂直的「日期分組列表」（`schedule.md`
   原本寫的手機版就是「頂部月曆選擇器 + 課堂列表」，但實作成了 7 欄 grid）。這是設計決定。

---

## 附註：這份盤點沒有做的事

- **沒有真的開瀏覽器量測** —— 375px 的結論是讀 SCSS 推導的（7×120px 的算術是確定的，
  但實際的擠壓程度沒有目視確認）
- 沒有讀家長端 spec（P4 範圍）
- 沒有評估 `notifications.md` 以外的通知需求（LINE 推播是 P4）
