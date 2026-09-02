---
title: Herdr 多席調度
summary: 計畫席用 herdr + SendMessage 調度 domain 席的實戰手法 —— 開席序列、送達驗證、席名對位、廣度掃描的分派形狀、以及最貴的帳面漂移問題。
category: lessons
tags: [lessons, herdr, orchestration, agent-team]
status: active
updated: 2026-09-02
---

# Herdr 多席調度

> 操作性的細節(開席指令、席位表)在 [`.claude/team/README.md`](../../../.claude/team/README.md);
> 這頁收的是**可遷移的調度手法與踩過的坑** —— 2026-09-02 已整套傳授給 fvg 專案的指揮台。

## 分工:herdr 管生命週期,SendMessage 管內容

- **herdr**:開席(`worktree open` 成子 space → `agent start`)、救援(`agent read` 看卡在哪、
  `agent send-keys` 處理權限彈窗)、狀態(`agent get`)。
- **SendMessage**(Claude 內建跨 session):派工、回報、裁決 —— 所有雙向內容都走這條。
- 兩者不要混:用 herdr 的 `agent prompt` 派複雜工單只適合席位剛起、還沒有對話位址時。

## 四個要付過學費才知道的坑

1. **`agent prompt --wait` 逾時不代表沒送到,回傳成功也不代表送到了。**
   一律跟一發 `herdr agent get <席名>` 確認 status 轉 `working`。曾有 pipeline
   無條件印 ✅ 而 prompt 根本沒進去(夜班事故),也曾有設定彈窗把 prompt 吃掉。
2. **席名 ≠ session 名。** session 輪替(重開機、斷線)後 SendMessage 位址會變
   (`billing-api` 席可能叫 `pin-better-auth-3c`),每次派工前 `ListAgents` 對名,
   位址絕不寫死在任何文件 —— 為這個誤投過三次。
3. **帳面漂移是最貴的坑。** 各席對「哪支 PR 合了沒」的認知永遠過期(squash 後
   SHA 全變、MERGED 不等於進 main)。計畫席必須當唯一真相源:驗收用**內容 grep**,
   不用 commit 清單、不信 PR 狀態標籤;各席回報的狀態節照單校正。
4. **共享資源(Docker、本機 DB、port)開是加法、關要經計畫席** —— 一席收環境
   曾殺掉另一席進行中的驗證。同時跑重 build 的席 ≤2(磁碟與 CPU 是同一台)。

## 廣度掃描類任務的分派形狀

「掃全站找 X」不要按目錄切,**按 domain 擁有權切** —— 判斷「這處該不該改」需要
領域知識。序列:計畫席(或唯讀導航員)先跑便宜的收斂 → 命中的分派給該 domain 的席。
工單裡必附:

- **統一評審框架**(每處回答同一組問題)—— 不然多份結果合不起來
- 要求回報含 **path:line 證據**與「**查過但不是問題**」清單 —— 省 reviewer 重查,
  並逼真的開檔驗證(有人 grep 到 `subscribe` 就推論成非同步載入,錯)

## 席位的形狀

長壽 domain 席(配 charter,「session 會死,席位不死」)優於 per-task 蜂群 ——
廣度任務給既有席加工單,比開新席便宜,而且知識會沉澱回 charter。
合併授權、疊 PR 鐵律、通用協定見 README;本頁不複述(c11)。
