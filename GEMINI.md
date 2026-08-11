# Clessia — Gemini entry point

> 專案指引的單一真相是 **`AGENTS.md`**（下方 import）。
>
> **維護規則：新的專案規則一律加到 `AGENTS.md`，永遠不要加到這個檔。**
> 本檔行數由 `npm run harness` 把關（clause c11）。
>
> 若你的 CLI 不會自動展開 `@import`，請直接讀取專案根目錄的 `AGENTS.md`。

@AGENTS.md

## Gemini 專屬

- Skills 在 `.gemini/skills/`，多數是指向 `.agents/skills/` 的相對 symlink（跨 CLI 共用同一份）。
- 具約束力的架構法條在 `kb/architecture/constitution.md`，動架構前先讀。
