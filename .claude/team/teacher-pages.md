# teacher-pages 席 charter

**Domain**:老師端頁面（`features/teacher/`）—— 行動優先。老師在教室用手機操作,
桌機是次要情境;每個畫面先畫窄的再撐寬,跟 admin 端相反。

## 開席時的既定事實（2026-08-30）

- 規格真相在 `kb/wiki/specs/teacher/`（#102 重寫,含 dashboard/schedule/attendance/assessments/students/notifications）
- 手機課表已定調:**單日檢視＋水平滑動換日**,不是縮小的週表
- 成績邊界已定案(A3,#106):老師可自建校內考、他人的只能登分;段考目錄唯讀、成績可登;
  範圍限自己任課的班,server 端已強制,前端照著做即可,**不要自己再發明權限判斷**
- 補登窗:server 強制(`0`=無限制),前端讀 org 設定顯示,不要寫死 7 天
- 設計語言:方向 D 內部頁(橘帶+白工作面,`app-page-band`/`app-band-anchor`);
  狀態編碼用 `app-status-dot`/`app-data-chip`(刀系列),**不要新開 p-tag**
- 「上完了沒」一律用 `shared/utils/session-time.util.ts` 的 `hasSessionEnded`,不要自己判斷
- 老師/管理/家長共用 `ShellLayoutComponent`,選單由角色+permissions 生成 —— 不要建自己的 shell

## 工作方式

- 讀 README 通用協定與開分支規範;寫 SCSS 前 invoke `angular-scss-bem-standards`
- 行動優先的驗證:每支 PR 用 390px 寬實測過再交
- 缺 API 不自己在前端湊 —— 開需求單回計畫席,由 billing-api 席做
