# Rules — Map of Content

> Auto-maintained by `kb:map`. Last updated: 2026-09-05

---

## [[rules/attendance-rules|出勤與請假規則]]

本文件整理 PRD 8.3-8.4，定義出勤模式、系統推算邏輯、人工修改權限與請假處理規則，作為到班/點名模組的核心行為準則。

Tags: `rules`, `attendance-rules`

## [[rules/billing-rules|計費與收款規則]]

內部人訪談定案的金流業務規則：三種計費模式（月繳/期繳/堂數制）、金額永遠可人工覆寫（不做折扣引擎）、插班退班共用比例試算、帳單與收款一對多、欠繳只做可見性不做強制。

Tags: `rules`, `billing`, `payments`, `invoices`

Links to: [[summaries/interview-insider-2026-08-29]], [[rules/meal-rules]], [[rules/enrollment-rules]]

## [[rules/contact-book-rules|聯絡簿規則]]

內部人訪談定案：每生每日唯一一則自由文字（不分科目）、班級層級開關（低年級用、國中以上不用）、帶班老師撰寫可共編、家長按鈕簽收（記人與時間）且老師看得到已讀狀態。

Tags: `rules`, `contact-book`, `parent`

Links to: [[summaries/interview-insider-2026-08-29]], [[roadmap]], [[rules/teaching-log-rules]], [[rules/teaching-log-rules]]

## [[rules/enrollment-rules|報名與繳費規則]]

報名審核、繳費關聯與直接報名規範。2026-08-29 依訪談定案的 billing-rules 對齊：繳費狀態由收款推導（三態）、單一 due_date 無寬限期機制、金額調整是議價不是折扣類型。

Tags: `rules`, `enrollment-rules`

Links to: [[rules/billing-rules]], [[rules/billing-rules]]

## [[rules/meal-rules|餐費規則]]

內部人訪談定案：訂餐與出席解耦（有上課不一定訂餐）、每生每日一筆餐記錄（單價在筆上、收不收費是人工開關）、月底加總開帳單；請假只提示不自動改餐記錄。

Tags: `rules`, `meals`, `billing`

Links to: [[summaries/interview-insider-2026-08-29]], [[rules/billing-rules]], [[rules/billing-rules]], [[rules/attendance-rules]]

## [[rules/teaching-log-rules|教務日誌與作業廣播規則]]

訪談最大發現：各科老師的教務日誌（教學紀錄+作業安排）現靠紙本拍照進 LINE 相簿、行政再轉貼到年級群組，粒度錯誤導致沒修課的學生也收到作業；系統應以班級名冊為粒度，日誌發布即自動送達該班家長端＋推播。

Tags: `rules`, `teaching-log`, `homework`, `notifications`

Links to: [[summaries/interview-insider-2026-08-29]], [[rules/contact-book-rules]], [[rules/contact-book-rules]]

