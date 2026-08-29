# Clessia

補習班管理系統：管理端優先，支援多分校（一個組織、多個校區）。

Angular 21 + PrimeNG（`apps/web`）、Hono + Better Auth（`apps/api`）、Supabase（DB），
用 Nx 串起來。

## 常用指令

```bash
npm ci                # 根目錄依賴
npm ci --prefix apps/api   # apps/api 是獨立的 npm package，要分開裝
npm run dev           # web + api 一起起
npm run build         # nx run-many -t build
npm test              # nx run-many -t test
npm run harness       # 文件與現實同步的 gate
```

**建置設定的真相來源是 `apps/web/project.json` 與 `apps/api/project.json`。**
本 repo 沒有 `angular.json` —— 不要用 `ng` 開頭的指令，Angular CLI 讀不到 Nx 的設定，
會往上找到別的 workspace 然後把檔案寫錯地方。產生元件請用
`npx nx g @schematics/angular:component <name> --type component`。

## 更完整的指引

- **[`AGENTS.md`](AGENTS.md)** —— 專案指引的單一真相（技術棧、慣例、目錄結構、Definition of Done）
- **[`kb/wiki/architecture/constitution.md`](kb/wiki/architecture/constitution.md)** —— 具約束力的架構法條
- **[`kb/wiki/index.md`](kb/wiki/index.md)** —— 知識庫索引（規格、流程、業務規則、教訓）
