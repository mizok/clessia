# Showcase 前置：全站 bundle 初始載入健檢

> 2026-09-05，design-web 席。**報告，不是工單**——先報告後動工（計畫席指派）。
> 基準：`origin/main` @ `ffe5543`。方法：`npx nx reset` 清快取 → `npx nx build web
--configuration=production` 現建一次，不用殘留 `dist/`。

## ⚠️ 方法論更正：charter §三寫的「`npx ng cache clean`」現在會報錯

repo 沒有 `angular.json`（坑 #1 早就記過），這條指令在 Angular 21 + 目前的 workspace 結構下
直接噴 `Error: This command is not available when running the Angular CLI outside a
workspace`——**不是我操作錯，是這條指令本身已經跟現況脫節**。真的清快取要用
`npx nx reset`。已經在本報告末段建議回頭修 charter 那一行，這裡先照實記錄，
不要照抄舊指令去撞同一個錯。

## 一、初始 bundle 現在多大

|                                    | Raw               | Estimated transfer |
| ---------------------------------- | ----------------- | ------------------ |
| **現在（12 個初始檔案，含 CSS）**  | **584.36 kB**     | **142.23 kB**      |
| 2026-08-29 lesson 記錄的瘦身後基準 | 575.35 kB         | 139.13 kB          |
| 差異                               | +9.01 kB（+1.6%） | +3.10 kB（+2.2%）  |

**這個對比不是嚴謹的同機同 cache 比對**——08-29 的數字是歷史記錄，不是這次同時現建的
第二份 baseline（charter 方法要求兩邊都在同一台機器現建；一週前的機器/cache 狀態
已經不可還原）。誠實講：**這只能當「量級沒有失控」的粗略訊號**，不能拿來做
「這週具體多花了幾 kB」這種精確歸因——中間隔了一週、上百個 commit，
不只是家長端/教務日誌那幾支。

**結論**：584 kB / 142 kB transfer，量級上跟一週前持平（個位數 kB 增長），
**沒有失控的訊號**。showcase 首屏載入時間不會因為這週的新增有感變差。

## 二、家長端 / 教務日誌有沒有洩漏進初始 chunk

**沒有洩漏。** 掃了全部 11 個初始 JS chunk（`main` + 10 個 vendor/common chunk），
用下面這組特徵字串都是零命中：`app-parent`、`app-attendance`、`app-payments`、
`app-grades`、`class-log`、`教務日誌`、`聯絡簿`、`session-pack`、`childDb`、
`studentScope`、`孩子`。

**正例驗證過掃描方法本身沒有壞掉**（呼應坑 #16/#19 的「驗證通過也要問驗的是不是那件事」）：
`app-parent` 在 lazy chunk `chunk-B4VNZTKJ.js`（build 報告點名的 `parents-page`）裡
確實命中——如果掃描壞了應該連這個正例都掃不到，掃到了代表零命中是真的零命中，
不是掃描器沒在讀檔案。

**教務日誌（`class-logs`）目前完全沒有前端程式碼**——#338 是純構圖文件，
teacher-pages 的 v1a 還在設計/收斂階段，還沒有元件落地。這次掃到的「零命中」
是「還沒有東西可以洩漏」，**不是「已經驗證過不會洩漏」**——teacher-class-log.md
的元件真的寫出來之後，這個檢查要重跑一次，現在的乾淨不能背書到那時候。

## 三、有沒有重複打包的依賴

**沒有找到明顯重複。** 兩個高風險候選都查過：

- **`xlsx`**（單一函式庫最大宗，lazy chunk 432 kB）：字串命中 3 個 chunk，
  但另外兩個（`class-detail-page` 104 kB、`parents-page` 52 kB）看過上下文，
  一個是純 UI 文案（「支援 .xlsx 與 .csv」），一個是 `import('./chunk-NC47MY4B.js')`
  的動態載入參照——**函式庫本體只有一份**，各消費端正確地共用同一支 lazy chunk，
  不是各自打包一份。
- **`date-fns`**：只出現在 1 個 chunk。表示建置正確把它收斂成單一共用模組，
  沒有被拆進多個 lazy chunk 各自帶一份。

**沒有再往下查更多依賴**——這兩個是體積最大、最容易重複的候選，抽查通過就先報告，
逐一窮舉全部 npm 依賴的成本不成比例（ponytail：先問值不值得，這裡的訊號已經夠強）。

## 四、瘦身清單（先報告，額度批准才動工）

| #   | 項目                                                                                                                      | 預估省多少                                                                                                                                                                                                                                                                                                                                                           | 前置條件                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Aura preset 全量匯入**（`app.config.ts` 一行 `import Aura from '@primeuix/themes/aura'`，確認仍在，全量匯入的狀態沒變） | 約 43 kB（charter §五既有估計，這次只確認匯入方式沒變，沒有重新精算）                                                                                                                                                                                                                                                                                                | **要先有一條比對 `from 'primeng/x'` 與 preset 清單的 gate**——沒有這條，砍掉沒用到的 preset token 會在執行期悄悄壞樣式且編譯期不報錯（charter 已經寫過這個前提，這裡不重複造） |
| 2   | **primeicons 子集化**                                                                                                     | **這次查過，比 backlog 寫的更精確**：`@font-face` declare 了 5 種格式（`woff2`/`woff`/`ttf`/`eot`/`svg`），但現代瀏覽器只會抓 `woff2` 那份（**36 kB**），其餘 4 份（合計約 588 kB）是部署產物體積、不是多數使用者的下載量。**子集化能省的是那 36 kB 裡用不到的字符，不是常被誤會的「省幾百 kB 下載」**——先修正這個數字再排優先序，實際值得動的空間比原本以為的小很多 | 低優先，效益被之前的估計高估了                                                                                                                                                |
| 3   | 收斂 `angular.json`/`project.json`                                                                                        | 0 kB（不影響 bundle，純工程債）                                                                                                                                                                                                                                                                                                                                      | 跟 bundle 健檢無關，不建議跟這輪一起做                                                                                                                                        |

**排序建議**：#1 有明確數字且是既有已知項，值得優先；#2 這次查完發現效益比想像小，
**降低優先序**；#3 不是 bundle 議題，移出這份清單的動工範圍。

## 五、SCSS 元件預算警告（build 過程順手看到，非初始 bundle 但值得記一筆）

Build 印了 9 個超過 6 kB 元件樣式預算的警告（**warning 不是 error，不擋 build**）：

| 檔案                                                                                      | 超出                                         |
| ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| `admin/pages/courses/courses.page.scss`                                                   | +2.06 kB（8.06 kB）                          |
| `admin/pages/courses/class-detail/class-detail.page.scss`                                 | +2.63 kB（8.63 kB）                          |
| `admin/pages/dashboard/dashboard.component.scss`                                          | +1.96 kB（7.96 kB，charter §五已知並解釋過） |
| `admin/pages/students/detail/student-detail.page.scss`                                    | +1.33 kB（7.33 kB）                          |
| `admin/pages/grades/overview/class-view/class-scores-dialog/...scss`                      | +1.78 kB（7.78 kB）                          |
| `shared/components/responsive-table/responsive-table.component.scss`                      | +163 B（6.16 kB）                            |
| `admin/pages/grades/overview/class-view/class-view.component.scss`                        | +186 B（6.19 kB）                            |
| `admin/pages/grades/overview/student-view/.../student-score-detail-dialog.component.scss` | +23 B（6.02 kB）                             |
| `admin/pages/courses/class-detail/student-picker-dialog/...scss`                          | +10 B（6.01 kB）                             |

**這些是元件樣式、隨各自路由 lazy 載入，不影響首屏**——跟這次健檢的「打開多快」
沒有直接關係，**不建議塞進這輪瘦身清單**，只是 build 過程看到了順手記下來，
免得下次有人另外花時間重新發現同一份清單。

## 六、給 charter 的小訂正（建議，不是這次要做的事）

`herdr-team/design-web.md` §三「bundle 驗收線的量法」寫的 `npx ng cache clean`
在現在的 workspace 結構下會直接報錯，應該改成 `npx nx reset`——這不是這次的
交付範圍，但既然撞到了就記下來，下一個照抄charter去量的人不用重摔一次。
