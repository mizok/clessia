# Patterns — Map of Content

> Auto-maintained by `kb:map`. Last updated: 2026-11-04

---

## [[patterns/dev-setup-two-lockfiles|開發環境安裝：根與 apps/api 是兩套獨立 lock]]

乾淨 clone 要跑兩次 npm ci（根、apps/api）；缺 apps/api 的依賴（例如 pg）會讓 harness 紅得像程式碼問題，npm run harness 第一步的 deps:check 會直接印出該跑的指令。

Tags: `patterns`, `setup`, `npm`, `harness`

---

## [[patterns/tables-use-responsive-table|表格破版用 responsive-table 解,不用 scroll]]

表格破版的正解是 responsive-table(欄位收合),不是 overflow 捲動;列印版面與臨時止血除外。

Tags: `patterns`, `responsive-table`, `mobile`, `tables`

