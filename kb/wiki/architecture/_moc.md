# Architecture — Map of Content

> Auto-maintained by `kb:map`. Last updated: 2026-08-19

---

## [[architecture/announcements|站內公告的設計]]

管理員發布、老師收件匣、已讀狀態。取代 LINE 群組通知的第一步，不接外部服務。

Tags: `architecture`, `announcements`

Links to: [[architecture/role-authorization|角色授權設計]]

## [[architecture/change-log-view|課務異動紀錄的設計]]

M1 第二個畫面。填掉 admin/changes 空殼，把一直在寫卻沒人看得到的 schedule_changes 呈現出來。唯讀。

Tags: `architecture`, `change-log-view`

## [[architecture/constitution|Clessia 架構憲法]]

具約束力的架構不變量。只陳述「什麼構成違反」，不含強制機制。

Tags: `architecture`, `constitution`

Links to: [[architecture/constitution-enforcement|`constitution-enforcement`]]

## [[architecture/constitution-enforcement|憲法強制機制索引]]

每條 clause 用什麼機制守、在哪一層擋、目前接上了沒有。改機制不算修法。

Tags: `architecture`, `constitution-enforcement`

Links to: [[architecture/constitution|`constitution`]]

## [[architecture/enrollment-admin-view|報名管理端的設計]]

M2。兩個互不依賴的切片：班級頁的 Excel 名單匯入精靈、獨立的報名進出總覽頁。既有的班級／學生兩個報名入口不動。

Tags: `architecture`, `enrollment-admin-view`

## [[architecture/no-division-scoping|刻意不設計「學部」這一層]]

補習班有國小部／國中部（未來高中部），但系統不建立「部」的概念，也不依部隔離可見範圍。原因是實際的人力本來就跨部。

Tags: `architecture`, `no-division-scoping`

## [[architecture/role-authorization|角色授權的設計]]

18 支 route 只驗身分不看角色。改成掛載時強制宣告可用角色、沒宣告就拒絕，並用 harness gate 守住。分兩層：route 層准入、資料層範圍。

Tags: `architecture`, `role-authorization`

## [[architecture/teacher-students-view|老師端學生名單的設計]]

老師看自己任課班級的學生。同時處理 teacher/attendance 空殼——點名的家是課表，不是另一個選單項目。

Tags: `architecture`, `teacher-students-view`

Links to: [[architecture/role-authorization|`角色授權的設計`]]

## [[architecture/teaching-history-not-payroll|記錄授課歷程，但不做薪資計算]]

老師多為鐘點計酬，但系統刻意不計算薪資。職責是把「誰在什麼時候上了哪一堂」記到可信，計算方式留給人。

Tags: `architecture`, `teaching-history-not-payroll`

## [[architecture/teaching-log-view|老師授課紀錄的設計]]

M1 第一個畫面。選老師 + 期間，列出課堂並加總時數。不計算薪資，設計原則是可追溯——代課、停課、缺點名證據都看得見。

Tags: `architecture`, `teaching-log-view`

Links to: [[architecture/teaching-history-not-payroll|`記錄授課歷程但不做薪資`]]

