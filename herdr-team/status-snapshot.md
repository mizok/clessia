# 計畫席狀態快照(額度斷點恢復用)

> 計畫席在額度逼近時落檔;任何 session(含復活的計畫席)接手先讀這裡
> + `gh issue list --state open`(2026-09-06 起工單載體是 GitHub issues,不是 backlog.md)。
> 最後更新:2026-09-03 11:56(main 已回綠 #199;待合:#196重跑/#197/#198/#200)

## 窗口待辦(使用者 12:00/17:00)
1. **親合順序:#184 → #186**(B3 金額路徑,兩支 CI 綠;#186 依賴 #184 的 adjustmentNote)
2. **一句話確認**:掃碼出勤最終版=「只替有報名的課寫」(#178 已出貨),09-02 的「完全不寫」版作廢 —— 說「確認」即可
3. **裁規則 2.4**:規則頁「課後自動標缺席」從未實作且是四個 bug 的源頭 —— 計畫席傾向刪除該條
4. 方向級確認項(已先行,可否決):今日流設計(刪老師儀表板)、作業台+日到班整併設計、時間軸濃度圖設計、拇指區(B 期截圖在 #183/#197)
5. 輕量知會:收件匣 spec 改為「只承載公告」,課務異動推播歸 P4

## 在飛(各席)
- billing-api:聚合端點 GET /api/workbench/today(交接單 team/billing-api-workbench-today-endpoint.md)
- admin-pages:#196 成績鍵盤收斂(**CI 紅,需查**);B3 第二片等 #184 進 main
- teacher-pages:#198 全部已讀(CI 跑);接 students 補斷點(notifications 半等 #198 合)
- design-web:lazy chunk 拆分評估;濃度圖/作業台設計等窗口批准後實作
- design-web-2:#197 拇指區壓縮版(CI 跑);接 3b-3 盤點
- infra:scss-contrast 23 筆舊債分診;磁碟 watch 掛著(20GB 叫/10GB 自動 prune)

## 計畫席復活後第一件事
gh pr list 看 CI → 合綠的(v2 授權,migration/金額/授權除外)→ 逐席 herdr agent get,
idle 且輸入框有殘字先代按/清 → 依 `gh issue list --label seat:<席位> --state open` 補派。部署:web=pages deploy,api=wrangler deploy。
