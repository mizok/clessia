# 報名申請流程

本文件整理 PRD 6.3（並對齊 4.17 的來源/狀態定義），描述報名申請到繳費完成的完整作業流，涵蓋公開報名、家長端報名、加選、續課加選與管理員快速流程。

## 1. 流程範圍與角色

- 主要角色：家長（新家長/既有家長）、系統、管理員。
- 關聯功能：`/apply`、`/parent/enrollment`、`/parent/add-course`、`/admin/enrollment-requests`、`/admin/payments`、`/admin/enrollment`。

## 2. 申請來源（Enrollment Request Source）

| 來源 | 入口 | 誰發起 | 說明 |
| --- | --- | --- | --- |
| `public_form` | `/apply` | 新家長（無帳號） | 公開報名表單 |
| `parent_portal` | `/parent/enrollment` | 既有家長 | 家長後台報名 |
| `add_course` | `/parent/add-course` | 既有家長 | 家長加選課程 |
| `renewal` | 續課異動流程 | 既有家長 | 續課時加選/調整 |

## 3. 申請狀態流轉

主流程狀態：

`pending` → `awaiting_payment` → `completed`

分支終態：

- `rejected`：管理員拒絕（必填拒絕原因）。
- `canceled`：僅 `pending` 可取消（家長自行取消或管理員代取消）。
- `expired`：超過繳費期限未付款，系統自動標記。

## 4. 標準流程（申請到完成）

### 步驟 1：家長提交申請（觸發）

- 觸發條件：家長在來源入口送出報名申請。
- 系統動作：
  - 建立 Enrollment Request。
  - 狀態設為 `pending`。
  - 建立「報名審核」任務（`enrollment_review`）。

### 步驟 2：管理員審核

- 管理員認領任務並檢視申請內容（家長、學生、開課班、開始日期、備註）。
- 分支 A：審核通過。
  - 狀態轉 `awaiting_payment`。
  - 建立繳費單（可調整金額，如折扣/優惠）。
  - 同步建立 `pending_payment` Enrollment（學生在寬限期內可出現在點名單）。
- 分支 B：拒絕。
  - 狀態轉 `rejected`，記錄原因並通知家長。

### 步驟 3：通知與付款

- 管理員通知家長繳費資訊（電話或 email）。
- 家長以線下方式付款（現金/轉帳）並回報。

### 步驟 4：確認收款與自動後處理

- 觸發條件：管理員在繳費管理確認收款。
- 系統動作：
  1. 更新繳費單狀態（部分繳費或已繳清）。
  2. 更新 Enrollment Request（已繳清時轉 `completed`）。
  3. Enrollment 由 `pending_payment` 轉 `active`（依收款策略可部分啟用）。
  4. 發送帳號通知（如有 Email）。

## 5. 特別規則：`public_form` 來源

- `public_form` 的申請在繳費完成前，僅有申請資料，不視為已建立正式家長/學生主資料。
- **繳費完成後**才進行：
  1. 建立家長帳號（有 Email 用 Email，無 Email 用手機）。
  2. 建立學生資料。
  3. 建立家長與學生關聯。
  4. 啟用 Enrollment。
- 其他來源（`parent_portal` / `add_course` / `renewal`）因家長與學生已存在，收款後直接建立或啟用對應 Enrollment。

## 6. 逾期、失效與重啟

- 繳費期限到期未繳：申請可標記 `expired`。
- 若超過期限與寬限期：相關 Enrollment 可轉 `void` 並自點名名單移除。
- 管理員可人工重啟（延長期限或補收款後恢復）。

## 7. 管理員直接報名（快速流程）

適用情境：現場報名、老學生加報、特殊處理。

1. 管理員建立家長（若新家長）。
2. 管理員建立學生（若新生）。
3. 建立家長-學生關聯。
4. 直接建立 Enrollment：
   - 選開課班、繳費週期、生效起訖。
   - 可選擇是否同時建立繳費單。
5. 完成後學生立即進入課堂名單。

補充：

- 直接報名可跳過申請審核節點。
- 若不建繳費單，屬人工例外流程（如現場已收款或特殊免費）。
