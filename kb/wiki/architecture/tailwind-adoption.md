---
title: Tailwind 導入評估（c6、PrimeNG 並存、Angular 21 接法、BEM／SCSS 退場）
summary: 使用者 2026-10-02 裁定新 UI 改用 Tailwind、入口頁日後重排、不再延續 BEM＋SCSS。本頁回答導入前要先定的五件事：c6 的 regex 抓不到 h-screen 這類沒有數字的 class（三層補法）、PrimeNG 改用 cssLayer 會讓既有覆寫的勝負翻轉、tokens 有一個語意衝突（--font-medium 是字重不是字體）、Tailwind 4 不搭 Sass 所以入口要獨立成 .css、以及五支解析 SCSS 的 gate 會在 Tailwind 頁面上失明。
category: architecture
status: proposed
updated: 2026-10-02
tags: [architecture, tailwind, styling, primeng, c6, migration]
---

# Tailwind 導入評估

> **狀態：提案，等計畫席與使用者批准（STOP gate）。** 批准之前不動任何程式碼。
> 來源：#991。使用者 2026-10-02 在 #973 裁定：「新 UI 開放使用 **Tailwind**；入口頁面之後也要
> 改用 Tailwind 重新排過，**避免繼續使用 BEM + SCSS**」。
>
> 本頁每一個關於 Tailwind／PrimeNG／Angular 行為的敘述都附出處（官方文件或原始碼）。
> 沒有查到、只是推定的，一律標 **〔未驗證〕**。

## 結論先講

1. **c6 現有的 regex 抓不到 Tailwind 最常見的違規。** 它要求「數字緊接單位」（`[0-9](vh|vw|dvh|svh|lvh)`），
   所以 `h-[100vh]` 抓得到，**`h-screen`、`min-h-dvh`、`w-svw` 抓不到**，因為 class 名稱裡沒有數字。
   補法分三層：
   - **建置層**：用 `@source not inline(...)` 讓這些 class 根本不產生。
   - **gate**：pre-guard 加一條認 class 名稱的規則，A12 跟著吃到。
   - **替代**：提供讀 `--window-*` 的 `h-window` 這類 utility。
2. **PrimeNG 要從 `cssLayer: false` 改成放進 `primeng` layer**，這是官方的並存方式。
   **連帶效果是 cascade 勝負翻轉**：未分層的樣式一律贏過分層的，所以現有 SCSS 對 PrimeNG 的每一條覆寫都會自動勝出。
   以前靠 specificity 輸掉、所以「沒效」的規則，可能突然生效。這一步要在 47 頁 sitemap 上做視覺回歸。
3. **Tailwind 4 官方明說「不是設計來跟 Sass 一起用的」。** 入口要另開一支純 `.css`（`apps/web/src/tailwind.css`），不能塞進 `styles.scss`。
4. **tokens 有一處真正的語意衝突**：本專案的 `--font-normal`／`--font-medium` 是**字重**，
   在 Tailwind 的 `--font-*` 命名空間裡卻是**字體家族**。做法是清掉 Tailwind 預設 theme（`--*: initial`），再逐一映射。
5. **五支解析 SCSS 的 harness gate 在 Tailwind 頁面上會失明**：對比、觸控目標、mobile-first、孤兒 class 等。
   這是遷移最大的隱性成本，每一支都要有對應的「看 class 字串」版本，或者明確接受覆蓋率下降。
6. **斷點不用映射**：專案的 640／768／1024／1280 正好是 Tailwind 的 `sm`／`md`／`lg`／`xl` 預設值。

---

## 1. 與 c6（禁 viewport 單位）的互動

### 1.1 現況：規則守的是「數字＋單位」

`tools/agent-harness/rules/pre-guard.rules.json` 的 c6 有三條，分別給 `.scss`、`apps/web/src/**/*.ts`、`apps/web/src/**/*.html`。三條是同一個 regex：

```
(?<!var\([^()]*)[0-9](vh|vw|dvh|svh|lvh)\b
```

gate A12（`check-harness.mjs` 的 `scanExisting({ clause: 'c6', … })`）**餵同一份規則**掃三種副檔名的存量。

| 寫法                                                               | 現有規則抓不抓得到                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `class="h-[100vh]"`（任意值）                                      | ✅ 有 `100vh`                                                                                       |
| `class="h-[calc(var(--window-height,100dvh)*0.9)]"`                | ✅ 放行（`var(` 的 fallback，符合 `constitution-enforcement.md`「c6：var() 的 fallback 不算違規」） |
| `class="h-screen"`、`min-h-dvh`、`max-h-svh`、`w-screen`、`size-…` | ❌ **抓不到**：名稱裡沒有數字                                                                       |
| `@apply h-screen;`（寫在 CSS 裡）                                  | ❌ 同上                                                                                             |
| `md:h-screen`（加 variant）                                        | ❌ 同上                                                                                             |

**會產生 viewport 單位的 utility**，以 height 為例，官方列出 `h-screen`、`h-dvh`、`h-dvw`、`h-lvh`、`h-lvw`、`h-svh`、`h-svw`
（<https://tailwindcss.com/docs/height>）。`min-h-`、`max-h-`、`w-`、`min-w-`、`max-w-`、`size-` 是同一族。
〔未驗證：每一族的完整清單，實作時以 Tailwind 原始碼的 utility 定義核對，不要照本頁的列舉抄。〕

### 1.2 補法：三層，缺一層就有洞

**① 建置層：不產生。** `@source not inline()` 會阻止指定的 class（**含它們的 variant**）被產生，**即使原始碼裡寫了**
（<https://tailwindcss.com/docs/detecting-classes-in-source-files>，「Explicitly excluding classes」）。

```css
/* apps/web/src/tailwind.css —— c6：這些 utility 直接產生 viewport 單位 */
@source not inline("{min-,max-,}{h,w}-{screen,dvh,dvw,svh,svw,lvh,lvw}");
@source not inline("size-{screen,dvh,dvw,svh,svw,lvh,lvw}");
```

**它單獨不夠**：寫了 `h-screen` 只會**靜靜地沒有樣式**，作者看到的是「高度沒撐開」，而不是違規訊息。所以還要第 ② 層。

**② gate：認 class 名稱。** 在 `pre-guard.rules.json` 加 c6 規則，路徑涵蓋 `.html`、`apps/web/src/**/*.ts`（inline template、`[ngClass]`）、`.css`、`.scss`（`@apply`）：

```
(?<![\w-])(?:[\w-]+:)*(?:min-|max-)?(?:h|w|size)-(?:screen|[dsl]v[hw])(?![\w-])
```

- A12 **自動跟著吃到**：它從同一份 `pre-guard.rules.json` 取規則，不必改 gate 的程式碼。這正是 enforcement 頁說的「兩層共用同一條規則，不會漂」。
- 字串拼接出來的 class（`'h-' + x`）regex 看不到，但 **Tailwind 自己也看不到**（官方：class 名稱必須完整、靜態出現，<https://tailwindcss.com/docs/detecting-classes-in-source-files>），所以那種寫法本來就不會有樣式。不另外處理。
- 〔未驗證：regex 要放進 harness 的 matcher 用既有測試框架驗，**先塞一個 `md:h-screen` 陷阱看它紅**，再寫綠的。〕

**③ 替代：給一條合規的路。** 只有禁令沒有替代品的規則擋不住正當需求（`herdr-team/README.md`「開分支規範」那節的教訓）。

```css
/* var() 的 fallback 用 viewport 單位是 c6 的明文例外（constitution-enforcement.md 邊界記錄） */
@utility h-window {
  height: var(--window-height, 100dvh);
}
@utility min-h-window {
  min-height: var(--window-height, 100dvh);
}
@utility max-h-window {
  max-height: var(--window-height, 100dvh);
}
@utility w-window {
  width: var(--window-width, 100dvw);
}
```

`@utility` 的語法見 <https://tailwindcss.com/docs/adding-custom-styles>。自訂 utility 支援 hover、responsive 等 variant。
要「九成高」這種比例的話，可以之後再加 functional utility（`--value()`）；現在不做。

> **為什麼不直接覆寫 `h-screen` 讓它讀變數？** 那會讓名稱說謊：讀的人看到 `h-screen` 會以為是 `100vh`，而 c6 存在的理由正是兩者不同。
> 另外，「`@utility` 能否覆寫同名的內建 utility」我沒有查到官方說法〔未驗證〕。

---

## 2. 與 PrimeNG 21 ＋ `@primeuix/themes` Aura 並存

### 2.1 官方做法：PrimeNG 放進 `primeng` layer

PrimeNG 的 Tailwind 頁面（<https://primeng.dev/tailwind>，頁面顯示版本 22.1.2；v20 文件 <https://v20.primeng.org/tailwind> 內容一致）：

- `providePrimeNG({ theme: { preset, options: { cssLayer: { name: 'primeng', order: 'theme, base, primeng' } } } })`
- 原文：「primeng layer is **after theme and base, but before** the other Tailwind layers such as utilities」，
  這樣 Tailwind utility 才能**不靠 `!important`** 覆寫元件樣式。
- 搭配 `tailwindcss-primeui` 外掛（`@import "tailwindcss-primeui";`），把 PrimeNG 的語意色（`primary`、`surface`）映成 `bg-primary` 之類的 utility。

〔未驗證：PrimeNG **21** 的同一頁。v20 與現行 v22 一致，推定 v21 相同。實作前在 21.1.x 上實測一次。〕

### 2.2 ⚠️ 現況是 `cssLayer: false`，改了之後勝負會翻轉

`apps/web/src/app/app.config.ts:159-166`：`cssLayer: false`。也就是說，PrimeNG 的樣式目前**未分層**，跟我們的 SCSS 用 specificity 與先後順序決勝。

CSS cascade 的規則是**未分層的樣式一律贏過任何 layer 裡的樣式**。所以 PrimeNG 一旦進了 `primeng` layer：

- `styles.scss` 與各元件 SCSS（全部未分層）對 PrimeNG 的覆寫，**全部自動勝出**；
- **以前因為 specificity 不夠、實際上沒生效的規則，會突然生效**。那些規則從來沒在畫面上被看過；
- Tailwind utility 在 `utilities` layer 裡，**會輸給任何未分層的 SCSS**，不論 specificity 多高。

**含意**：

- 切換 `cssLayer` 要**單獨一支 PR**，在 47 頁 sitemap 上做視覺回歸（前後截圖比對）。不要跟「第一頁 Tailwind」綁在一起，否則出事時分不出是哪一個造成的。
- **過渡期規則：同一個元素不要同時用 BEM class 與 utility 控制同一個屬性。** SCSS 會贏，utility 看起來就像「沒效」。

### 2.3 preflight：過渡期**不開**

Tailwind 的 preflight 會重置 `h1`、`ul`、`img`、`button` 等基礎樣式，這會改變**所有既有頁面**。可以只匯入 theme 與 utilities
（<https://tailwindcss.com/docs/preflight>，「Disabling Preflight」）：

```css
@layer theme, base, primeng, utilities;
@import 'tailwindcss/theme.css' layer(theme);
/* preflight 刻意不匯入：過渡期它會改變所有既有頁面的基礎樣式 */
@import 'tailwindcss/utilities.css' layer(utilities);
```

入口頁全部重排完、BEM 頁面所剩不多時，再評估要不要打開。

### 2.4 tokens 映射：單一來源，清掉 Tailwind 預設

**來源維持 `apps/web/src/styles.scss` 的 `:root`**，SCSS 完全退場之後再搬進 `tailwind.css`。

Tailwind 端用 `@theme inline` 引用它。官方說引用其他變數時要用 `inline`，否則會因變數跨 DOM 層級解析而拿到非預期的 fallback
（<https://tailwindcss.com/docs/theme>，「Referencing other variables」）。

**為什麼要先 `--*: initial` 清掉整個預設 theme**（官方用法見 <https://tailwindcss.com/docs/theme>，「Disable default theme globally」）：

| 名稱                             | 本專案（`styles.scss`） | Tailwind 4 預設                                                 | 問題                                                                           |
| -------------------------------- | ----------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `--font-normal`、`--font-medium` | **字重**（400、500）    | `--font-*` 是**字體家族**命名空間；字重在 `--font-weight-*`     | ⚠️ **語意衝突**：放進 `@theme` 的話，`font-medium` 會被當成 `font-family: 500` |
| `--text-xs` … `--text-3xl`       | 字級，px                | 同名，也是字級，但 rem 而且值不同；另有 `--text-*--line-height` | 同語意不同值，映射時以本專案為準                                               |
| `--radius-sm` … `--radius-xl`    | 4／6／8／10px           | 0.25rem／0.375rem／0.5rem／0.75rem                              | 同上（`xl` 不同）                                                              |
| `--shadow-sm`、`--shadow-md`     | 本專案的值              | 同名不同值                                                      | 同上                                                                           |
| `--color-white`、`--color-black` | 同語意                  | 同名                                                            | 無衝突                                                                         |
| `--space-1` … `--space-12`       | 4px 的倍數              | Tailwind 4 用單一 `--spacing` 乘數                              | 設 `--spacing: 4px` 之後，`p-4` 正好等於 `--space-4`，兩邊名字對得上           |
| `--zinc-*`、`--accent-*` 等色票  | 本專案色票              | Tailwind 自帶一套 `zinc`                                        | 不清掉的話會出現兩套 zinc，`bg-zinc-500` 不是我們的 zinc                       |

Tailwind 預設**只輸出有被用到的** theme 變數（<https://tailwindcss.com/docs/theme>，「Generating all CSS variables」），
所以衝突只在「某個 utility 用到它」時才會出現。**那正是最難查的一種**：今天沒事，某一天有人寫了 `font-medium` 才壞。

```css
@theme inline {
  --*: initial;
  --spacing: 4px;
  --color-white: var(--color-white);
  --color-zinc-50: var(
    --zinc-50
  ); /* …逐一映射，不手抄完整清單（c11）：由 styles.scss 的 :root 產生 */
  --color-accent-400: var(--accent-400);
  --font-sans: var(--font-sans);
  --font-weight-normal: var(--font-normal);
  --font-weight-medium: var(--font-medium);
  --text-sm: var(--text-sm);
  --radius-md: var(--radius-md);
}
```

**映射表不手抄**（c11）。建議由 `styles.scss` 的 `:root` 產生，或加一道 gate：`@theme` 裡出現的每個名稱，都必須對應到 `styles.scss` 的一個變數，而且不得是 `--font-<weight>` 這種衝突名稱。

**深色模式**：PrimeNG 用 `darkModeSelector: '.dark-mode'`。Tailwind 的 `dark:` variant 要對齊同一個 selector〔未驗證：v4 的 `@custom-variant` 寫法，實作時查官方 dark-mode 頁〕。

**`tailwindcss-primeui` 要不要裝**：它會帶來第二套色名（`primary`／`surface`），跟本專案的 `accent`／`zinc` 指向同一批顏色。兩套名字並存，等於讓下一個人猜該用哪個。**建議先不裝**，只用本專案 tokens。→ **待裁決點 3**。

### 2.5 斷點：剛好不用映射

`apps/web/src/app/shared/_breakpoints.scss:9-12`：mobile 640、tablet-portrait 768、tablet-landscape 1024、desktop 1280。
正好是 Tailwind 的 `sm`／`md`／`lg`／`xl` 預設值〔在 root font-size 16px 的前提下；Tailwind 預設以 rem 表示〕。

- `respond-from` 的 `+0.02px` 是為了避免 `max-width` 與 `min-width` 區塊在邊界上重疊；Tailwind 的 `max-*:` variant 用的是範圍語法〔未驗證：邊界是否包含〕。
- 容器查詢（`respond-from-container`）對應 Tailwind 的 `@container` 與 `@sm:` 之類的 variant〔未驗證：v4 語法〕。

---

## 3. Angular 21 ＋ Nx 的接法

### 3.1 位置

| 項目          | 位置                                                                                                   | 出處                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 依賴          | `tailwindcss`、`@tailwindcss/postcss`、`postcss`（devDependencies）                                    | Angular 的 `ng add tailwindcss` schematic 安裝的就是這三個（`angular-cli/packages/schematics/angular/tailwind/index.ts`）                                                                                               |
| PostCSS 設定  | **`apps/web/.postcssrc.json`**，內容 `{ "plugins": { "@tailwindcss/postcss": {} } }`                   | 建置器依序在 `[projectRoot, workspaceRoot]` 找 `postcss.config.json`／`.postcssrc.json`（`angular-cli/packages/angular/build/src/builders/application/options.ts:281-282`）。放 project root 優先，不影響 repo 其他東西 |
| Tailwind 入口 | **新檔 `apps/web/src/tailwind.css`**（純 CSS），加進 `apps/web/project.json` 的 `build.options.styles` | 官方：v4「不是設計來跟 Sass、Less、Stylus 一起用的」（<https://tailwindcss.com/docs/compatibility>）。所以不放進 `styles.scss`                                                                                          |
| `ng add`      | **用不了**：本 repo 沒有 `angular.json`（`AGENTS.md`）。照上面三列手動接                               | —                                                                                                                                                                                                                       |

**順序**：`tailwind.css` 第一行就宣告 `@layer theme, base, primeng, utilities;`。layer 的順序由第一次出現決定，要在 PrimeNG 注入樣式之前就定好。
〔未驗證：PrimeNG 在 runtime 注入的 `@layer primeng` 與 build 時宣告的順序，在 SSR 與 CSR 下是否都一致。〕

**元件樣式**：新元件原則上**不寫元件樣式**，全部在 template 用 utility。真的需要時用 `.css`（不是 `.scss`），開頭 `@reference "<到 tailwind.css 的相對路徑>";` 才能 `@apply`
（<https://tailwindcss.com/docs/compatibility>，CSS modules 的段落；Angular 元件樣式是同一種「各自編譯的樣式表」〔未驗證：Angular 元件 CSS 跑不跑同一支 PostCSS，實作時用一個 `@apply` 驗〕）。

**掃描範圍**：`@source "./app";` 明寫在 `tailwind.css`，不依賴自動偵測〔未驗證：monorepo 下 `@tailwindcss/postcss` 自動偵測的根目錄是哪裡〕。

**單元測試**：`@angular/build:unit-test` 是否也套 PostCSS〔未驗證〕。測試不比對樣式，影響低。

### 3.2 prettier plugin（class 排序）

`prettier-plugin-tailwindcss`（README：<https://github.com/tailwindlabs/prettier-plugin-tailwindcss>）：

- Tailwind 4 要設 `tailwindStylesheet` 指向入口 CSS。路徑相對 prettier 設定檔，本 repo 的設定在根目錄 `package.json` 的 `prettier` 欄位，所以是 `./apps/web/src/tailwind.css`。
- **必須排在 plugins 的最後一個。** 目前沒有其他 plugin。
- 文件明列 `[ngClass]` 會被排序。其他屬性可以用 `tailwindAttributes` 擴充。
- ⚠️ **它也會重排既有的 BEM class 字串**：不認得的 class 會被移到前面。PostToolUse hook 每次編輯都跑 prettier，所以**下一個碰到某支 template 的人，diff 裡會多出一行跟他無關的 class 重排**。
  建議啟用時**同一支 PR 對全 repo 跑一次 `prettier --write "apps/web/src/**/*.html"`**，一次吃掉所有機械性 diff。

### 3.3 bundle 影響的量法

- **基線**：導入前跑 `npx nx build web --configuration=production`，記下 `dist/apps/web/browser/styles-*.css` 的大小（原始與 gzip），以及 initial total。對照 `apps/web/project.json` 的 budget（initial 警告 620kB）。
- **之後**：同一條指令、同一顆 commit 的前後各一次。Tailwind 只產生用得到的 class，所以初期增量應該只有 theme 變數與少量 utility。**PR 裡要附這兩組數字。**
- **還要記 `cssLayer` 切換前後的差值**：PrimeNG 的樣式是 runtime 注入，不在 `styles-*.css` 裡，build 的數字看不到它。

---

## 4. 遷移策略

### 4.1 規則

| 對象                                                 | 規則                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| **新頁、新元件**                                     | 一律 Tailwind。**不新增 `.scss`、不新增 BEM class**                 |
| **入口頁**（`features/public`、`select-role`、登入） | 使用者指定的第一批重排對象                                          |
| **其餘既有頁**                                       | 碰到大改時才整頁重排。小修照原樣（BEM＋SCSS），**不要半頁換**       |
| **同一個元件**                                       | **只用一套**。混用時 SCSS（未分層）一律贏過 utility（分層），見 2.2 |
| **tokens**                                           | 單一來源（`styles.scss` 的 `:root`）。Tailwind 端只引用、不另定值   |

### 4.2 退場：文件與 skill

- **`AGENTS.md`「CSS / SCSS」段落**改寫草稿：
  > 新 UI 一律 Tailwind（utility 寫在 template；入口 `apps/web/src/tailwind.css`）。既有 BEM＋SCSS 頁面只維護不擴張，重排時整頁換。
  > design tokens 的來源仍是 `apps/web/src/styles.scss` 的 `:root`，Tailwind 經 `@theme inline` 引用。禁止 viewport 單位（c6）同樣適用 Tailwind：用 `h-window` 系列，不用 `h-screen`／`*-dvh`。
- **`angular-scss-bem-standards` skill**：改成「**只在維護既有 SCSS 時使用**」，描述裡寫明新 UI 不適用。等 SCSS 歸零時整支退場。
  `AGENTS.md` 的「寫 SCSS 前先 invoke」改成同樣的限定。
  使用者層級的 memory（`feedback_scss_bem_skill`）也寫了同一條規則，**那份在使用者的家目錄，要使用者自己決定是否改**。
- **Banned Approaches 表**的「SCSS 使用 vh/vw…」那一列改成涵蓋 Tailwind（見第 5 節）。
- **新增**一份 Tailwind 慣例：token 用法、`h-window`、不混用、過渡期規則。可以放進 `AGENTS.md`，或寫成新的 skill。→ **待裁決點 5**。

### 4.3 會失明的 gate：遷移最大的隱性成本

這幾支 gate 解析的是 SCSS（`tools/agent-harness/lib/` 底下）。**頁面改用 Tailwind 之後，樣式活在 template 的 class 字串裡，它們什麼都看不到**，而且輸出還是綠的：

| gate            | 守什麼                               | Tailwind 頁面上                             | 對應的補法（另開單）                                                                      |
| --------------- | ------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `scss-contrast` | 文字實際疊在哪個底上的對比           | 失明                                        | 解析 class 字串裡的 `text-*`／`bg-*` 配對，對到 token 值算對比                            |
| `touch-target`  | 自刻可點元素的 44px 下限             | 失明                                        | 可點元素（`button`、`a`、`(click)`）的 class 要有 `min-h-11`、`size-11` 或等值            |
| `mobile-first`  | 桌機優先（`respond-to`）只准變少     | 失明                                        | Tailwind 本身就是 mobile-first。新規則改成「新程式碼不得用 `max-*:` variant」             |
| `orphan-class`  | template 的 class 在 SCSS 有沒有對應 | 不適用                                      | utility 拼錯會**靜靜沒樣式**。可以用 Tailwind 的候選比對驗 class 是否存在〔未驗證可行性〕 |
| `band-contrast` | token 本身的值                       | **仍有效**：它看 `styles.scss`，tokens 不搬 | 不用動                                                                                    |

**判準**：第一頁 Tailwind 上線之前，至少 `touch-target` 與 `scss-contrast` 要有 class 版本。
否則「gate 全綠」在那一頁上的意思會變成「沒有東西在看」，而輸出看不出來。

### 4.4 SCSS 退場的終點

當 `apps/web/src/**/*.scss` 只剩 `styles.scss` 時：

- tokens 搬進 `tailwind.css`；
- 拿掉 `inlineStyleLanguage: scss`、Sass 依賴、`_breakpoints.scss`、`respond-*` mixin；
- `angular-scss-bem-standards` 整支退場。

**過程中建議加一道棘輪 gate**：`.scss` 檔數與 BEM class 數**只准減少**（`mobile-first` gate 的「只准變少」同一個形狀）。不然「避免繼續使用 BEM＋SCSS」只是一句沒有執行者的話。

---

## 5. 要修憲或改 enforcement 的地方（草擬，agent 不得寫入 constitution.md）

### 5.1 c6 條文：載體從「SCSS」擴大到「樣式」

現行（`constitution.md:89-95`）只寫「**SCSS** 不得使用 `vh`／`vw`／`dvh`／`svh`／`lvh`」。enforcement 早就延伸到 `.ts` 與 `.html`，條文沒跟上；Tailwind 又多一個載體。**草案**：

> ### c6 禁止 viewport 單位 [Deterministic]
>
> 樣式不得產生 `vh`／`vw`／`dvh`／`svh`／`lvh`。這包含 SCSS／CSS 的值、`[style.*]`／`[ngStyle]` 綁定，以及**產生這些單位的 Tailwind utility**（`h-screen`、`min-h-dvh`、`w-svw` 等，與它們的任意值寫法）。
> 這些單位在 mobile Safari 位址列伸縮與巢狀 scroll container 下行為不可靠。
>
> 改用上層 directive 以 ResizeObserver 寫入的 CSS 自訂屬性：`calc(var(--window-width, 360px) * 0.9)` 取代 `90vw`；Tailwind 用 `h-window`／`w-window` 系列。

**修憲由專案擁有者本人執行**（`AGENTS.md`「Architecture Constitution」）。本頁只提供文字。

### 5.2 enforcement（不需修憲，改機制即可）

- `constitution-enforcement.md` 的 c6 列：補上 Tailwind 的 class 規則（1.2 ②），以及建置層的 `@source not inline`（1.2 ①）。後者是**第三層**，因為它在 build 時生效，不靠任何 hook 或 gate。
- `AGENTS.md` Banned Approaches 表：「SCSS 使用 `vh`／`vw`…」→「樣式（含 Tailwind utility）產生 viewport 單位」。

### 5.3 「不再新增 BEM＋SCSS」要不要入憲

**建議不入憲**：它是一個有終點的遷移方向，不是永久不變的架構不變量。
用 `AGENTS.md` 慣例加上 4.4 的棘輪 gate 就足以強制，而且棘輪歸零那天規則自然消失。
入憲的話，SCSS 退場後還得再修一次憲。→ **待裁決點 6**。

---

## 待裁決點（給計畫席與使用者）

1. **c6 條文草案**（5.1）可以嗎？由使用者親自修憲。
2. **`cssLayer` 切換**要不要單獨一支 PR 先做，並在 47 頁上做視覺回歸（2.2）？建議要。
3. **`tailwindcss-primeui` 要不要裝**？建議先不裝，避免兩套色名（2.4）。
4. **preflight 過渡期不開**（2.3），同意嗎？
5. **Tailwind 慣例寫在哪**：`AGENTS.md` 一節，或新的 skill（4.2）？
6. **「不再新增 BEM＋SCSS」用棘輪 gate，不入憲**（5.3），同意嗎？
7. **第一頁 Tailwind 上線前**，要求 `touch-target` 與 `scss-contrast` 先有 class 版本（4.3），同意嗎？

## 實作前必須驗證的〔未驗證〕清單

- PrimeNG **21** 的 `cssLayer` 行為與 v20／v22 文件一致
- 每一族 sizing utility 的完整 viewport 清單（1.1）
- 新的 c6 regex 抓得到 `md:h-screen` 這類陷阱（1.2 ②）
- `@utility` 能否覆寫同名內建 utility（1.2 ③ 的「為什麼不」）
- 深色模式 `@custom-variant` 的 v4 寫法、容器查詢 variant 語法、`max-*:` 的邊界（2.4、2.5）
- runtime 注入的 `@layer primeng` 與 build 時的 layer 順序宣告是否一致（3.1）
- Angular 元件 `.css` 是否走同一支 PostCSS、`@reference` 能否用（3.1）
- `@tailwindcss/postcss` 在 Nx monorepo 的自動偵測根目錄（3.1）
- `@angular/build:unit-test` 是否套 PostCSS（3.1）
