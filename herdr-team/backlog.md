# 常備工作佇列(零 idle 制)

> 計畫席維護。各席**交付即繼續**:送出交付訊息後直接認領自己佇列的下一項開工
> (認領=SendMessage 向計畫席宣告,由計畫席落標記 —— worktree 推不動 main)。
> 佇列項都是預先批准的;設計類產出照舊過 STOP gate。計畫席保證每席佇列 ≥2 項。
>
> **本檔只放活項。** 做完的由計畫席**直接刪除**(歷史在 git log,不在這裡)——
> 劃掉留著的考古層已造成五次過期派單,從 2026-09-04 晚起改為刪除制。
> 讀本檔前先 `git pull`;PR 狀態一律 `gh pr view --json state` 現查,不信文字。

## teacher-pages

0. `/api/class-logs` 查證(低優):有 query 參數但零 service 認領(#304 gate 標的守備外實例)——
   查它是誰在用/該不該有前端面/還是死端點,回報結論即可

1. (窗口後)iOS Safari 實機協助:#282 抽屜不被工具列蓋住 —— 需使用者真機,你備步驟
2. 待命:家長端 v1 探索(admin-pages 主盤)出來後,老師↔家長交集面(出缺席呈現)由你對口

## design-web

1. 儀表板 v1 設計二審已撤(該功能已完成)→ 轉:**家長端 v1 探索的構圖二審**(admin-pages 報告出來後)
2. 待命

## design-web-2

1. 待命(#287 收掉後觸控債線歸零)

## 窗口裁決落地(2026-09-05 11:15,使用者六項全裁)

1. #295 **批准動工**+附帶:activeRole 進 API context=要 / 遮蔽=排名+內部備註 / is_primary=不影響
2. #295 補「孩子帳號」擴充節:使用者提議納入 —— v1 **不做帳號**,但模型天然相容
   (學生帳號=scope 只含自己的 student_id),寫成擴充節供未來
3. 及格線欄位:**准開** —— migration+API+UI 一條線動工,migration PR 照保留類**由使用者合**
4. 科目平均:**改「幾分之幾」** —— 不做百分比化;平均列顯示 總得分/總滿分(如 130/150),
   API 回 sum 與 totalSum,消滅無意義平均的同時保留原始分數感

## admin-pages

1. **家長端 v1 探索**(主刀):家長 shell 各頁實況盤點(不假設空殼)、三件事(出缺席/
   學習進度/繳費)的資料面、v1 薄切範圍提案 —— 只探索與提案,不設計不動工
2.5 並排斷言小刀:未點名卡兩段(API側/前端側)對「停課」的分類一致性寫成一條測試
   (#310 的釘子;「同語意雙路徑就放並排斷言」的第一個實例)
3. (窗口項)及格線成為考試欄位 —— 需 migration,保留類等使用者

## billing-api

1.5 `/api/session-packs` 查證(低優):同 class-logs,#304 標的另一個未認領端點
2. **#295 已定案,API 側主刀**:middleware 注入 studentScope+`childDb` 入口(乙案)+activeRole 進 context+GET /api/me/children(02 片的 API 半)。⚠️ 開工前先做 session 輪替(context 99%):蒸餾+落檔+重啟
3. 500 案回查:**09-07 後**,計畫席持 CF 憑證查 log、你分析(條件:POST /api/courses、
   body 含 SERVER_ERROR、不用 --status error)

## infra

1. **gate 載體盲區掃描**:c6 剛證明「規則對、載體錯」(掃 SCSS 漏 TS 字串)——
   對現有 12 道 gate 逐一問「這條規則的違規還能活在哪些載體?」(模板/TS/JSON/註解…),
   產出盲區清單與建議,先報告後動工
2. 磁碟 watch 照掛(PID 現查,勿信舊值);dagger GC 根因在鄰專案,watch 兜底

## review-steward

(無活項 —— 工具/流程改動先落這裡再做)

## 使用者窗口積壓

- 及格線欄位 migration / 科目平均百分比化(語意變更)/ 640px 視覺 / iOS 抽屜確認(#282)
- 誰先 db:reset 誰驗 seed 雙身分帳號
