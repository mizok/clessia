---
title: 通知中心（老師）
summary: 查看課務異動通知。
category: spec
status: active
updated: 2026-09-03
tags: [specs, teacher, notifications]
---

# 通知中心（老師）

**路徑**: `/teacher/notifications`
**角色**: Teacher

## 核心目的

查看課務異動通知。

## MVP 功能

- 通知列表（時間軸，最新在上）
- 已讀/未讀狀態（未讀有圓點標記）
- 點擊展開完整內容
- 全部標為已讀按鈕
- 通知保留 90 天

### ~~通知類型圖示（調課/代課/停課）~~ —— 2026-09-03 移除

**收件匣只承載公告，沒有課務異動事件，所以沒有類型可以畫。**

`announcements` 的欄位是 id / org_id / campus_id / audience / title / body /
published_at / created_by / created_at / updated_at —— **沒有任何型別欄位**。
而「調課／代課／停課」實際上住在 `schedule_changes.change_type`，那是另一張表，
`GET /api/announcements/inbox` 根本沒讀它。

原版這一條假設了收件匣會承載課務異動，但實作上不是。**這不是漏做，是規格與資料模型對不上。**
與其給每則公告一顆一模一樣的鈴鐺圖示（把「沒有分類」偽裝成「有分類」），
不如讓 spec 停止說謊。

真需求沒有丟：**課務異動的推播歸 P4 的通知整合線**（LINE 那條）一起設計 ——
到時候要決定的是「異動要不要進收件匣」還是「走另一條推播管道」，那是設計問題不是補一個圖示。

## 實作註記

**「全部標為已讀」目前是前端對未讀逐一呼叫 `POST /{id}/read`** ——
後端沒有批次端點。語意跟批次一致（同樣的紀錄、同樣的結果），
差別是 N 次往返且非原子（失敗的那幾則各自翻回未讀）。
`POST /api/announcements/read-all` 已進 billing-api 的 backlog，
落地後前端換成一次呼叫即可，樂觀更新的部分不用動。

## 資料依賴

| 操作 | 資料表                          |
| ---- | ------------------------------- |
| 讀取 | `announcements`                 |
| 寫入 | `announcements`（更新已讀狀態） |

## PRD 參考

- 4.15 通知
- 7.3 老師頁面
