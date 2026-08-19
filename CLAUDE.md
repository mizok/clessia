# Clessia — Claude Code entry point

> 專案指引的單一真相是 **`AGENTS.md`**（下方 import），所以 Claude Code 與 Codex / Gemini 等
> CLI 讀到的是同一份。
>
> **維護規則：新的專案規則一律加到 `AGENTS.md`，永遠不要加到這個檔** —— 這裡只做 import。
> 具約束力的架構不變量走 `kb/wiki/architecture/constitution.md` 的修訂流程。
> 本檔行數由 `npm run harness` 把關（clause c11）。

@AGENTS.md

## Claude 專屬

- **Hooks 與權限**：`.claude/settings.json` 是機器讀的設定，`.claude/settings.md` 是人類讀的說明
  （每支 hook 在幹嘛、為什麼是 hook 而不是 skill、擋不擋得住什麼）。動 hook 前先讀後者。
- **Subagents**：`.claude/agents/` 底下是唯讀的領域導航員（enrollment / attendance / grades）。
  它們只回報 `path:line` 證據，不改檔；改動由主 session 執行。
- **Skills**：`.claude/skills/` 多數是指向 `.agents/skills/` 的 symlink（跨 CLI 共用）。
  另有 `debug-issue.md` 等 Claude 專屬的單檔 skill。
- **委派 Codex**：使用者說「codex」指的是 OpenAI codex-cli（`.mcp.json` 的 `codex` server），
  不是 Claude Code 的 `/codex:*` plugin。除非明確要求等待，一律用背景模式。
