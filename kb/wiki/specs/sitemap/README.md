---
title: 整站 UI 地圖 —— 方法頁
summary: 怎麼畫一頁 UI 地圖、怎麼用瀏覽器兩向比對驗證它，以及五個會讓驗證靜靜失效的坑。
category: spec
status: developing
tags: [sitemap, method]
created: 2026-09-12
updated: 2026-09-12
---

# 整站 UI 地圖 —— 方法頁

這份地圖記的是**現在長什麼樣**，不是應該長什麼樣。`specs/` 底下其他規格記的是「應該」——
**兩者不同時記下差異，不要調和**（issue #685 的邊界）。

**一份沒驗過的地圖對改版是負債**：改版會照著它做，它錯在哪裡，改版就錯在哪裡。

## 檔案怎麼來

`kb/wiki/specs/sitemap/<role>/<slug>.md`，一條路由一個檔，**由腳本生成骨架**：

```sh
npx tsx tools/sitemap/generate-sitemap-skeletons.ts          # 生成 / 更新
npx tsx tools/sitemap/generate-sitemap-skeletons.ts --check  # 缺檔就 exit 1
```

腳本**import `RoutesCatalog` 本人**（不是 regex 掃原始碼），所以路由、角色、選單位置、
`showInMenu`、`permission` 永遠對得上程式碼。53 條路由 → public 6、admin 30、teacher 5、parent 12。

**重跑不會蓋掉你寫的東西**：只有 `<!-- generated:route-facts ... -->` 兩個標記之間歸腳本，
其餘一字不動。（Phase 1 多席同時寫，一次重跑洗掉別人半天的工作是這支腳本唯一真正危險的
失敗模式，所以它預設就不具備那個能力。）

⚠️ **frontmatter 的 `title` 不在生成區塊裡** —— 路由標籤改名時它不會自己更新。這是已知缺口。

## 每一頁寫什麼

骨架見任一個已生成的檔案。四個段落：**畫面區塊**、**互動元素**（表格）、**狀態**、
**子頁面：<對話框>**，最後是**驗證紀錄**。

### 「出現條件」欄是改版最需要的那一欄

一個只在「有停課」時才出現的按鈕，改版時要知道它存在。條件寫得出機制就寫機制
（例：`status === 'scheduled' 且 assignmentStatus === 'assigned'`），
**驗不到的狀態要明講「未驗」**，不要留白也不要猜。

### 不要把外框寫進頁面

左側選單與頂列屬於 [[specs/sitemap/_shared/shell-layout]]，53 頁共用。
頁面地圖**只寫 `<main>` 裡面的東西**。同理，多頁共用的對話框獨立成 `_shared/`，
各頁只放連結（例：[[specs/sitemap/_shared/attendance-roster-panel]]）。

判斷方法：`grep -rl <DialogComponent> apps/web/src/app`，排除元件自己與 `.spec`。
**≥ 2 個開啟點就獨立。**

## 驗證：兩向比對

1. 登入正確角色，開那一頁
2. 取得畫面上**可見**的互動元素清單（做法見下）
3. **地圖 ⊆ 畫面**：地圖列的每個元素都找得到 →「沒有捏造」
4. **畫面 ⊆ 地圖**：畫面上每個互動元素都有列 →「沒有遺漏」
5. 每個「會開對話框」的，真的按一次，比對子頁面段落
6. 每個「會導向」的，核對它的目標
7. **差異全部要處理**：改地圖，或記成「未驗到 + 原因」

**什麼算屬實：兩向比對為空，或每一筆差異都有明講的原因。沒有第三種。**

### 元素清單以 DOM 為準，不是以 `read_page` 為準

> ⚠️ **這一條推翻了工單原本寫的步驟。** 工單說用 `read_page` 的 `interactive` 無障礙樹當畫面真相。
> **`/admin/dashboard` 實測：`read_page` 在 `<main>` 內回報 6 個，DOM 實際有 10 個。**
> 漏掉的包含兩條整列連結（`在籍學生` → `/admin/students`、`本月報名異動` → `/admin/enrollments`）
> 與一顆可按的課表列。同一頁用 `find` 去問，那幾列又正確回報成 link ——
> **同一個頁面，兩個工具兩個答案。**
>
> **而漏掉的樣子跟「本來就沒有」一模一樣**：照原步驟做，地圖會少 4 筆，
> 兩向比對仍然是「0 差異」，因為比對的兩邊來自同一個瞎掉的來源。

用這一段取得清單（`javascript_tool`）：

```js
const visible = (e) => {
  const r = e.getClientRects();
  if (!r.length) return false;
  const cs = getComputedStyle(e);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && e.offsetParent !== null;
};
const main = document.querySelector('main') || document.body;
const all = [
  ...main.querySelectorAll(
    'a,button,input,select,textarea,[role="button"],[role="tab"],[role="link"],[role="checkbox"]',
  ),
];
const vis = all.filter(visible);
({
  total: all.length,
  visible: vis.length,
  list: vis.map((e) => ({
    tag: e.tagName.toLowerCase(),
    text: (e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 30),
    href: e.getAttribute('href') || '',
  })),
});
```

**`visible` 那道濾網不能省**：`/admin/sessions` 的 57 個元素裡有 3 個是手機版專用
（`session-filters__mobile-toggle` 與它自己的日期輸入），桌機寬度下在 DOM 裡但看不到。
**`read_page` 會漏報，裸 DOM 查詢會多報，兩個方向都會讓兩向比對說謊。**

`read_page` 仍然有用（它給 `ref`，`computer` 工具可以直接點），只是**不要拿它當清單的真相**。

## 五個會讓驗證靜靜失效的坑

### 1. toggle：你以為元件壞了，其實你按了兩次

**這一輪撞了三次**，每一次的症狀都是「按了沒反應，看起來是 bug」：

| 元件             | 當下的錯誤結論                                       |
| ---------------- | ---------------------------------------------------- |
| 課堂列的 ⋮ 選單  | 「已完成的列沒有選單」                               |
| 家長端孩子切換器 | 「有 3 個孩子的家長換不了孩子」——差一點送出的一支 P1 |
| 對話框           | 「取消鍵沒作用」                                     |

**下拉、選單、對話框幾乎都是 toggle**：開、關。探測時先確保是乾淨狀態，**只按一次**，
然後才讀。按兩次等於沒按。

### 2. 殘留的對話框：下一支讀到上一支

連續探測「停課」再探測「調課」，第二支回來的內容與第一支**一字不差** ——
點背景關不掉 PrimeNG 的 modal，讀到的還是上一支。

**如果兩支內容剛好不同，這個錯誤不會被發現。**

做法：關閉一定按對話框自己的「取消 / 關閉」，而且**下一步先斷言
`document.querySelector('.p-dialog') === null` 再繼續**。

### 3. 選擇器抓錯，而它「有回東西」

列的動作選單是專案自己的 `PopupMenuComponent`
（`cdk-overlay-pane.popup-menu__panel`，項目**沒有** `role="menuitem"`），**不是 PrimeNG 選單**。
先用 `.p-menu, [role="menu"], .p-tieredmenu` 去抓，四種列狀態裡兩種回 `null`、
兩種回了看起來很合理的清單。

**一個選擇器在部分情況下有回東西，不代表它抓的是你要的東西。**

本 repo 的正確選擇器：

| 東西       | 選擇器                                                                      |
| ---------- | --------------------------------------------------------------------------- |
| 列動作選單 | `.popup-menu__panel` / 項目 `.popup-menu__item` / 文字 `.popup-menu__label` |
| 對話框     | `.p-dialog`                                                                 |
| 遮罩       | `.cdk-overlay-backdrop`                                                     |

### 4. 收合／隱藏的內容仍然在樹裡

- admin 側欄六個群組是收合的，**18 條連結照樣出現在 `read_page` 與 DOM 查詢裡**
- 儀表板「收合時間軸」之後那一區是 `height:0 / opacity:0`，**內容仍在 DOM 且 `visibility: visible`**

「樹裡有」不等於「使用者看得到」。這是「畫面 ⊆ 地圖」最容易灌水的地方。

### 5. 探測動作本身會關掉你要看的東西

家長端的孩子下拉**失焦就關**，所以「先按開、再下一次工具呼叫去讀 DOM」會讀到空的。
這種一次性浮層要**在同一次互動裡讀完**，或直接用截圖存證。

## 環境：先確認你量的是哪一版

**dev server 可能服務別的 checkout。** 開工前：

```sh
lsof -nP -iTCP:4200 -sTCP:LISTEN -t | head -1 | xargs -I{} lsof -p {} -a -d cwd -Fn | grep '^n'
```

2026-09-12 實測：4200 是**主 checkout**，而主 checkout 當時停在 `a2c00d39`，
**落後 origin/main 兩支產品 commit**（#677 人員表單、#679 搜尋取消）。
本輪三頁因此改用自己 worktree 的 dev server（4201）並在每頁記下 commit。

**每一頁的驗證紀錄都要寫前端版本**，否則地圖無法被重驗。

### 登入

一次性 magic link（`npm run login-link`，需 `LOGIN_EMAIL`）。
**auth cookie 是 host 層級不分 port**，所以：

- 4201 的頁面可以用 callback 指向 4200 的連結登入
- **換角色會踢掉前一個** —— 做完一個角色再換，或用獨立 Chrome profile
- API 的 `trustedOrigins` 來自請求的 `Origin` 標頭，**頂層導覽沒有 Origin 會被拒**
  （`INVALID_CALLBACK_URL`）。從已開啟的頁面用 `fetch(..., {credentials:'include'})`
  兌換就會帶上 Origin

## 不要做的事

- **不要送出任何寫入**。對話框只開啟與取消。會直接寫入而不開對話框的動作
  （例如課堂列的「取消停課」）**一律不按**，記成「未驗 + 原因」
- **發現產品缺陷不要順手修** —— 開 issue 給計畫席，地圖裡記現況
- **不要抄 `specs/` 既有規格**
- **宣告缺陷之前先排除自己**：三次「看起來是 bug」有三次是量測方式的問題。
  去讀那個元件的原始碼，比從畫面推論可靠

## 已完成的範本

- [[specs/sitemap/admin/dashboard]] —— 最簡單的一頁，示範資料來源與條件式元素
- [[specs/sitemap/admin/sessions]] —— 最複雜的一頁，7 支對話框、依列狀態而異的選單
- [[specs/sitemap/parent/attendance]] —— 另一個角色
- [[specs/sitemap/_shared/shell-layout]] ／ [[specs/sitemap/_shared/attendance-roster-panel]]
