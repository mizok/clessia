# 成績模組 UX 重設計

> 日期：2026-04-15
> 範圍：考試管理手機版篩選、成績登錄頁面全面重構、成績總覽改為入口式設計

---

## 1. 考試管理 — 手機版篩選收合

### 問題

手機版篩選有 6 個元素分佈在 2-3 行，佔掉半個螢幕。

### 設計

- **桌面版**：維持現狀不變（搜尋 + 時間範圍 / 類型 + 校區 + 科目 + 狀態）
- **手機版**：只顯示搜尋框 + 「篩選」按鈕
  - 點擊「篩選」按鈕打開 **PrimeNG Dialog**（非 bottom sheet）
  - Dialog 內容：時間範圍（SelectButton）、考試類型（SelectButton）、校區（Select）、科目（Select）、狀態（Select）
  - Dialog 底部：「清除」+ 「套用」兩個按鈕
  - 若有啟用篩選，「篩選」按鈕旁顯示啟用數量 badge（如「篩選 (3)」）
- **斷點**：`max-width: 768px` 時切換為收合模式

### 影響檔案

- `exams.component.html` — 手機版篩選改為按鈕 + dialog
- `exams.component.ts` — 新增 dialog 開關邏輯
- `exams.component.scss` — 手機版隱藏 toolbar，顯示篩選按鈕

---

## 2. 成績登錄 — 桌面版表格修復

### 問題

- input/select 在欄位內重疊溢出
- 年級顯示 K12 代碼（P1、J2）而非中文
- 「已作答」狀態名稱不直覺

### 設計

#### 2a. 欄位寬度調整

| 欄位 | 寬度 | 說明 |
|------|------|------|
| 學生 | `120px` | 固定寬度，不需太長 |
| 年級 | `60px` | 精簡 |
| 分數 | `120px` | 含 input |
| 狀態 | `120px` | 含 select |
| 備註 | 剩餘空間 | `flex: 1` 或不設寬度 |

- 所有 input/select 設為 `width: 100%`，不設 `max-width` 避免溢出
- 表格使用 `table-layout: fixed`

#### 2b. 年級中文化

將 K12 代碼轉為中文顯示。轉換邏輯已存在於 `term-score-editor` 的 `GRADE_OPTIONS`，academy editor 也需套用：

| 代碼 | 顯示 |
|------|------|
| P1-P6 | 小一～小六 |
| J1-J3 | 國一～國三 |
| S1-S3 | 高一～高三 |

建立共用函式 `formatGradeLabel(grade: string): string`，academy 和 term editor 共用。

#### 2c. 狀態名稱修正

- `scored`：「已作答」→ **「未登錄」**
- `absent`：「缺考」維持不變
- `makeup`：「補考」維持不變

> 說明：scored 是預設狀態，代表尚未登錄分數，改名為「未登錄」更直覺。

### 影響檔案

- `academy-score-editor.component.ts` — STATUS_OPTIONS 修改、年級格式化
- `academy-score-editor.component.scss` — 欄位寬度調整
- `academy-score-editor.component.html` — 年級顯示套用格式化
- `term-score-editor.component.ts` — STATUS_OPTIONS 修改
- 共用：新增 `formatGradeLabel` 工具函式（放在 shared 或 inline）

---

## 3. 成績登錄 — 手機版重設計

### 問題

目前手機版每個學生渲染成完整卡片（分數/狀態/備註全攤開），佔空間大、找人困難。

### 設計：純列表 + Bottom Sheet

#### 列表

- 每個學生一行：**姓名** · 年級（右側顯示分數或「未登錄」/「缺考」）
- 分數顏色邏輯：
  - 未登錄：`zinc-400`
  - 已登錄：`sky-700`（正常）/ `red-600`（< 60 不及格）
  - 缺考：`amber-500`
- 列表頂部有搜尋框 + 年級篩選（Select）
- 點擊任一行開啟 Bottom Sheet

#### Bottom Sheet（PrimeNG Dialog，position bottom）

- 頂部拖曳條（視覺裝飾）
- 學生姓名 + 年級
- 表單欄位：分數輸入、狀態選擇、備註輸入
- 修改後自動標記 dirty（列表中該行顯示修改指示）
- 無獨立儲存按鈕，修改後關閉 sheet 即回到列表，統一由 FAB 儲存

#### 實作方式

- 使用 PrimeNG `Dialog` 搭配 `position="bottom"` + `styleClass` 模擬 bottom sheet 外觀
- 或使用 PrimeNG `Drawer`（`position="bottom"`）

### 影響檔案

- `academy-score-editor.component.html` — 手機版卡片列表改為純列表 + dialog
- `academy-score-editor.component.scss` — 移除 `__card-list` 等卡片樣式，新增列表 + sheet 樣式
- `academy-score-editor.component.ts` — 新增 sheet 開關邏輯、選中學生 signal
- `term-score-editor` 同理（手機版科目卡片改為列表 + sheet）

---

## 4. 成績登錄 — FAB 儲存按鈕

### 問題

sticky footer 視覺干擾大，佔用底部空間。

### 設計

- 移除現有的 `__actions` sticky footer
- 改為 **FAB（Floating Action Button）**，位於右下角
- 只在 `dirty === true` 時顯示，帶 fade-in + slide-up 動畫（150ms ease-out）
- 外觀：膠囊形，sky-600 背景，白字，帶 shadow
- 內容：儲存圖標 + 「儲存成績」文字
- `saving` 時顯示 spinner，disable 點擊
- 「返回考試管理」按鈕移到 breadcrumb 區域（已有 breadcrumb 可導航回去，或放在頁面頂部）

### 影響檔案

- `score-entry.component.html` — 移除 `__actions`，新增 FAB
- `score-entry.component.scss` — 移除 `__actions` 相關樣式，新增 `__fab` 樣式
- `score-entry.component.ts` — 無需大改，`canSave` / `saving` 邏輯不變

---

## 5. 成績登錄 — 頭部儀表板精簡（手機版）

### 問題

手機版頭部儀表板（統計數字）以卡片形式呈現，佔空間太多。

### 設計

- **桌面版**：維持 inline stats 橫排（已登錄 / 平均 / 最高 / 最低）
- **手機版**：stats 改為單行摘要文字，不再各自是獨立卡片
  - Academy：「已登錄 12 筆 · 平均 78.5 · 最高 98 · 最低 45」
  - Term：「共 24 筆已登錄」+ 各科目一行文字
- 移除手機版 `__stat` 的 `background`、`border-radius` 卡片樣式

### 影響檔案

- `score-entry.component.html` — 手機版 stats 改為文字摘要
- `score-entry.component.scss` — 手機版 stats 樣式精簡

---

## 6. 成績總覽 — 入口式設計

### 問題

目前用 SelectButton tab 切換視角，沒有入口感，且進場需要先搜尋才有資料。

### 設計

#### 6a. 路由結構

```
/admin/grades/overview          → 入口頁（OverviewComponent）
/admin/grades/overview/student  → 學生視角（StudentViewComponent）
/admin/grades/overview/class    → 班級視角（ClassViewComponent）
```

- 入口頁和子視角都是獨立路由（非 tab 切換）
- 麵包屑導航：成績總覽 > 學生視角 / 班級視角

#### 6b. 入口頁

- 頁面標題「成績總覽」+ 副標「選擇檢視模式」
- 兩個大方塊並排（手機版堆疊）：
  - **學生視角**：圖標 + 標題 + 一行描述
  - **班級視角**：圖標 + 標題 + 一行描述
- 使用 PrimeIcons（`pi-user` / `pi-building`），不用 emoji
- 點擊方塊 `router.navigate` 到對應子路由
- 移除現有的 `__mode-card` 說明卡和 `__toolbar` SelectButton

#### 6c. 學生視角（重構）

- **預設載入第一個分校的學生清單**（不需先搜尋）
- 篩選列：分校（Select）+ 搜尋框 + 年級（Select）
- 學生列表每行：姓名 · 年級 · 右側顯示「N 筆成績 · 平均 XX」
- 分頁顯示
- 點擊學生展開/導航到成績明細（維持現有的 autocomplete 選中後顯示明細的模式，但改為從列表點擊觸發）
- 點擊後下方展開成績明細（含科目摘要卡片 + 成績表格），與現有邏輯相同

**需要新 API**：`GET /api/scores/students?campusId=xxx&grade=xxx&search=xxx&page=1&pageSize=20`
- 回傳：學生清單 + 每人的成績筆數與平均
- 現有 API 是搜尋單一學生後載入成績，需要新增列表端點

#### 6d. 班級視角（重構）

- **預設載入第一個分校的班級**，按課程分組
- 篩選列：分校（Select）+ 搜尋框（搜尋班級名稱）
- 課程分組標題：課程名稱 +（適合年級範圍）
- 每個班級一行：班級名稱 · 學生數 · 考試場數
- 點擊班級 → 展開該班的考試列表（Select 選考試 → 顯示成績統計和排名）
- 考試統計和排名沿用現有邏輯

**需要新 API**：`GET /api/scores/classes?campusId=xxx&search=xxx`
- 回傳：按課程分組的班級清單 + 每班學生數與考試場數
- 或可組合現有 API（classes + exams count）

### 影響檔案

- `overview.component.ts/html/scss` — 改為入口頁，移除 tab 切換
- `student-view.component.ts/html/scss` — 重構為獨立路由頁面，預載學生清單
- `class-view.component.ts/html/scss` — 重構為獨立路由頁面，按課程分組
- 路由設定：grades 的子路由新增 `overview/student` 和 `overview/class`
- API 層：新增學生清單 API 和班級分組 API（或調整現有端點）

---

## 設計決策摘要

| # | 決策 | 選項 |
|---|------|------|
| 1 | 手機版篩選 | 收合為搜尋 + 篩選按鈕 → Dialog |
| 2 | 桌面版表格 | 固定欄寬、學生 120px、table-layout fixed |
| 3 | 年級顯示 | K12 代碼轉中文（國一、國二…） |
| 4 | 狀態名稱 | scored: 已作答 → 未登錄 |
| 5 | 手機版學生列表 | 純列表 + 點擊開 Bottom Sheet 編輯 |
| 6 | 儲存按鈕 | 移除 sticky footer，改 FAB（dirty 時浮現） |
| 7 | 手機版 stats | 卡片改為單行摘要文字 |
| 8 | 成績總覽 | 入口式設計，兩個大方塊選視角 |
| 9 | 學生視角 | 預設載入第一分校學生清單，不需先搜尋 |
| 10 | 班級視角 | 按課程分組顯示班級 |
| 11 | 路由 | 入口 + 子路由（overview / overview/student / overview/class） |

---

## 不在範圍內

- Codex 發現的後端安全問題（org settings 缺 admin check 等）— 另案處理
- Hard-coded 色彩值替換為 token — 可在實作時順手修正
- Academy score editor 的 class filter 實際功能 — 另案處理
