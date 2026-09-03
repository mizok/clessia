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
2. 作業台二刀(#249 CI 中,綠後計畫席收)
3. charter §五過期整修 [認領 bundle-analysis-4f](TIMELINE_COLLAPSE_LANE_THRESHOLD 已隨 #224 退役等)

## design-web-2

0. ~~對比債修復包~~ 完成(PR #220;baseline 23→10。實際分流跟工單預設不同:6 筆依**形狀**分流而非一律 600 —— 藥丸 chip 走 zinc-700 對齊 app-data-chip,非 chip 才走 600;role-picker__option-icon 是 icon 容器刻意不動。丙類其中一筆 error-700 疊 error-200 仍只有 4.47,改補 inset 描邊而非再調字色。icon 門檻退出 8 筆不是 9 筆) [認領 design-web-2-df 完成]
1. 拇指區 A–D 期完成(#197 壓成一支) [認領 design-web-2-df 完成]
2. 刀 3b-3 收尾確認完成(p-tag 零殘項;但盤出 15 支 NgModule 孤兒並建 gate) [認領 design-web-2-df 11:55]

## admin-pages(整理 2026-09-03 晚)

1. ~~B3 第二片~~(#227 綠,等使用者窗口 —— 金額計算類)
2. ~~B3 第三片:待開帳清單~~(#238 綠 MERGEABLE;與 #227 同碰 enrollments.service.ts,**排 #227 合後由 steward 驗 mergeable 再合**)
3. 期繳試算:收費週期選單(子元件已抽好)[認領 admin-pages-c3]
4. charter 蒸餾:git add -A 在切過分支的工作區不安全 / 測行為不測實作

## billing-api(整理 2026-09-03 晚)

1. ~~聚合端點~~(#205 已合)/ ~~c2 乙類~~(#225 已合)/ ~~bulk 已讀~~(#219 已合)/ ~~main 紅修~~(#243 已合)/ ~~蒸餾~~(#244 綠待 steward)
2. #215 解衝突(#209 合後 —— 唯一擋點是使用者窗口)
3. 500 案回查:用 #163 加的 observability 查散發 500 有沒有再發;無再發就正式結案寫 lessons,有就帶 log 升級

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

## 下週期補貨(斷點前落檔 2026-09-03 14:0x)

- (teacher-pages) 公開 shell 頁尾四連結 23px → 44px(一個元件全解,未登入使用者唯一導覽)
- (teacher-pages) select-role 單角色文案矛盾(「多個身分」但只有一項)
- (infra) 44px gate 邊界:納入公開 shell / 排除 1×1 focus sentinel / qr-checkin 標「空殼假綠,實作後重量」
- (design-web) 作業台第二刀:換 GET /api/workbench/today + 日到班形狀(骨架 PR 已出)
- (billing-api) #215 解衝突(#209 合後)
- (admin-pages) B3 第三片:待開帳清單(hasInvoice=false API 已備)
- (admin-pages) 期繳試算:收費週期選單(子元件已抽好)
- (admin-pages) charter 蒸餾:git add -A 在切過分支的工作區不安全 / 測行為不測實作
- (design-web) #235 解衝突(dashboard.component.ts 撞 #226/#224)後由 steward 合
- (design-web-2) #230(殼與導覽手機優先批)CI 紅修復 + #220 rebase
