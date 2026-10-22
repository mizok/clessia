# labor-20261021-1542-classroom 席 charter（通用執行席，Opus，全端）

> **charter 最終版 2026-10-22 20:59**：本席退場（Ctx 約 70%，計畫席同意交接）。接手的人從「二、待接手」第 1 項開始。
> 計畫席 labor-plan-20261008-1357；審核席 labor-reviewer-20261016-2000；第二審核席 labor-20261022-1621-review2。

## 一、交付

| PR                                              | 內容                                                                                                         | 狀態（退場時查過）                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| #1805 #1814 #1836 #1838 #1847 #1852 #1854 #1860 | #1778 手動收款、家長到班、試聽日期、續課資訊、家長改孩子交易、頂欄間距、iOS 快選面板、同層換頁 12px（#1849） | 已合                                       |
| #1817                                           | #1591 全站基底 14px                                                                                          | 已合                                       |
| #1864                                           | #1859 第 1 張：page-open 改用 #1861 的 appHeightFollow（擴充：跳過絕對定位子元素）＋學生翻頁保留標題         | 已合（7119fc62）                           |
| #1868                                           | #1866 手機頂欄一列、桌機手機都只留頭像、未讀徽章往右長                                                       | **開著**，head 2d98d701，送審中            |
| #1883                                           | 逐幀跳動量測工具 `tools/a6-conformance/jump.mjs`                                                             | **開著**，head 9227dfb3，CI 綠，已送審核席 |
| #1878                                           | 本 charter                                                                                                   | 開著                                       |
| #1865                                           | #1859 第 2 張（頂欄換列）                                                                                    | 已關，由 #1866 取代                        |

## 二、待接手（新席）

1. **#1879 共用骨架元件＋#1859 第 4 張**（計畫席：合在一起做）。
   - 新工具證實：儀表板手機三版都約 1460px 的一跳，原因是主要區塊在資料回來才出現（`@if`），而 `appHeightFollow` 刻意不滑「從 0 長出來」。所以「區塊外包一層＋appHeightFollow」無效。
   - 方向：區塊從第一幀就存在，骨架放在區塊裡、寬度和形狀跟內容一致（列、卡片、章節），資料回來時用 appHeightFollow 滑。
   - **分支 `labor-20261021-1542-classroom-1859-sections2` 廢棄，不要接**（遠端留著）。它唯一值得留的是 `height-follow.directive.ts` 的 `anim.currentTime = 0`（新建 WAAPI 動畫是 pending，下一幀才套用；照規格判斷，改善沒量到）。
2. **#1859 剩下的**：家長繳費桌機 216px、到班紀錄、考試（預設選擇器對不到，用 `--sel`）。#1859 第 3 張（孩子切換器）在 page-open 插槽內，已被 #1864 涵蓋，用工具確認後結案。
3. **計畫席交接訊息寫的「#1849」**：已由 #1860 合併、單已關，請計畫席確認是不是指別張。

## 三、工具用法

```sh
# 逐幀跳動（#1883）：主欄＝相鄰兩幀的最大跳動 px
A6_APP_URL=http://localhost:4212 A6_API_URL=http://localhost:8794 \
  node tools/a6-conformance/jump.mjs students /parent/grades p-payments --widths 1440,390 --out /tmp/j.json
# 追區塊內部：--sel 分號隔開，每個一個標記色（最多 8）
node tools/a6-conformance/jump.mjs dashboard --sel 'app-dashboard .colls;app-dashboard nav.flex-col'
```

- 頁名用 `lib/config.mjs` PAGES 的名字，或直接給路徑；不在清單的名字會被當網址，整批中斷。
- 印「沒量到」＝畫面上沒有任何標記（選擇器沒對到結構），不是沒跳。
- 驗收比對：main 和分支各跑一次，dev server 一次只服務一個工作樹，切分支後等約 40 秒重建。

## 四、會再撞到的坑

- **layout-shift 量不出「滑」**：它把 ResizeObserver 回呼前的排版也記成位移，出現成對的 +X／-X（1ms 內），CLS 累加反而變高。驗收一律用逐幀工具。
- **flex-wrap 用 max-content 判斷換行**：要讓一組東西不換行，給 `flex: 1 1 0`＋`min-w-0`。
- **primeicons `.pi` 的 display 不在 layer**，會蓋過 Tailwind 的 `hidden`；藏外層 span。
- **模板裡 `[class.任意值]` 綁定會靜默失效**；用 `data-*` 屬性＋Tailwind `data-[x]:` variant。
- **dev server 切分支後可能留舊的編譯錯誤 overlay**，重存檔或等重建。截圖前確認。
- **PR 截圖**放 orphan 分支 `labor-20261021-1542-classroom-assets`，PR 用 `blob/<分支>/<路徑>?raw=true` 內嵌；大圖推不上去時 `git -c http.postBuffer=524288000 push`。
- **本機 wrangler（API）在負載下會崩**，量測腳本的 route.fetch 要重試＋abort，否則整支掛掉。
- **審核席的突變**：每個存活突變補一支「拿掉它會紅」的 spec，自己套回去跑一次確認；突變改壞語法時沒有「Tests」那行，不算數。
- **已推的分支不 rebase、不 force push**；跟 main 衝突就 merge main。疊在別張上的工作，原張改了就開新分支重做。
