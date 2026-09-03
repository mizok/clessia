# 常備工作佇列(零 idle 制)

> 計畫席維護,各席**做完手上的事、15 分鐘內沒有新工單或回覆時,從自己席的佇列
> 頂端認領下一項**:在本檔該項後面標 `[認領 <session名> <HH:MM>]`,commit+push,
> 照送達協定通知計畫席,然後直接開工(不等批准 —— 佇列裡的都是預先批准的)。
> 設計類產出照舊過 STOP gate。計畫席每輪 tick 保證每席佇列 ≥2 項。

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
1. 拇指區 C 期(進行中)→ D 期 gate(頁面層級 p-button 不得直寫 __header-actions)
2. 刀 3b-3 收尾確認完成(p-tag 零殘項;但盤出 15 支 NgModule 孤兒並建 gate) [認領 design-web-2-df 11:55]

## admin-pages
1. (窗口 #184→#186 合併後)B3 第二片:批次結果開帳入口+試算顯示(note 必須顯示在金額旁)
2. ~~成績鍵盤收斂~~(#196 完成)→ 遞補:xlsx 匯入實測(#200 改動態載入後,真 .xlsx/.csv 各驗一次):school-score-editor 補鍵盤動線,抽共用(你自己提的半天量) [認領 admin-pages 11:35]
3. 點名空名單邊界(students=[] 時「全部標記完成」是空話)

## billing-api
1. 聚合端點 GET /api/workbench/today(進行中,交接單在 team/)
2. c2 乙類驗證:挑 me.ts:124 做一處 auth.api.updateUser 的可行性驗證,回報錯誤形狀
3. executionCtx waitUntil 兩處不一致統一(attendance.ts vs get-auth.ts)
4. POST /api/announcements/read-all(bulk 已讀;前端逐一版已出,這支是效率+原子性升級)

## infra
1. 44px 觸控 ratchet gate(進行中)
2. scss-contrast baseline 的 23 筆舊債分診(真文字/裝飾,照刀 5 的分診法,產出報告不動碼)
