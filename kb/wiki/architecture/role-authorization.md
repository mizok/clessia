---
title: 角色授權的設計
summary: 18 支 route 只驗身分不看角色。改成掛載時強制宣告可用角色、沒宣告就拒絕，並用 harness gate 守住。分兩層：route 層准入、資料層範圍。
category: architecture
status: active
updated: 2026-08-16
---

# 角色授權的設計

## 現況（已驗證）

```js
app.use('/api/*', authMiddleware); // 只驗 session + 過濾 org_id
```

`authMiddleware` 設定 `userId` / `orgId` / `supabase`，**不看角色**。18 支掛載的 route 裡，
只有 `enrollments.ts` 與 `parents.ts` 用了 `requireAdminMiddleware`。

其餘對任何登入者開放：`students`、`scores`、`academy-exams`、`school-exams`、
`attendance`、`audit-logs`、`classes`、`courses`、`campuses`、`schools`、`subjects`、
`daily-checkins`。

具體症狀已經在唯一接通的老師頁上：

```ts
// apps/web/.../teacher/pages/schedule/schedule.page.ts
// TODO: 待 API 支援 teacherId 篩選後加入
```

`GET /api/attendance/sessions` 至今沒有 `teacherId` 參數 —— **老師打開課表看到的是全補習班的課。**

這不是違憲：c1 已經寫明「必要時再加分校、角色、permissions」。這是 c1 的**實作缺口**。

## 為什麼是現在

今天只有 admin 在用，所以沒有實害。但下一步正是要做老師端與家長端 —— 那等於發帳號給
老師和家長，而每個帳號都讀得到全組織的學生名冊與成績。

**在一個角色在用的時候修，比在三個角色都上線後修便宜一個數量級。** 現在改，破壞面只有
admin 的既有頁面（而 admin 保留全部權限，實際破壞面接近零）。

## 兩層，不要混為一談

| 層       | 問的問題                           | 這次做                 |
| -------- | ---------------------------------- | ---------------------- |
| **准入** | 這個角色**能不能呼叫**這支 route？ | ✅ 全部                |
| **範圍** | 能呼叫的話，**看得到哪幾列**？     | 只做老師端現在會踩到的 |

准入是布林判斷、可以一次做完、可以被 gate 守住。範圍是每支 route 各自的業務邏輯
（老師看自己班的學生、家長看自己小孩的成績），只能隨著頁面一支一支做。

**混在一起做會卡死**：範圍那層要等每個角色的頁面規格確定，而准入這層現在就能關上門。

## 准入：掛載時宣告，沒宣告就拒絕

宣告放在 `index.ts` 的掛載點，不放在各 route 檔內：

```ts
mount('/api/students', studentsRoute, ['admin', 'teacher']);
mount('/api/scores', scoresRoute, ['admin']);
mount('/api/me', meRoute, ANY_ROLE);
```

**為什麼放掛載點**：一個檔案就看得完整張權限表，review 時不必開 18 個檔案拼湊；
而 gate 只要解析這一個檔案就能斷言「每一支掛載都有宣告」。放在各 route 檔內的話，
漏掉一支的成本是 gate 要掃全目錄、而且 review 者看不到全貌。

**fail-closed**：`mount()` 的 roles 參數不是 optional。想全開要明寫 `ANY_ROLE`，
是一個看得見的決定，不是忘記的後果。這跟業務表「RLS 開著但沒有 policy」是同一個立場 ——
**忘記宣告時該拒絕，不是該放行。**

**粒度**：掛載層宣告的是**上限**。單一 endpoint 要更嚴（例如 attendance 的 GET 開給老師、
DELETE 只給 admin）就在該 route 檔內再加一道，收斂但不放寬。

### 這次的權限表

**只開現在真的有頁面在用的**，不照規格預先開：

| Route | admin | teacher | parent | 依據 |
| --- | --- | --- | --- | --- |
| `me` | ✅ | ✅ | ✅ | 每個人都要知道自己是誰 |
| `attendance` | ✅ | ✅ | — | `teacher/schedule` 的課表與點名面板 |
| `org` | ✅ | ✅ | — | 同上，判斷該不該讓老師點名、能不能補點 |
| 其餘 15 支 | ✅ | — | — | 目前沒有任何 teacher/parent 頁面用得到 |

老師端規格提到要看自己班的學生與成績（`kb/specs/teacher/{students,assessments}.md`），
但那兩個頁面現在是 18 行空殼。**做到那一頁時再開那一支**，並在同一個切片裡把範圍限制
一起做完 —— 先開路、之後才補範圍的話，中間那段時間就是個洞。

家長同理：11 個頁面全是空殼，所以只有 `me`。

## 範圍：這次只做老師的課

老師能呼叫 `attendance` 不代表能看全部課堂。這次只補老師端**現在就會踩到**的那一處：

- `GET /api/attendance/sessions` 增加 `teacherId` 篩選
- **角色是 teacher 時強制套用自己的 id**，不接受請求指定別人 —— 否則等於沒擋

其餘的範圍限制（老師只看自己班的學生、成績）留到對應頁面實作時再做，
並在那時寫進這份文件。**不預先寫沒有頁面驗證的規則**，那種規則沒有人會發現它是錯的。

## 角色從哪來

`authMiddleware` 增加一次 `user_roles` 查詢，把角色放進 context。

現在 `requireAdminMiddleware` 每次使用都自己查一次，改成集中查詢後**總查詢數不變或更少**
（同一請求只查一次）。

**不從 session 讀角色**：Better Auth 的 session 是登入當下的快照，管理員撤銷某人的
teacher 角色後，那個人的 session 還在，就還是 teacher。權限要即時，只能查表。

## 守它的東西

`tools/agent-harness/` 加一支檢查：解析 `index.ts` 的所有 `app.route(` / `mount(`，
任何一支沒有角色宣告就紅燈。這樣新增 route 時忘記宣告會被擋下來，而不是靜默全開 ——
**這正是這個洞當初長出來的方式。**

機制寫進 `kb/architecture/constitution-enforcement.md` 的 c1 那一列，不新增法條：
c1 本來就涵蓋角色過濾，缺的是實作與強制。

## 刻意不做

- **permissions（`user_roles.permissions`）的細部檢查** —— 那是 admin 內部的職責劃分
  （誰能看營收、誰能改人事），跟「哪個角色能呼叫哪支 API」是不同的問題。現在全部 admin
  都是 `["*"]`，沒有實際需求
- **家長的範圍限制** —— 家長現在一支 route 都碰不到，沒有可驗證的規則可寫
- **前端選單依角色再過濾** —— 已經有了（`RoutesCatalog` 的 `role`），而且前端隱藏不構成授權（c1）
