---
title: 通知中心（老師）
summary: 查看課務異動通知。
category: spec
status: active
updated: 2026-09-04
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

**「全部標為已讀」打 `POST /api/announcements/read-all`**（API #219、前端接上）。

一次呼叫，而且**原子** —— 要嘛全標要嘛都沒標。可見範圍由後端算，跟收件匣同源
（`campusOrFilter` + `audienceFor`），所以前端不對帳 `marked`：兩邊各算一次才是會漂的做法。

樂觀更新照舊，但**失敗時翻回的是整批**，不是失敗的那幾則 —— 原子端點沒有「部分失敗」。
在此之前是對未讀逐一呼叫 `POST /{id}/read`（N 次往返、非原子，中途失敗會留下一半已讀，
而使用者看到的是「按了但紅點還在」）。

## 資料依賴

| 操作 | 資料表                          |
| ---- | ------------------------------- |
| 讀取 | `announcements`                 |
| 寫入 | `announcements`（更新已讀狀態） |

## PRD 參考

- 4.15 通知
- 7.3 老師頁面
