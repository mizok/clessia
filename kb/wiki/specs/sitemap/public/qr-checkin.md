---
title: QR 到班打卡（/qr-checkin）
summary: /qr-checkin 已移除（#1127）：轉 /login，公開外框的連結拿掉；打卡改在登入後的 /kiosk/checkin 與 /admin/checkin。
category: spec
status: developing
tags: [sitemap, public]
created: 2026-09-12
updated: 2026-10-03
---

# QR 到班打卡（已移除）

`/qr-checkin` 在 #1127 移除：使用者裁定掃碼機不該放在任何人都進得來的公開入口。

- 網址轉 `/login`（舊書籤不會 404）
- 公開外框不再列「QR 到班打卡」
- 打卡改在登入後：門口機台 `/kiosk/checkin`（kiosk 帳號）、行政 `/admin/checkin`

見 [[specs/public/qr-checkin]]、[[architecture/kiosk-checkin]]。
