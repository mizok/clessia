# 常備工作佇列(零 idle 制)

> 計畫席維護。各席**交付即繼續**:送出交付訊息後直接認領自己佇列的下一項開工
> (認領=SendMessage 向計畫席宣告,由計畫席落標記 —— worktree 推不動 main)。
> 佇列項都是預先批准的;設計類產出照舊過 STOP gate。計畫席保證每席佇列 ≥2 項。

## teacher-pages

1. notifications 規格落差小刀 [認領 teacher-pages-5b 11:42]:全部已讀(前端逐一版)+修 spec(收件匣=公告);類型圖示裁不做(無資料),課務異動推播歸 P4 通知線
2. students/notifications 兩頁補斷點(0 media query,1280 下一列 944px;dashboard 不補 —— 今日流會刪它)
3. (窗口批准後)今日流主刀

## design-web

0. 分校預設過濾 14 支路由接線(A7c 後續,無需批准)[認領 bundle-analysis-4f 11:56]
1. 時間軸濃度圖設計稿 [認領 bundle-analysis-4f 11:37 · 完成待窗口](N=3 的真解:每半小時一根、濃度=同時堂數 —— 換畫法,day-timeline.util 重做的設計不動工)
2. bundle lazy chunk 內部拆分(你封存的舊分析的後續,撿回來評估哪些值得)
3. (窗口批准後)作業台實作

## design-web-2

0. 對比債修復包:6 筆 zinc-500→600(zinc-100 上 4.44)+#19 error-600→700;丙類 4 筆 hover 逐處開檔追祖先(infra 分診報告);gate 升級:宿主 .pi/i/svg 用 3:1 門檻(9 筆 icon 退出 baseline)
1. 拇指區 A–D 期完成(#197 壓成一支) [認領 design-web-2-df 完成]
2. 刀 3b-3 收尾確認完成(p-tag 零殘項;但盤出 15 支 NgModule 孤兒並建 gate) [認領 design-web-2-df 11:55]

## admin-pages

1. (窗口 #184→#186 合併後)B3 第二片:批次結果開帳入口+試算顯示(note 必須顯示在金額旁)
2. ~~成績鍵盤收斂~~(#196 已合) / ~~xlsx 匯入實測~~(#207 綠待合 —— 實測抓到 CSV 前導零被吃掉,連 roster-import 一起修)
3. ~~點名空名單邊界~~(#203 已合)
4. **(空)** —— 第 1 項被 #184/#186 擋著,2/3 已完成。請補貨

## billing-api

1. 聚合端點 GET /api/workbench/today(進行中,交接單在 team/)
2. c2 乙類驗證 [認領 pin-better-auth-3c 13:25]:挑 me.ts:124 做一處 auth.api.updateUser 的可行性驗證,回報錯誤形狀
3. ~~executionCtx 統一~~(#215 完成待合,排 #209 之後 rebase —— 實際 86 處三種寫法,可選鏈假防護已修)
4. POST /api/announcements/read-all [認領 pin-better-auth-3c 14:0x](bulk 已讀;前端逐一版已出,這支是效率+原子性升級)

## infra

1. ~~44px 觸控 ratchet gate~~ 完成(#195 已合;規則反向寫成「有 cursor:pointer 卻無尺寸下限」,
   範圍由 mobile-first baseline 推導,既有 19 筆進 baseline)
2. ~~scss-contrast baseline 23 筆分診~~ 完成(報告已交,三裁全准並轉 design-web-2 佇列第 0 項:
   真文字僅 8 筆、其中 6 筆同一配對 zinc-500/zinc-100 4.44)
3. ~~nx defaultBase 指向不存在的 dev~~ 完成(#204 已合;自行認領自 charter 已知缺口,
   一行設定 + 7 處會變成假話的敘述同步)

**佇列已空,待計畫席補項。** 本席自行認領時的來源是 `.claude/team/infra.md` 的
「已知缺口」節,目前剩:apps/web 無獨立 typecheck target(Stop gate 盲區)、
c5 未機器化、test-baseline 3 個紅燈、dagger 快取無 GC 政策(根因在 fvg)。
磁碟 watch 持續掛著(20GB 警戒 / 10GB 自動 prune)。

## infra(補貨 13:25)
1. apps/web 獨立 typecheck target 接進 Stop gate(本機/CI 覆蓋不對稱,你的建議 1,准)
2. test-baseline.json 3 個既有紅燈分診(清一支移一支,先報告)
5. (billing-api) roster 補 leaveStartDate 聚合值 —— 讓銷假事前警告從「可能」變「將」(#213 的需求單)

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
