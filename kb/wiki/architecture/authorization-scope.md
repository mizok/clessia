---
title: 授權範圍 —— 分校、職務、細部權限
summary: 三個軸的範圍限制在建立帳號時都有收，執行時多數沒有用。這一頁記下五個可驗證的洞、補完的設計、以及 fail-closed 上線最真實的風險（既有管理員會看到空白而不是報錯）。
category: architecture
status: active
updated: 2026-09-02
tags: [architecture, authorization, campus, teacher-scope, permissions, security]
---

# 授權範圍 —— 分校、職務、細部權限

> 使用者 2026-09-02：「假如某用戶的服務範圍只有 a 分校，那他理論上就不該有權限
> 可以看到跟 b 分校有關的資料，老師的帳號也應該要有職務隔離措施，不能看到跟自己
> 有開課的課堂無關的資訊」、「目前的管理者帳號建立的時候其實有權限隔離的限制，
> 但這部分其實仍然是雛形，我希望你趁這個機會做完這部分」。
>
> **狀態（2026-09-03）**：洞 1、2、3、4 已修，洞 5 的地基已完成、預設過濾還有
> 14 支路由待接（harness 每次會列出來）。下面標「已實作」的段落是現況，
> 其餘是尚未落地的設計。

## 現況一句話：**建立帳號時全都收了，執行時多數沒有用**

| 軸                                               | 建立時                                | 執行時                                                           |
| ------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------- |
| **分校**（`staff_campuses`）                     | ✅ 建員工時寫入（`staff.ts:963-968`） | ❌ **完全沒有** —— `authMiddleware` 不讀它，沒有任何路由用它過濾 |
| **細部權限**（`user_roles.permissions`，7 個值） | ✅ 建員工時寫入（`staff.ts:445-451`） | ⚠️ **7 個只有 2 個有效力**                                       |
| **老師職務**（只碰自己任課的班）                 | —                                     | ⚠️ **讀有、寫沒有**                                              |

`staff_campuses` 目前只被三個地方讀，而且都是**業務規則不是資料隔離**：
公告對象（`announcements.ts:159`）、員工的分校指派 CRUD（`staff.ts`）、
代課老師是不是這個分校的（`sessions.ts:1253,1740`）。
**沒有任何一支查詢會因為「你不屬於這個分校」而少回一列。**

## 五個洞（每一個都查證過，不是推測）

### 洞 1 — 老師可以改組織設定，包括他自己的點名時窗

`mount('/api/org', orgSettingsRoute, ['admin', 'teacher'])`（`index.ts:267`），
而 `PATCH /api/org/settings` 的 handler **沒有任何角色檢查**
（`org-settings.ts:88-125`）。

老師改得動：`attendance_mode`、`attendance_responsible`、
**`attendance_retroactive_days`（他自己的補登時窗）**、`invoice_due_days`、
`meal_default_price`、`proration_basis`。

> 最後三個是金流參數。`/api/invoices` 之類的路由要 `manage_finance` 才進得去，
> 但**餐費單價與比例分攤基準可以從一支不需要任何權限的端點改掉**。

**這是五個洞裡最該先補的。**

#### 修法有兩層，第二層是使用者指出來的

1. `writeRequiresAdmin('manage_org_settings')` —— 寫入只有管理員、且要有這個權限
2. **財務欄位另外要 `manage_finance`，讀寫都收** —— 「餐費只能給有權限的管理者去
   存取」（使用者，2026-09-03）。只擋寫不夠：`invoiceDueDays` /
   `mealDefaultPrice` / `prorationBasis` 原本會**回給每一個老師**

第二層還有一個查證出來的理由：那三個欄位在這支端點是**零消費者**。沒有任何畫面
讀或編輯它們，而真正需要的 `meals.ts` / `invoices.ts` / `billing-runs.ts` /
`lib/proration.ts` 是**直接讀 `organizations` 那張表**。發給老師換不到任何東西。

**沒有權限時，回應裡是 key 不存在，不是 0** —— 「餐費單價是 0」跟「你不該知道餐費
單價」是兩件不同的事，回 0 會讓讀到的人以為機構真的沒設定。前端型別跟著改成
optional。

> 這一層也修正了我原本的分類：**餐費不是「組織設定」，是財務。**
> 同一份 `manage_finance` 守著 `/api/invoices`，卻在組織設定這支被繞過去。
> 判斷用 `!== undefined` 而不是 falsy —— 把單價設成 0 也算動到財務。

### 洞 2 — 五個權限只存在於前端

| 權限               | 前端用到 | API 強制         |
| ------------------ | -------- | ---------------- |
| `manage_finance`   | ✅       | ✅（6 個 mount） |
| `view_reports`     | ✅       | ✅（1 個 mount） |
| `basic_operations` | ✅       | ❌               |
| `manage_courses`   | ✅       | ❌               |
| `manage_students`  | ✅       | ❌               |
| `manage_staff`     | ✅       | ❌               |
| `manage_roles`     | ✅       | ❌               |

`middleware/auth.ts` 的 `requirePermission` 註解自己寫著：「在金流之前 API 完全
沒有這一層 …… 那是畫面控制不是授權：直接打 API 就繞過去了」。**金流補了，其餘沒有。**

### 洞 3 — 任何管理員都能建帳號、改角色、改權限

`staff.ts` 的建立／更新／封存三支都用 `checkUserIsAdmin(supabase, requesterUserId)`
（`:843`、`:1092`、`:1336`），**不看 `manage_staff` 也不看 `manage_roles`**。

含意：一個只該做日常操作的管理員，直接打 `POST /api/staff` 就能給自己開一個
權限全開的帳號。**沒有自我提權的防線** —— `requesterUserId` 只用來判斷 isAdmin，
沒有比對「被改的人是不是自己」。

### 洞 4 — 老師的範圍限制只擋讀，不擋寫

`lib/teacher-scope.ts` 的 `loadTeachingScope` 與 `routes/attendance/teacher-scope.ts`
的 `resolveTeacherScope` 已經在六支路由生效：students、scores、academy-exams、
school-exams、contact-book、class-logs，以及 `/api/attendance/sessions` 的**清單**
（`attendance.ts:906`）。

但 attendance 的**寫入端點**（記錄單筆 `:518`、批次 `:642`、更新 `:766`）
只呼叫 `assertAttendanceWindow` 檢查**時窗**，**沒有檢查這個 event 是不是他的班**。
`attendance.ts` 裡 `resolveTeacherScope` 只出現在清單那一處。

含意：老師點名清單上看不到別班，但**知道 `eventId` 就改得動別班的出勤**。
清單已經回傳 `eventId`，換一個值即可。

### 洞 5 — 分校完全沒有隔離

見上表。分校主任看得到、也改得動別校的收入、名單、出勤。

## 現況（2026-09-03）

| 洞                   | 狀態         | 落地的東西                                                                                                 |
| -------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| 1 老師改得動組織設定 | **已修**     | `writeRequiresAdmin('manage_org_settings')`；財務欄位另外要 `manage_finance`，讀寫都收                     |
| 2 五個權限只擋前端   | **已修**     | `mount()` 的 `{ all } / { write }`，harness A7b 防退化                                                     |
| 3 提權與自我提權     | **已修**     | `lib/role-assignment.ts`，接在 staff 的建立與更新                                                          |
| 4 老師只擋讀不擋寫   | **已修**     | `lib/attendance-write-scope.ts`，接在三支寫入端點                                                          |
| 5 分校零隔離         | **地基完成** | `campusScope` 掛 middleware、`all_campuses` 權限、migration、全域 `campusRequestGuard`（指名別的分校 403） |

**洞 5 已完成**：14 支路由全部接上「不指定分校時只回自己的分校」，
harness 的 A7c **從提醒升級成擋** —— 覆蓋率一旦完整，下一個洞就不會是「還沒做完」
而是「新路由忘了接」，而那種洞是靜默的（查詢正常回應，只是回了不該看的資料）。

接線時順帶修掉／發現的三件：

1. **`leaves.ts` 收 `campusId` 但從來沒用它過濾** —— 連解構都沒有。前端傳了沒有效果，
   也沒有任何錯誤，是靜默無效的參數
2. **`daily-checkins.ts` 的分校在 body 裡**，全域的 `campusRequestGuard` 讀不到
   （它只看 query string）。少了那一段，只管 A 校的人可以替 B 校的學生打卡
3. **`ensureAttendanceSessionEvents` 會寫入**（補建出勤事件），所以範圍不能只靠讀取端
   過濾 —— 少了它，A 校的管理員查詢時會替 B 校的課堂建立 event

**`reports.ts` 的判準與其他不同**：篩選是「沾到就算」（跨班帳單沾到這個分校就進來），
**範圍是「沾到就不能看」** —— 一張帳單只要有任何一筆明細在範圍外，受限的管理員就
看不到它。否則跨校帳單會變成看見別校金額的側管道。

### 實作時修正的設計：權限只擋寫，不擋讀

原本的對照表把權限掛在整支路由前綴上（讀寫都擋）。實作時查到
`ClassesService` 被出勤頁與成績頁讀、`CoursesService` 被報表與課表讀、
`CampusesService` 被報名、異動、通知、人員頁讀 —— **整包擋掉的話，一個只有
`basic_operations` 的管理員連出勤頁都打不開**，於是實務上大家只好把權限全開，
權限系統就失去意義。

所以 `mount()` 有兩種形狀：`{ all }`（讀也要擋，金流與報表維持原狀，不放鬆）
與 `{ write }`（只擋寫，新加的四個權限都是這一種）。

## 設計

### D1 — `requirePermission` 要變成「只約束管理員」

現在 `requirePermission` 對 `permissions` 為空的人一律拒絕（fail-closed，正確）。
但老師的 `permissions` **一律是空陣列**（`normalizeAdminPermissions` 只對 admin 回
非空），所以直接把 `manage_students` 掛到 `/api/students`（mount 是
`['admin','teacher']`）會**把所有老師鎖在門外**。

**採用**：新增 `requireAdminPermission(p)` —— 呼叫者是 admin 才檢查 `p`，
非 admin 交給角色層與範圍限制。名字自帶語意，讀 `mount()` 那一行就知道
「這個權限只約束管理員」。

**拒絕的替代方案**：給老師角色也發權限。那要為每一個既有老師補資料，
而且會讓「權限」同時承載兩種不同的意思（管理員的職責分工 vs 老師的職務範圍），
之後每個判斷都要先問「這是哪一種」。

### D2 — 權限對照表要有單一真相，而且由 gate 守

前端 `routes-catalog.ts` 已經有一份「哪一頁要哪個權限」的對照，API 端則散在
`index.ts` 的 `mount()` 參數。**兩邊不同步的後果就是「畫面看得到、API 打不進去」
或反過來**，而反過來那一種是授權漏洞。

**採用**：把對照表放進 `packages/shared-types`，前後端各自 import，
**再加一條 harness gate**：每一支 `mount()` 的權限必須在對照表裡、
且對照表裡每一條都要有對應的 mount。手抄的對照表必然腐化（c11）。

**初版對照（需要使用者確認 —— 這是職責分工，不是技術問題）**：

| 權限                           | 路由                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `manage_courses`               | `/api/courses`、`/api/subjects`、`/api/classes`、`/api/sessions`、`/api/schools`                |
| `manage_students`              | `/api/students`、`/api/parents`、`/api/enrollments`                                             |
| `manage_staff`                 | `/api/staff`（建立／更新／封存）                                                                |
| `manage_roles`                 | `/api/staff` 裡**設定 roles / permissions 的部分**（比 mount 細，見 D3）                        |
| `basic_operations`             | `/api/attendance`、`/api/leaves`、`/api/daily-checkins`、`/api/contact-book`、`/api/class-logs` |
| `manage_finance`               | 現況不動                                                                                        |
| `view_reports`                 | 現況不動                                                                                        |
| **新增** `manage_org_settings` | `PATCH /api/org/settings`（洞 1）                                                               |

### D3 — `manage_roles` 比 mount 細，而且要擋自我提權

建立一個員工需要 `manage_staff`；**決定他有哪些角色與權限**需要 `manage_roles`。
兩者在同一支端點上，所以檢查在 handler 裡，不在 mount 層：

- body 帶了 `roles` 或 `permissions` → 額外要求 `manage_roles`
- **被改的人是自己 → 一律拒絕改自己的 `roles` / `permissions`**，不論有什麼權限。
  提權的路一定要經過另一個人。

> `*` 通吃仍然存在（bootstrap 建的第一個管理員），它不受 D3 的自我提權限制影響
> —— 它本來就有全部權限，沒有可提的。但**改自己**這條線對它一樣封死，
> 否則「唯一的超級管理員把自己降權」會做出一個沒有人救得回來的機構。

### D4 — 分校範圍掛在 middleware，跟 `org_id` 同層

`org_id` 之所以可信是因為它**沒有例外**（c1）。分校要同一種待遇：

1. `authMiddleware` 多查一次 `staff_campuses`，把 `campusIds: string[] | null` 掛進
   context（與 roles / permissions 同一批平行查詢，不多一次往返）
2. 一支 `scopeToCampuses(query, c)`，各路由接在既有的 `.eq('org_id', orgId)` 之後
3. 請求帶 `campusId` 時驗證它在允許清單裡，**不在就 403，不是默默回空** ——
   默默回空會讓越權嘗試看起來像「那天沒人」

**誰算跨分校**：新增權限 `all_campuses`。**拒絕**「沒有 `staff_campuses` 列 =
看得到全部」—— 那是 fail-open，而 `bootstrap-org.util.ts:58` 明說沒有列的意思是
「還沒指派」。把「還沒指派」讀成「全部看得到」正是授權的洞最常長出來的地方。

### D5 — 老師的寫入要跟讀用同一把尺

attendance 的三支寫入端點加上「這個 `eventId` 的班是不是我教的」。
`event → sessions.class_id → schedules.teacher_id` 這條路徑
`lib/teacher-scope.ts` 已經有，直接用。

**用固定任課（`schedules.teacher_id`）還是含代課（`sessions.teacher_id`）？**
讀的那六支用固定任課（見 `teacher-students-view.md`）。**點名要含代課** ——
代課老師當天就是要點那堂課的名。這是讀與寫**刻意不同**的一處，要寫在程式碼註解裡，
否則下一個人會以為是漏掉。

### D6 — `assertAttendanceWindow` 不動

時窗與範圍是兩件事：時窗管「什麼時候還能改」，範圍管「能改誰的」。
兩個都要過，不互相取代。

## 上線順序 —— 真正的風險在這裡，不在寫法

fail-closed 的授權一旦打開，**沒有資料的人看到的是空白不是報錯**，那是最難診斷的
一種故障。

1. **先補資料**：既有管理員補 `staff_campuses` 列或 `all_campuses` 權限；
   既有的管理員權限清單補齊（多數機構目前可能只有 bootstrap 的 `*`）
2. **再開開關**：D1/D2/D4 的強制
3. **洞 1、洞 3、洞 4 可以先走** —— 它們是**加檢查**不是加範圍，不會讓任何
   本來就該有權限的人失去存取

> 建議把 1 做成一支冪等的 migration 或腳本，而不是手動 UPDATE ——
> 手動的那一種在第二個機構上線時一定會被忘記。

## 不做什麼

- **不動 RLS。** 業務表刻意 fail-closed 沒有 policy、API 走 service role（c1）。
  分校與職務隔離跟 org 隔離一樣是 middleware 的事。
- **不做家長端的範圍限制。** 家長目前只碰得到 `/api/me` 與 `/api/announcements`
  兩支，面積很小；等家長端頁面真的長出來再一起做。
- **不裁決權限對照表的內容。** D2 那張表是初版提案，職責分工是業務決定。
- **不改 `*` 的語意。**

## 驗證

授權的測試要**證明拒絕**，不只證明放行：

1. 老師的 token 打 `PATCH /api/org/settings` → 403（洞 1）
2. 老師 `GET /api/org/settings` → 回應裡**沒有** `mealDefaultPrice` 這個 key；
   有 `manage_org_settings` 但沒有 `manage_finance` 的管理員改餐費單價 → 403
3. 只有 `basic_operations` 的管理員打 `POST /api/staff` → 403（洞 2、3）
4. 有 `manage_staff` 但沒有 `manage_roles` 的管理員：建人員可以，**帶 `permissions`
   就 403**（D3）
5. 任何人改自己的 `roles` / `permissions` → 403（D3）
6. 老師拿別班的 `eventId` 打點名 → 403（洞 4）；拿**自己代課**那堂的 → 200（D5）
7. 只屬於 A 校的管理員查 B 校的 `campusId` → 403；不帶 `campusId` 的清單**只回 A 校**
   （D4）
8. `all_campuses` 的管理員兩校都看得到
9. **前後端對照表不同步 → harness 紅燈**（D2 的 gate，寫完要塞一個錯進去看它會不會紅）
