# labor-20261021-1542-classroom 席 charter（通用執行席，Opus，全端）

> **charter 版本 2026-10-22 20:47**（Ctx 65%，照計畫席規則先寫；還在席）。計畫席 labor-plan-20261008-1357；審核席 labor-reviewer-20261016-2000、第二審核席 labor-20261022-1621-review2。

## 一、交付（10-22）

| PR                                                  | 內容                                                                                        | 狀態                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------- |
| #1814 #1836 #1838 #1847 #1852 #1854 #1860           | 家長到班、試聽日期、續課資訊、家長改孩子交易、頂欄間距、iOS 快選面板、同層換頁 12px         | 已合                             |
| #1817                                               | #1591 全站基底 14px                                                                         | merge main @aca42e53，等審核席合 |
| #1864                                               | #1859 第 1 張：page-open 改用 appHeightFollow（擴充：跳過絕對定位子元素）＋學生翻頁保留標題 | 7119fc62，等第二審核席           |
| #1868                                               | #1866 手機頂欄一列＋桌機只留頭像＋徽章往右長                                                | 2d98d701，送審                   |
| （WIP）labor-20261021-1542-classroom-1859-sections2 | #1859 第 4 張：儀表板／價目表區塊 appHeightFollow                                           | 待逐幀工具驗收後開 PR            |

## 二、待接手

1. 逐幀跳動量測工具（tools/a6-conformance），用它重驗 #1864、驗收第 4 張、#1859 表加欄。
2. #1859 第 3 張（孩子切換器）：在 page-open 插槽內，第 1 張已涵蓋，用新工具確認後結案。

## 三、坑

- **layout-shift 量不出「滑」**：它把 ResizeObserver 回呼前的排版也記成位移，出現成對的 +X／-X（1ms 內）。用 CDP screencast 逐幀量實際畫面。
- **新建 WAAPI 動畫是 pending**，下一幀才套用；`anim.currentTime = 0` 讓它立即生效（sections2 已加在 appHeightFollow）。
- **flex-wrap 用 max-content 判斷換行**：要讓一組東西不換行，給它 `flex: 1 1 0`＋`min-w-0`。
- **primeicons `.pi` 的 display 不在 layer**，會蓋過 Tailwind `hidden`；藏外層 span。
- **dev server 切分支後可能留舊的編譯錯誤 overlay**，重存一次檔或等重建。
- **截圖放 orphan 分支** labor-20261021-1542-classroom-assets，PR 用 `blob/...?raw=true` 內嵌。
- **量測腳本** tools/a6-conformance/_cls-measure.mjs（未追蹤）：wrangler 會崩，route.fetch 要重試＋abort。
- **jump.mjs 頁名要用 PAGES 裡的名字或路徑**：不在清單的名字會被當網址，整批中斷。
- **儀表板區塊是資料回來才出現**：「包一層＋appHeightFollow」對它無效（首次出現不滑）。
