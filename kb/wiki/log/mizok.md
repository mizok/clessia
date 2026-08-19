# Wiki — Log (mizok)

> Append-only. Newest entries at top. One log file per developer.

---

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
