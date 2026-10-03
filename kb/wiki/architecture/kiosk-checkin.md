---
title: 到班掃碼機台：登入後的掃碼頁＋機台身分（kiosk 角色）
summary: 使用者裁 #1127：掃碼頁搬到登入後、不做免登入端點。機台身分用新角色 kiosk（user_roles 列舉加值），不用「零權限 admin」—— ADMIN_ONLY 的掛載多半只擋寫，零權限 admin 讀得到學生／家長名冊，機台放在門口等於公開名冊。kiosk 綁單一分校（staff_campuses），只掛得進 POST /api/daily-checkins 與掃碼頁要的那幾支窄讀；分校強制取帳號的、不吃 body。帳號由有 manage_staff 的管理員在人員頁建立，用既有的一次性登入連結 QR 在平板上登入。行政人員也可從管理端開同一頁。公開入口拿掉、/qr-checkin 轉登入。
category: architecture
status: draft
updated: 2026-10-03
tags: [architecture, attendance, authorization, kiosk, migration]
---

# 到班掃碼機台（#1127）

> 使用者裁（10-03 15:4x）：掃碼機不該放在任何人都進得來的公開入口頁；掃碼端點與頁面改成需要登入
> （分校的機台帳號，或行政人員登入後開啟的到班打卡頁），**不做免登入端點**。公開頁的入口拿掉或導向登入。

## 現況（查過的）

- `/qr-checkin` 是 11 行的空殼（`features/public/pages/qr-checkin`，畫面只有「開發中」）。**掃描器本身從來沒有做過。**
- `POST /api/daily-checkins` 掛在 `ADMIN_ONLY`＋`write: 'basic_operations'`（`index.ts`），body 吃 `studentId`／`campusId?`／`checkinDate`。
- 學生**沒有任何 QR 卡**：全 repo 的 QR 只有登入連結（`login-link-dialog`）。規格沒說 QR 裡裝什麼。
- 登入只有 LINE OAuth＋一次性登入連結（`login-links/mint.ts`，管理端畫 QR）；沒有密碼。
- 角色列舉 `user_role` = admin / teacher / parent（`20260208165500_refactor_roles.sql`）。

## 決策（待批准）

### 1. 機台身分＝新角色 `kiosk`，不是「沒有權限的 admin」 ⚖️ 要裁

`index.ts` 的掛載大多是 `ADMIN_ONLY, { write: '…' }` —— **只擋寫、不擋讀**（`/api/students`、`/api/parents`、
`/api/enrollments`、`/api/staff` 都是）。一個零權限的 admin 帳號讀得到全機構的學生與家長名冊；
機台是放在門口、誰都摸得到的平板，等於把名冊公開。

新角色是 **fail-closed**：現有每一支掛載的角色清單都不含 `kiosk`，所以它什麼都讀不到，
要開的才一支一支加。

- migration：`ALTER TYPE public.user_role ADD VALUE 'kiosk'`（保留類）。
- 機台帳號**綁一個分校**：沿用 `staff_campuses`（`campusScope` 已經從它來）。建帳號時必選一個分校。

### 2. 授權範圍

| 端點                                 | kiosk   | 說明                                                                                         |
| ------------------------------------ | ------- | -------------------------------------------------------------------------------------------- |
| `POST /api/daily-checkins`           | ✅      | `campusId` **強制取帳號的分校**，body 給別的回 403；`checkinDate` 強制台北今天（機台不補登） |
| 掃碼後的確認畫面（學生名、今日課堂） | ✅ 窄讀 | **只回剛打卡的那一位**的名字與當天課堂，放在 POST 的回應裡，不另開讀端點                     |
| 其他一切                             | ❌      | 角色清單不含 kiosk                                                                           |

行政人員走同一支 POST（現行 `basic_operations` 不變）。

### 3. 帳號怎麼開

人員管理頁（要 `manage_staff`）加「新增掃碼機台」：名稱＋分校 →
`admin.createUser`（佔位 email，同家長的 `@phone.internal` 作法）＋ `user_roles(kiosk)` ＋ `staff_campuses` →
直接畫一次性登入連結的 QR（複用 `login-link-dialog`）。平板掃 QR 就登入。
停用＝把帳號 status 改掉（既有的停用路徑），session 跟著失效。

### 4. 前端

- 新 feature `features/kiosk/`：`/kiosk/checkin`，`roleGuard(['kiosk'])`，全螢幕、無選單（kiosk 走 ShellLayout 的極簡模式或不掛殼 ⚖️ 實作時看殼的條件）。
- 管理端 `/admin/checkin` 開同一個頁面元件 → 元件要放 `shared/`（c5：feature 不互相 import）。
- `/qr-checkin` 公開路由刪掉，改成導向 `/login`；公開入口頁的連結拿掉。

### 5. 掃描器與學生 QR 卡 ⚖️ 要裁（範圍）

這兩件**從來沒有**，而且比上面的授權工作大：

- 學生 QR 裝什麼：我的傾向是**學生 id 本身**（UUID v4，不可猜；被拍照冒打卡的代價是出勤錯一天，人工可改）。
  要更嚴就要加可撤銷的卡片 token（多一張表、補發流程）。
- 卡誰發：管理端學生頁「列印到班卡」。
- 掃描器：相機權限、解碼（要選套件，先查已安裝依賴）、離線錯誤。

**建議切法**：本單（保留類）只做 1–4 ＋ 手動輸入學號的退路（機台上先能用）；
「學生 QR 卡＋相機掃描器」另開一單（非保留類）。

## 拒絕的替代方案

- **零權限 admin 當機台**：見 1，讀端點 fail-open。
- **permission 而非 role**（`kiosk_checkin` 掛在 admin 上）：同上，admin 角色本身就打開了所有讀。
- **免登入端點＋裝置憑證**：使用者已撤回。
- **機台用某位行政的帳號長期登入**：離職、權限變動都會牽動機台；稽核也分不出是人還是機台。

## 影響

- `supabase/migrations/<新>_kiosk_role.sql`
- `apps/api/src/index.ts`（daily-checkins 掛載加 kiosk）、`routes/daily-checkins.ts`（kiosk 強制分校與日期、回應帶確認資料）、
  `routes/staff.ts`（建機台帳號）、`middleware/auth.ts`（角色型別）
- `apps/web`：`features/kiosk/`、`shared/` 的掃碼頁元件、`app.routes.ts`、`routes-catalog.ts`、`AuthService` 角色、
  人員頁、公開入口頁
- `kb/wiki/specs/public/qr-checkin.md`（搬家、改角色）、`AGENTS.md` 角色表（加 kiosk）
