# 常備工作佇列(零 idle 制)

> 計畫席維護,各席**做完手上的事、15 分鐘內沒有新工單或回覆時,從自己席的佇列
> 頂端認領下一項**:在本檔該項後面標 `[認領 <session名> <HH:MM>]`,commit+push,
> 照送達協定通知計畫席,然後直接開工(不等批准 —— 佇列裡的都是預先批准的)。
> 設計類產出照舊過 STOP gate。計畫席每輪 tick 保證每席佇列 ≥2 項。

## teacher-pages
1. notifications 規格落差小刀:「全部標為已讀」+ 類型圖示(調課/代課/停課)—— spec 有、實作零
2. students/notifications 兩頁補斷點(0 media query,1280 下一列 944px;dashboard 不補 —— 今日流會刪它)
3. (窗口批准後)今日流主刀

## design-web
1. 時間軸濃度圖設計稿(N=3 的真解:每半小時一根、濃度=同時堂數 —— 換畫法,day-timeline.util 重做的設計不動工)
2. bundle lazy chunk 內部拆分(你封存的舊分析的後續,撿回來評估哪些值得)
3. (窗口批准後)作業台實作

## design-web-2
1. 拇指區 C 期(進行中)→ D 期 gate(頁面層級 p-button 不得直寫 __header-actions)
2. 刀 3b-3 的收尾確認(53 顆膠囊遷移的殘項盤點,若已零殘項就結案記錄)

## admin-pages
1. (窗口 #184→#186 合併後)B3 第二片:批次結果開帳入口+試算顯示(note 必須顯示在金額旁)
2. 成績鍵盤邏輯收斂:school-score-editor 補鍵盤動線,抽共用(你自己提的半天量)
3. 點名空名單邊界(students=[] 時「全部標記完成」是空話)

## billing-api
1. 聚合端點 GET /api/workbench/today(進行中,交接單在 team/)
2. c2 乙類驗證:挑 me.ts:124 做一處 auth.api.updateUser 的可行性驗證,回報錯誤形狀
3. executionCtx waitUntil 兩處不一致統一(attendance.ts vs get-auth.ts)

## infra
1. 44px 觸控 ratchet gate(進行中)
2. scss-contrast baseline 的 23 筆舊債分診(真文字/裝飾,照刀 5 的分診法,產出報告不動碼)
