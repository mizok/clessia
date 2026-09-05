# 常備工作佇列(零 idle 制)

> 計畫席維護。各席**交付即繼續**:送出交付訊息後直接認領自己佇列的下一項開工
> (認領=SendMessage 向計畫席宣告,由計畫席落標記 —— worktree 推不動 main)。
> 佇列項都是預先批准的;設計類產出照舊過 STOP gate。計畫席保證每席佇列 ≥2 項。
>
> **本檔只放活項。** 做完的由計畫席**直接刪除**(歷史在 git log,不在這裡)——
> 劃掉留著的考古層已造成五次過期派單,從 2026-09-04 晚起改為刪除制。
> 讀本檔前先 `git pull`;PR 狀態一律 `gh pr view --json state` 現查,不信文字。

## teacher-pages

0. **教務日誌前端主刀(P3 大刀)**:feature-slice 全流程,設計過計畫席 STOP;
   v1 範圍傾向不含家長簽收(無 API,留 P4)[已派 2026-09-05]
0.1 ~~class-logs 查證~~(#315 結案)原文:`/api/class-logs` 查證(低優):有 query 參數但零 service 認領(#304 gate 標的守備外實例)——
   查它是誰在用/該不該有前端面/還是死端點,回報結論即可

1. (窗口後)iOS Safari 實機協助:#282 抽屜不被工具列蓋住 —— 需使用者真機,你備步驟
2. 待命:家長端 v1 探索(admin-pages 主盤)出來後,老師↔家長交集面(出缺席呈現)由你對口

## design-web

1. 儀表板 v1 設計二審已撤(該功能已完成)→ 轉:**家長端 v1 探索的構圖二審**(admin-pages 報告出來後)
2. 待命

## design-web-2

0. **chunk 載入失敗自動復原**(reset 後首刀):部署後舊 index 要新 chunk 404 → lazy route
   靜默空白,使用者以為功能壞了(2026-09-05 使用者實際撞到,設定頁全空)。
   解法方向:全域 ErrorHandler 抓 ChunkLoadError/dynamic import 失敗 → 自動 reload 一次
   (帶防迴圈旗標);先探 Angular 21 的慣用法再做

1. **P4 LINE Messaging 外部依賴查證**(bot 拉群/額度/channel 路徑/Workers 出站)
   [已派 2026-09-05],只查不做,產出報告
2. shared/ 8 筆觸控債已清(#293);待命備援

## 窗口裁決落地(2026-09-05 11:15,使用者六項全裁)

1. #295 **批准動工**+附帶:activeRole 進 API context=要 / 遮蔽=排名+內部備註 / is_primary=不影響
2. #295 補「孩子帳號」擴充節:使用者提議納入 —— v1 **不做帳號**,但模型天然相容
   (學生帳號=scope 只含自己的 student_id),寫成擴充節供未來
3. 及格線欄位:**准開** —— migration+API+UI 一條線動工,migration PR 照保留類**由使用者合**
4. 科目平均:**改「幾分之幾」** —— 不做百分比化;平均列顯示 總得分/總滿分(如 130/150),
   API 回 sum 與 totalSum,消滅無意義平均的同時保留原始分數感

## admin-pages

1. #295 補「孩子帳號」擴充節(使用者裁:v1 不做帳號,模型天然相容 —— 學生=scope 只含自己;
   寫成擴充節)
1. 及格線 UI 接線半(**#331 已合,解鎖**:passScore 從考試表單/回應接進 #319 接口,academy 限定)
2. 家長端 02 片前端(**#326 已合,解鎖**:GET /api/me/children + 「我的孩子」頁;
   02 是授權第一實例,後面照它抄)
3. **堂數包前端面**(使用者裁 a):行政買包/剩餘堂數顯示/追補買訊號 ——
   spec 依據 kb/wiki/rules/billing-rules.md 規則 1、8;API 三支已在(#49);先探索提範圍再動工
3. 科目平均改「幾分之幾」:API 回 sum/totalSum,平均列顯示 130/150 形式(棄百分比化);
   API 半可請 billing-api 新 session 協作
4. (裁決紀錄)並排斷言小刀=#314 已交付

## billing-api

1.5 `/api/session-packs` 查證(低優):同 class-logs,#304 標的另一個未認領端點
2. ~~#295 API 側~~(#326 綠,保留類等使用者合)→ 現任務:及格線 migration(**只做 academy_exams**,PR 標保留類由使用者合)+科目平均 sum/totalSum
3. 500 案回查:**09-07 後**,計畫席持 CF 憑證查 log、你分析(條件:POST /api/courses、
   body 含 SERVER_ERROR、不用 --status error)

## infra

1. **gate 載體盲區掃描**:c6 剛證明「規則對、載體錯」(掃 SCSS 漏 TS 字串)——
   對現有 12 道 gate 逐一問「這條規則的違規還能活在哪些載體?」(模板/TS/JSON/註解…),
   產出盲區清單與建議,先報告後動工
2. 磁碟 watch 照掛(PID 現查,勿信舊值);dagger GC 根因在鄰專案,watch 兜底

## review-steward

(無活項 —— 工具/流程改動先落這裡再做)

## 學生帳號線(使用者 2026-09-05 確認要做,排家長端 03 片之後)

- 架構已備:#316 擴充節(學生=scope 只含自己,同一套 childDb/studentScope)
- 到設計階段的產品決定:登入方式(LINE?子登入?)/可見範圍(繳費給不給?)/
  user_roles 加 student 第四角色(select-role 天然支援)
- 流程照舊:探索→設計文件→使用者批准→動工;頁面重用家長端(同頁換 scope 的薄層)

## Tester(desktop-44) —— 已啟動 2026-09-05 17:20

三件裁決結論(計畫席 clessia-c8 裁,已發啟動令 msg 141901df):
①**session**:沿用使用者現有 admin session 唯讀(零設定;Chrome 殘留 session 直進後台
是瀏覽器行為非漏洞) ②**寫入**:零寫入維持,碰到「必須送出才評得到」的地方列成
「待授權才能評」清單,累積後一次向使用者換授權 ③**範圍**:僅管理端(老師/家長 fixture
過早,家長端 API #351 未合)

- 產出:問題清單(哪一頁/怎麼重現/看到什麼/為什麼是問題),嚴重度自標,計畫席排序
- 已交線索:儀表板「載入中」粗體佔數字位 4-5 秒像狀態值(單點已排設計席改骨架條)——
  要 tester 找的是**同一模式還在哪些頁**,不是複驗這一點
- 產品觀察(待使用者決):系統沒有「把家長角色加到現有帳號」的 UI 路徑

## 使用者窗口積壓

- **#351 待使用者親合**(家長端授權 scope 第一實例=保留類「授權/權限邏輯」;CI 綠、
  計畫席本人驗收留言已補)
- 及格線欄位 migration / 640px 視覺 / iOS 抽屜確認(#282,已向 teacher-pages 索步驟
  msg 3a94d501)
- 誰先 db:reset 誰驗 seed 雙身分帳號
- 心跳機制 A雲端cron/B手機捷徑/C手動 未選(機器睡眠本機無解)
- 堂數制主動提醒

## 計畫席交接(2026-09-05 clessia-c8 輪替)

### 計畫席退化事件(進 herdr playbook)
context 過長導致工具輸出不可信:bash 退出碼/URL、gh pr comment 回傳、SendMessage msg_id
都會污染,且會「以為送出了」。#350/#351 驗收留言查無=此故障證據(兩不同 PR 回傳共用
同一 comment id)。教訓:**計畫席也要輪替,不能無限跑**;症狀是工具輸出自我矛盾。
**新任第一件事**:查一支 PR comment 確認 API 回傳合理不自我矛盾,再開始裁決。

### 交接第一刀 —— 已完成(2026-09-05 17:1x)
#351-#355 五則計畫席本人驗收留言已補齊並回驗落地(印整個 comments 陣列,非 grep)。
#351 非蓋章:對 diff 重驗三要點(isChildAllowed 回 403 非空清單 / childDb `.in(scope)`
第二層 / recordedBy·recordedByRole 有 not.toHaveProperty 正面斷言)。

**新任自己犯的驗證器錯誤,留給下一任**:這五支的 `sync-feature-map` conclusion 是
**SKIPPED**;用「非 SUCCESS 即紅燈」過濾會得到「五支全紅」的假結論。過濾要放行
SKIPPED/NEUTRAL。又一次「驗證失敗時先懷疑驗證器」。

### 在飛線
家長端 #351 合後 admin-pages 接 03 片前端(複用 #344 child-switcher);教務日誌 v1b 等
teacher-pages(同 childDb 線);chunk 復原/及格線/堂數包已上線。
#352/#353/#354/#355 待窗口回覆後授權 steward 合(docs+CI,不碰保留類)。

### 使用者準則(MEMORY 有)
問題找解方不用工程理由結案;架構/換供應商級先討論不排單;UX至高原則;只用繁中。
