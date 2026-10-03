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

## API 契約（已實作）

- **建機台帳號**：`POST /api/staff`，body `{ displayName, campusIds: [一個], roles: ['kiosk'] }`。
  不收 email（系統給 `kiosk-<uuid>@<PLACEHOLDER_EMAIL_DOMAIN>`）、不收 permissions／subjectIds，
  違反回 400 `INVALID_KIOSK`。門檻是 `manage_staff`（mount）：kiosk 發不出任何權限，**不走 `manage_roles`**。
  回應照舊帶 `loginUrl`（一次性登入連結）。
- **改機台**：`PUT /api/staff/:id` 只能改名稱、狀態、換成另一個分校；改角色／權限／科目、綁兩校回 400 `INVALID_KIOSK`。
  停用走既有的 deactivate。
- **重鑄登入 QR**：`POST /api/login-links` 對 kiosk 要 `manage_staff`，分校範圍＝它綁的分校（`login-links/permission.ts`、`scope.ts`）。
- **人員列表**：kiosk 列的 `roles` 是 `['kiosk']`，可用 `?role=kiosk` 篩。
- **打卡確認資訊**：`POST /api/daily-checkins` 回應多 `student: { name }` 與
  `todaySessions: [{ sessionId, className, startTime, endTime }]` —— 當天有在籍、沒停課的課堂，依開始時間排序，
  分校條件與寫出勤同一組。讀 `sessions` 不讀 `events`（events 是讀取時才補建的）。兩種出勤模式都回。
  另帶 `alreadyCheckedIn`（重掃，`checkedInAt` 是第一次那筆）、`attendanceMode`；每堂帶 `onLeave`
  （`leaveCoversSession`，跟點名名單同一個判準）與 `attendance`（**寫完之後讀回的實際紀錄**，沒有就是 null）。
  畫面照實際紀錄講「已記出席／請假／等老師點名」，不猜這次寫了什麼。

## 相機掃描（已實作，#1127 A）

使用者裁：**門口平板不限類型**。`shared/components/checkin-station/qr-camera.ts`：

- **解碼器**：`BarcodeDetector` 存在**且** `getSupportedFormats()` 含 `qr_code` → 原生（Android／ChromeOS）；
  否則 `await import('jsqr')`（iPad Safari）—— 獨立 lazy chunk（約 27 kB 傳輸），只有後備裝置下載。
  只看類別在不在會選錯：有些 Chromium 有類別、格式清單是空的。
- **為什麼是 `jsqr`**：既有的 `angularx-qrcode`／`qrcode` 只產生不解碼；`jsqr` 零依賴、純 JS、不碰網路（離線可解）。
  `barcode-detector` polyfill 要 3.8 MB 的 zxing-wasm，且 wasm 預設從 CDN 抓（離線與自架 c12 都有問題）。比較表在 #1127 留言。
- **迴圈**：每 250ms 解一格（不是每個 frame —— 平板整天開著）；掃到走既有的 `submit`（跟掃碼槍、手打同一條路）；
  結果畫面期間不解；回到掃描後 8 秒內同一張卡不重送；`visibilitychange` 隱藏時關鏡頭、回來再開。
- **狀態**：掃描中／鏡頭被拒（`NotAllowedError`，步驟說明＋重新要求權限）／沒有相機（`NotFoundError`、非 HTTPS 沒有 `mediaDevices`）。
  離線沿用打卡失敗的 `offline` 結果。卡號欄一直都在（掃碼槍、沒相機的退路）。
- **開不開**：機台 `<app-checkin-station camera="auto">` 一進頁就開；管理端預設 `manual`，給「開啟相機」鈕（計畫席裁：桌機一進頁就跳權限詢問很擾人）。
- **測試的坑**：Angular 的 unit-test builder 會把本地模組打包進 spec，`vi.mock('./qr-camera')` **換不到**（實測拿到的是真的解碼器）；
  解碼器因此走 DI token `QR_DECODER_FACTORY`。外部套件（`jsqr`）的 `vi.mock` 換得到。
- **iPad Safari 真機**要人工驗（jsdom 沒有鏡頭）；`qr-roundtrip.spec.ts` 守的是「`qrcode` 產生 → `jsqr` 讀回」格式對得上。

## 到班卡（已實作，#1127 B）

`features/admin/pages/students/checkin-cards.ts`：

- **卡上只有**補習班名、學生名、QR（內容＝學生 id）—— 卡會被帶來帶去，不放電話、生日。沒有「短碼」：卡號欄只吃學生 id，
  短碼沒有消費端（沒帶卡走「找櫃台登記」）。
- 信用卡尺寸 85.6×54mm、A4 直式 2×5＝一頁 10 張、虛線裁切；QR 用 `qrcode.toDataURL`（M 級容錯）產生 `<img>` ——
  canvas 的內容不會跟著 `importNode` 搬過去。
- 入口：學生列表的列選單「列印到班卡」（一位）＋頁首「列印本頁到班卡」（畫面上這一頁）。**不做勾選**：
  開學一次發一個年級的做法是篩年級、拉大每頁筆數再印。門檻 `manage_students`。
- 印法照收費單：**開乾淨的新視窗印**、名字只進 `textContent`；**視窗在點擊同一個 tick 開**（QR 非同步產生，等完再開會被擋彈出視窗），
  所以補習班名在頁面 `ngOnInit` 預載。
- `qrcode` 沒附型別：`apps/web/src/qrcode.d.ts` 只宣告用到的 `create`／`toDataURL`。

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
