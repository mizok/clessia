# Unified Session Management Design

日期：2026-03-04

## 背景

行事曆與課堂管理功能經過多位開發者（Claude、Codex、Antigravity）協作後，功能已相當豐富，但存在以下結構性問題：

1. **操作割裂**：單堂操作（停課/代課/調課）只在行事曆，批次操作（改時間/停課/取消停課）只在 Session List Dialog，批次指派老師的 Wizard 甚至沒有入口。
2. **Session List Dialog 超載**：分頁、批次操作、preview/apply 流程、衝突處理 — 已經是完整功能頁面，卻硬塞在 modal 裡。
3. **Schedule.teacher_id 與 Batch Assign 矛盾**：同一件事（誰來教）有兩個設定入口。
4. **多分校課堂覆蓋**：行事曆不選分校時，課堂以絕對定位互相覆蓋，無法辨識。
5. **週視圖導航缺乏現在感**：不管是否為本週，subtitle 都只顯示日期範圍。
6. **Wizard 流程過重**：批次指派老師被拆成 4 步 wizard，但 90% 場景只需選老師 + 確認。

## 設計原則

- **單一管理入口**：所有 session 操作都在行事曆頁面完成。
- **兩種視圖，一致能力**：行事曆視圖（視覺化）和清單視圖（表格）共用篩選器和操作。
- **職責分離**：Classes 頁面只負責班級 CRUD + 產生課堂，不涉及 session 管理。
- **YAGNI**：移除不必要的複雜度（wizard、schedule.teacher_id）。
- **responsive-table 優先**：清單視圖使用 `app-responsive-table` 元件。

## 已確認決策

### D1. 行事曆升級為統一的 Session 管理介面

行事曆頁面新增清單視圖，與行事曆視圖並列為同一頁面的兩種 mode。兩種視圖共用：
- 篩選器（分校、課程、班級、老師）
- 操作能力（單堂 + 批次）
- 資料來源

Session List Dialog 廢棄，其功能遷移至清單視圖。

### D2. 分校篩選為必選

行事曆頁面的分校篩選器改為必選（移除 showClear）。預設選擇使用者最常用的分校或第一個分校。若組織只有一個分校，自動選定，不顯示篩選器。

這從根本上解決多分校課堂覆蓋問題。

### D3. 週視圖顯示情境式標籤

- 本週：subtitle 顯示「本週 (2/24–3/2)」
- 非本週：顯示日期範圍「2/17–2/23」
- 今天（日視圖）：subtitle 顯示「今天 (3/4)」
- 非今天：顯示日期「3/5 (三)」

### D4. Schedule 移除 teacher_id

Schedule 只負責定義「每週幾、幾點到幾點」，不涉及老師指派。

- ClassFormDialog 的時段設定移除老師選擇欄
- `generateSessions()` 永遠產生 `assignment_status = 'unassigned'` 的 session
- 產生完成後引導使用者到行事曆清單視圖指派老師
- DB migration：`ALTER TABLE schedules DROP COLUMN teacher_id`（或 deprecate，保留但前端不使用）

### D5. 廢棄 Wizard，改用單頁表單

批次指派老師改為 dialog 內的單頁表單 + 進階設定摺疊區。所有批次操作（指派老師、改時間、停課、取消停課）統一採用相同 UX 模式：

1. 選取 sessions（勾選或全選）
2. 點擊批次操作按鈕
3. 在 inline panel 或 compact dialog 中設定參數
4. 自動預覽（dryRun）
5. 確認套用

### D6. 批次操作固定略過衝突

延續 `2026-02-27-session-list-batch-ops-design.md` 的決策：系統固定用 `skip-conflicts` 模式，不提供 strict/force 選項。移除 Wizard 中的 conflictMode 設定。

## 頁面架構

### 行事曆頁面（統一 Session 管理）

```
┌─────────────────────────────────────────────────┐
│ 課堂行事曆                                        │
│ 本週 (3/2–3/8)  ◀ [回本週] ▶                      │
├─────────────────────────────────────────────────┤
│ 分校：[▾ 信義分校]  課程：[▾ 所有]  老師：[▾ 所有] │
│ 班級：[▾ 所有]                                    │
│                        [📅 行事曆] [📋 清單]       │
├─────────────────────────────────────────────────┤
│                                                   │
│  （行事曆視圖 或 清單視圖，依選擇切換）              │
│                                                   │
└─────────────────────────────────────────────────┘
```

### 行事曆視圖（現有，微調）

保留現有的週視圖/日視圖、重疊演算法、溢出徽章。

改動：
- 點擊 session → 開啟 Detail Dialog（現有）→ 所有單堂操作
- 新增「班級」篩選器維度
- 分校必選（D2）
- 情境式標籤（D3）

### 清單視圖（新增，取代 Session List Dialog）

使用 `app-responsive-table` 實作，支援：
- checkbox 勾選（批次操作用）
- 排序（日期、時間、班級、老師、狀態）
- 分頁
- 響應式欄位折疊

#### 欄位定義

| 欄位 key | label | minWidth | priority | collapsible | 說明 |
|----------|-------|----------|----------|-------------|------|
| checkbox | - | 48 | 0 | false | 全選/單選 checkbox |
| date | 日期 | 100 | 1 | false | sessionDate，格式 MM/DD (週X) |
| time | 時間 | 120 | 2 | false | startTime–endTime |
| class | 班級 | 140 | 3 | true | className |
| teacher | 老師 | 120 | 4 | true | teacherName 或「未指派」tag |
| status | 狀態 | 80 | 5 | true | scheduled/cancelled/changed badge |
| actions | 操作 | 48 | 6 | false | `...` ellipsis menu |

#### 單堂操作（actions ellipsis menu）

- 調課（reschedule）
- 代課（substitute）— 僅 assigned 且 scheduled 時顯示
- 停課（cancel）— 僅 scheduled 時顯示
- 取消停課（uncancel）— 僅 cancelled 時顯示
- 指派老師（assign）— 僅 unassigned 時顯示

#### 批次操作（底部浮動 bar，選取 > 0 時出現）

```
┌─────────────────────────────────────────────┐
│ 已選 12 堂                                    │
│ [指派老師] [改時間] [停課] [取消停課] [取消選取] │
└─────────────────────────────────────────────┘
```

每個批次操作使用 inline panel（非 dialog），展開在 batch bar 上方：

**批次指派老師 panel：**

```
┌──────────────────────────────────────┐
│ 指派老師給 12 堂課                     │
│                                        │
│ 老師：[▾ 張老師          ]             │
│                                        │
│ ▸ 進階設定                             │
│   ☐ 包含已有老師的課堂（覆蓋原有指派）   │
│                                        │
│ 預覽：10 堂可指派 · 2 堂衝突            │
│ [查看衝突明細]                          │
│                                        │
│          [取消]  [確認指派 10 堂]        │
└──────────────────────────────────────┘
```

**批次改時間 panel：**

```
┌──────────────────────────────────────┐
│ 修改 12 堂課的上課時間                  │
│                                        │
│ 新開始時間：[09:00]  結束：[10:30]      │
│                                        │
│ 預覽：11 堂可更新 · 1 堂衝突            │
│                                        │
│          [取消]  [確認修改 11 堂]        │
└──────────────────────────────────────┘
```

**批次停課 / 取消停課 panel：**

```
┌──────────────────────────────────────┐
│ 停課 12 堂                             │
│                                        │
│ 原因（選填）：[________________]        │
│                                        │
│ 預覽：11 堂可停課 · 1 堂無法停課        │
│                                        │
│          [取消]  [確認停課 11 堂]        │
└──────────────────────────────────────┘
```

## 資料流

### 清單視圖載入

```
1. 使用者選擇篩選條件（分校必選 + 其他可選）
2. 前端呼叫 GET /api/sessions?campusId=X&courseId=Y&classId=Z&teacherId=W&from=...&to=...
3. 回傳 Session[]，前端做分頁呈現
```

注意：清單視圖和行事曆視圖共用同一個 `sessions` signal，切換視圖不重新載入。

### 批次操作流程

```
1. 使用者勾選 sessions
2. 點擊批次操作按鈕 → 展開 inline panel
3. 填入參數 → 自動 dryRun（500ms debounce）
4. 顯示預覽摘要（可套用數 / 衝突數）
5. 使用者確認 → 送 apply 請求（帶 processableIds）
6. 成功 → 收合 panel、清除選取、重新載入 sessions、顯示 toast
```

### 行事曆 → 清單的互通

- 行事曆視圖的溢出徽章（+N 堂）點擊後切換到清單視圖，並自動篩選該時段
- 清單視圖的 session 點擊後可切換到行事曆視圖，定位到該日期

## 產生課堂後的引導流程

```
Classes 頁面 → 產生課堂 Dialog
  │
  ├─ Step 1: 選日期範圍 + 排除日期
  ├─ Step 2: 預覽（table 顯示新增/已存在）
  └─ 確認建立
       │
       ▼
  結果摘要：「已建立 24 堂課（24 堂待指派老師）」
       │
       ├─ [稍後指派] → 關閉 dialog
       └─ [前往指派老師] → 關閉 dialog → 導航到行事曆清單視圖
            自動篩選：該班級 + 該日期範圍 + 只顯示未指派
```

## 額外修正項目

### F1. Session List「星期」欄位改為中文

使用 date-fns 的 `format(date, 'EEEE', { locale: zhTW })` 或自訂 mapping：

```ts
const DAY_LABELS: Record<number, string> = {
  0: '週日', 1: '週一', 2: '週二', 3: '週三',
  4: '週四', 5: '週五', 6: '週六',
};
```

### F2. session-operation-guard 補齊 status 檢查

```ts
export function assertSessionOperable(session: SessionOperationState): void {
  if (session.assignmentStatus === 'unassigned') {
    throw new SessionUnassignedError();
  }
  if (session.status === 'cancelled') {
    throw new SessionCancelledError();
  }
  if (session.status === 'completed') {
    throw new SessionCompletedError();
  }
}
```

各操作路由根據需要決定是否呼叫完整 guard 或部分檢查。

### F3. 日期選擇器加上 click-outside-to-close

使用 `@HostListener('document:click')` 或 CDK overlay 的 backdrop，點擊 datepicker popup 外部時關閉。

### F4. 代課路由同步更新 assignment_status

雖然目前不違反約束，但為了一致性，代課路由應明確設定 `assignment_status: 'assigned'`。

### F5. 產生課堂加上上限提醒

當預覽結果超過 200 堂時，顯示警告確認：「即將建立 N 堂課，確定要繼續嗎？」

## 廢棄項目

| 項目 | 處理方式 |
|------|---------|
| `BatchAssignWizardComponent` | 刪除，功能由清單視圖的批次指派 panel 取代 |
| `SessionListDialogComponent` | 刪除，功能由清單視圖取代 |
| `SessionOverflowDialogComponent` | 保留在行事曆視圖，但溢出徽章也可切換到清單視圖 |
| `Schedule.teacher_id` | DB migration DROP 或 deprecate |
| Wizard 的 `conflictMode` 設定 | 移除，固定 skip-conflicts |
| Quick Preview 的獨立 dryRun | 移除，統一用批次操作的 dryRun |

## 非目標（本階段不做）

1. 不做跨班批次操作（例如「所有班的週三課堂全部停課」）— 太危險，留待未來。
2. 不做行事曆的拖拽調課 — 工程量大，收益不明。
3. 不做 session 的「已完成」自動流轉 — 屬於 teacher shell 點名功能的範疇。
4. 不做前後端型別共享（shared-types package）— 可以獨立進行。

## 測試策略

### Frontend

1. 清單視圖的 responsive-table 欄位折疊正確。
2. 批次操作 inline panel 的展開/收合/預覽流程。
3. 行事曆 ↔ 清單視圖切換保持篩選器狀態。
4. 分校必選邏輯（無法清除、單分校自動選定）。
5. 手機版：日視圖 + 清單視圖為主，批次 bar 不擋住內容。

### Backend

1. 延用現有 batch ops API 的測試。
2. `generateSessions()` 在移除 schedule.teacher_id 後全部產生 unassigned session。
3. guard 補齊 status 檢查後的邊界測試。
