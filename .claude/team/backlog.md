# 常備工作佇列(零 idle 制)

> 計畫席維護。各席**交付即繼續**:送出交付訊息後直接認領自己佇列的下一項開工
> (認領=SendMessage 向計畫席宣告,由計畫席落標記 —— worktree 推不動 main)。
> 佇列項都是預先批准的;設計類產出照舊過 STOP gate。計畫席保證每席佇列 ≥2 項。

## teacher-pages(整理 2026-09-04 凌晨)

1. ~~notifications 規格落差~~ 完成 / ~~兩頁斷點~~(#201/#208 用 max-width 上限吸收,工單問錯方向)/ ~~今日流~~(#226 已合)/ ~~#247/#248/#253~~ 已合
2. 前端接 `POST /api/announcements/read-all`(API 是 #219,**已在 main**)—— 把「全部已讀」從 N 個 request 換成一發;先查有沒有人接過
3. 驗銷假警告是否已用 leaveStartDate 說「將」(API 是 #222,**已在 main**)—— 已接就回報結案,沒接就接上

## design-web(整理 2026-09-04 凌晨)

0. ~~分校預設過濾 14 支路由~~(#209 綠,等使用者窗口)
1. ~~濃度圖~~(#224 已合)/ ~~lazy chunk~~(#200 已合+lesson,結案不排二輪)/ ~~作業台一刀~~(#235 已合)
2. ~~作業台二刀~~(#249 已合)
3. charter §五過期整修 [認領 bundle-analysis-4f](TIMELINE_COLLAPSE_LANE_THRESHOLD 已隨 #224 退役等)

## design-web-2

0. ~~對比債修復包~~ 完成(PR #220;baseline 23→10。實際分流跟工單預設不同:6 筆依**形狀**分流而非一律 600 —— 藥丸 chip 走 zinc-700 對齊 app-data-chip,非 chip 才走 600;role-picker__option-icon 是 icon 容器刻意不動。丙類其中一筆 error-700 疊 error-200 仍只有 4.47,改補 inset 描邊而非再調字色。icon 門檻退出 8 筆不是 9 筆) [認領 design-web-2-df 完成]
1. 拇指區 A–D 期完成(#197 壓成一支) [認領 design-web-2-df 完成]
2. 刀 3b-3 收尾確認完成(p-tag 零殘項;但盤出 15 支 NgModule 孤兒並建 gate) [認領 design-web-2-df 11:55]

## admin-pages(整理 2026-09-04 上午)

1. ~~B3 全線~~(#227/#238/#240 已合)/ ~~charter 蒸餾~~(#242 已合)/ ~~不及格形狀訊號~~(#267 綠待收)
2. ~~及格線過渡小刀~~(交付為 #271,已合;vw 刀交付為 #273)
3. (窗口項)`及格線` 成為考試欄位 —— spec 已明寫「依該考試設定的及格線」,需 migration,保留類等使用者

## billing-api(整理 2026-09-03 晚)

1. ~~聚合端點~~(#205 已合)/ ~~c2 乙類~~(#225 已合)/ ~~bulk 已讀~~(#219 已合)/ ~~main 紅修~~(#243 已合)/ ~~蒸餾~~(#244 綠待 steward)
2. ~~#215 解衝突~~(#215 已合,#209 也已合)
3. 500 案回查(**09-07 後**,查的人是計畫席/使用者 —— 席位無 CF 憑證;billing-api 已備好
   查詢條件:POST /api/courses、body 帶 SERVER_ERror、不用 --status error、對照 #163 的 [auth] 行)
4. ~~銷假精確警告~~(#265+#274+#279 全鏈完成:roster 逐張布林+重疊釘測+前端接線「將」)。原單:**不開 dry-run 端點**(多一次往返,違延遲原則),改在既有 roster
   回應逐張假算精確布林(存在 start<sessionDate && end>sessionDate 的單張假 = 真連坐)——
   min/max 聚合分不出接力假,只有後端逐張資料算得出「將/不會」

## infra

1. ~~44px 觸控 ratchet gate~~ 完成(#195 已合;規則反向寫成「有 cursor:pointer 卻無尺寸下限」,
   範圍由 mobile-first baseline 推導,既有 19 筆進 baseline)
2. ~~scss-contrast baseline 23 筆分診~~ 完成(報告已交,三裁全准並轉 design-web-2 佇列第 0 項:
   真文字僅 8 筆、其中 6 筆同一配對 zinc-500/zinc-100 4.44)
3. ~~nx defaultBase 指向不存在的 dev~~ 完成(#204 已合;自行認領自 charter 已知缺口,
   一行設定 + 7 處會變成假話的敘述同步)

4. ~~web 獨立 typecheck 接 Stop gate~~ 完成(#211 已合;關鍵是用 ngc 不是 tsc ——
   實測 tsc 對模板錯誤回報 0 個錯誤。Stop gate 一行沒改就接上,成本 +7 秒)
5. ~~test-baseline 3 紅分診~~ 完成:**那筆債不存在**。`knownFailing` 是 `[]`、
   測試 198 檔 1492 條全綠、gate 早就在全強度。「3」是我當初用 `Object.keys()` 數到
   metadata 鍵的量測錯誤,已在 charter 記為範例。

**佇列已空,待計畫席補項。** 本席自行認領時的來源是 `.claude/team/infra.md` 的
「已知缺口」節,目前剩:apps/web 無獨立 typecheck target(Stop gate 盲區)、
c5 未機器化、test-baseline 3 個紅燈、dagger 快取無 GC 政策(根因在 fvg)。
磁碟 watch 持續掛著(20GB 警戒 / 10GB 自動 prune)。

## infra(補貨 13:25)

1. apps/web 獨立 typecheck target 接進 Stop gate(本機/CI 覆蓋不對稱,你的建議 1,准)
2. test-baseline.json 3 個既有紅燈分診(清一支移一支,先報告)
3. (billing-api) roster 補 leaveStartDate 聚合值 —— 讓銷假事前警告從「可能」變「將」(#213 的需求單)

## 下週期補貨(2026-09-03 斷點落檔)—— **全數完成,清單見 git history**

## 收手快照(2026-09-04 收手令,保 token 給 fvg)

在飛 PR:**全數收完**(#264/#273/#275/#276/#278~#282,steward 十支鎖 SHA+三次部署三方比對;
#283 部署單線約定自收)。線上 = main。
**觸控債帳面:17→1 不是 0** —— `.exams__name-link`(exams.component.scss)是 #275 期間新長的,
在 baseline 裡待清,下週期一筆小刀。對比債 0+5 豁免。

下週期開工單:

- (計畫席)心跳暫停旗標刪除:`rm ~/.local/share/clessia-heartbeat.pause`
- (計畫席,復工第一刀)`.claude/team/` 改名 `herdr-team/`(避免與原生 agent teams
  功能混淆;`git mv` + 8 處引用更新,已 grep 過波及面;復活令裡明寫新路徑)
- (infra)c6 gate ①(掃 TS,零 baseline)—— #273 已合,等 #282/#281 落地後上
- (teacher-pages/使用者)iOS Safari 實機:#282 的抽屜不被工具列蓋住(裁決核心的人工確認)
- (使用者窗口)及格線欄位 migration / 科目平均百分比化 / 640px 視覺 / iOS 抽屜確認
- 誰先 db:reset 誰驗 seed 雙身分帳號(#279 帶進的)
- 500 案回查 09-07 後(計畫席持 CF 憑證查,billing-api 分析)

## 現行補貨(2026-09-04 凌晨)

- (infra) Docker/supabase 回復(`npm run db:start`)—— teacher-pages 等它補實機驗證 [已派]
- (infra) admin 剩餘 17 筆 44px 觸控債分診:base 44 vs 兩層寫法(#250 已解鎖),清單交計畫席 [已派]
- (infra) **雙軌表格 ratchet gate**:掃「斷點內 display:none 掉 __table-wrap」結構訊號,
  現有 4 支(成績區)進 baseline,擋新增的手刻手機版 —— 讓未來表格自然走 responsive-table
- (design-web-2) 對比債 10 筆殲滅戰:歸零或轉永久豁免+why [已派]
- (design-web-2) admin 17 筆觸控債實作(等 infra 分診單)
- (admin-pages) academy-score-editor 輸入格標不及格形狀訊號(icon+aria,低於門檻才現;
  design-web 的 a11y 修復刀刻意留下的獨立小刀)
- ~~(teacher-pages) read-all 接線+銷假警告~~(#258 已合)→ 剩:等 Docker 補 #247/#258 實機驗證
- ~~(design-web) a11y 修復~~(#259 已合)/ ~~#257 修正~~(已合)/ ~~lesson 增補~~(#260 已合)→ 剩:刀 B(等 Docker)
