# Wiki — Log (mizok)

> Append-only. Newest entries at top. One log file per developer.

---

## [2026-08-24] lint | Health check: 0 errors, 4 warnings, 55 info
- Mode: structural
- Pages scanned: 85
- Issues found: 59

## [2026-08-24] map | Rebuilt index + 5 MOCs
- Pages indexed: 76
- Total links: 38
- Orphan pages: 70

## [2026-08-23] lint | Health check: 0 errors, 0 warnings, 54 info
- Mode: structural
- Pages scanned: 84
- Issues found: 54

## [2026-08-23] map | Rebuilt index + 5 MOCs
- Pages indexed: 75
- Total links: 35
- Orphan pages: 69

## [2026-08-23] lint | Health check: 0 errors, 0 warnings, 56 info
- Mode: structural
- Pages scanned: 82
- Issues found: 56

## [2026-08-23] map | Rebuilt index + 5 MOCs
- Pages indexed: 74
- Total links: 31
- Orphan pages: 71

## [2026-08-19] lint | Health check: 0 errors, 0 warnings, 54 info
- Mode: structural
- Pages scanned: 82
- Issues found: 54

## [2026-08-19] map | Rebuilt index + 5 MOCs
- Pages indexed: 74
- Total links: 33
- Orphan pages: 69

## [2026-08-19] verify | Drift 稽核：73 頁分類、29 頁修正

- 範圍：可用程式碼驗證的頁面（specs 的路徑與資料依賴、architecture 的 file 引用）
- 跳過：lessons 的歷史引用（保存當時的觀察，非現況主張）、未建功能的前瞻規格
- 修正：24 頁假表名（attendances→attendance_records、grades→academy_scores/school_scores、
  assessments→academy_exams/school_exams、teachers→staff、check_ins→daily_checkins、
  leaves→leave_requests、notifications→announcements、system_settings→organizations、tasks 移除）
- 修正：4 頁路徑（/admin/classes、/admin/calendar、/teacher/attendance、/admin/enrollment）
- 修正：2 頁行號引用改成符號引用；1 頁「活的 bug」標記為已修
- 🅿️ 不算漂移：invoices/fee_templates/teacher_logs 等 11 個未建功能的表名、4 條未建功能的路由
- 複驗：獨立重跑，假表名歸零；過程中抓到檢查器自身兩個誤判（正則沒含大寫、同名檔案挑錯）

## [2026-08-19] lint | Health check: 0 errors, 0 warnings, 57 info
- Mode: structural
- Pages scanned: 81
- Issues found: 57

## [2026-08-19] lint | Health check: 0 errors, 0 warnings, 57 info
- Mode: structural
- Pages scanned: 81
- Issues found: 57

## [2026-08-19] map | Rebuilt index + 5 MOCs
- Pages indexed: 73
- Total links: 29
- Orphan pages: 72

## [2026-08-19] map | Rebuilt index + 5 MOCs
- Pages indexed: 71
- Total links: 28
- Orphan pages: 70

## [2026-08-19] lint | Health check: 0 errors, 0 warnings, 55 info
- Mode: structural
- Pages scanned: 79
- Issues found: 55

## [2026-08-19] lint | Health check: 0 errors, 71 warnings, 55 info
- Mode: structural
- Pages scanned: 78
- Issues found: 126

## [2026-08-19] map | Rebuilt index + 5 MOCs
- Pages indexed: 71
- Total links: 28
- Orphan pages: 70

## [2026-08-19] map | Rebuilt index + 5 MOCs
- Pages indexed: 71
- Total links: 0
- Orphan pages: 70

## [2026-08-19] migrate | 移植 fvg 的 kb-wiki 配置

- 起因：專案原本用自製的 `kb-gate.mjs` + 自訂 schema，不是當初要求移植的 fvg 配置
- 結構：`kb/{raw,wiki,schema.md}`；內容全部收進 `kb/wiki/<分類>/`
- 分類：architecture（含憲法）、specs(46)、flows(4)、rules(2)、lessons(8)
- 退掉：`tools/agent-harness/kb-gate.mjs`、`npm run kb` / `kb:write`（fvg 的 harness 沒有這支）
- 註冊：`AGENTS.md` 的 `## Knowledge Base`（跟 fvg 一致，不寫進 CLAUDE.md 以免違反 c10）
- 路徑更新：AGENTS.md、CLAUDE.md、harness 三支、hooks 兩支、rules 兩份、.claude/agents 三支、settings
