# 報名驗證強化（容量 / 重複 / 時段衝突）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為所有報名入口加上三項驗證：
1. **班級人數上限**（`classes.max_students`）
2. **學生同班重複報名**（現有 DB unique index，但需要更好的錯誤訊息）
3. **學生時段衝突**（同一學生在已報名的其他 active 班級有時段重疊）

**Scope:** 目前三個報名入口：
1. 家長資料 → 家長詳情 dialog → 關聯學生 → 報班（`parent-detail-dialog.component.ts`）
2. 學生詳情 → 報班（`students/detail/student-detail.page.ts`）
3. 課程管理 → 班級詳情 → 添加學生（`student-picker-dialog.component.ts`）

**Architecture:**

- 後端：抽出共用 helper `assertEnrollmentPreconditions()`，於 `POST /api/enrollments`（單筆）與 `POST /api/enrollments/batch` 共用。新增學生時段衝突檢查。
- 驗證分兩級：
  - **Hard block（回 409/400）**：班級人數上限、DB unique 觸發的重複報名
  - **Soft warning（回 200 + `warnings` array）**：學生時段衝突 → 前端 dialog 顯示提示，admin 可決定是否繼續
- 前端：三個入口統一以 `app-inline-notice` 顯示錯誤/警告（不再使用 toast），衝突時顯示「確認繼續」或「取消」。

**Tech Stack:** Hono + `@hono/zod-openapi` + Supabase PostgreSQL（後端）；Angular 21 Signals + PrimeNG 21（前端）；Vitest（測試）

---

## 設計決策

| 決策 | 選擇 | 理由 |
|---|---|---|
| 容量檢查放哪 | 共用 helper，單筆 + batch 都呼叫 | 避免單筆端點漏檢查（目前的狀況） |
| 時段衝突判斷 | weekday 相同 AND 時間區間 overlap AND enrollment 有效期有交集 | 符合「學生不能在同一時段人在兩個地方」的現實 |
| 時段衝突行為 | Soft warning（admin 可覆蓋） | 現實上 admin 可能明知衝突仍要報（e.g. 補課、過渡期），硬擋會卡流程 |
| 重複報名處理 | Hard block（`ALREADY_ENROLLED`） | DB unique index 保證 |
| 重複報名錯誤顯示 | Inline-notice 顯示「此學生已在此班」 | 目前顯示「加入失敗」太籠統 |
| 容量超過顯示 | Inline-notice 顯示「班級人數已達上限（N/M）」 | 提供具體數字 |

---

## 檔案清單

| 動作 | 檔案 | 說明 |
| ---- | ---- | ---- |
| 新增 | `apps/api/src/routes/enrollments/validation.ts` | 共用驗證 helper（容量 + 衝突） |
| 修改 | `apps/api/src/routes/enrollments.ts` | 單筆 POST 加驗證、batch 重構使用新 helper |
| 新增 | `apps/api/src/routes/enrollments.spec.ts` | 新驗證情境的單元測試 |
| 修改 | `apps/web/src/app/core/enrollments.service.ts` | 型別加上 `warnings` 欄位、新 API method `checkEnrollment()` |
| 修改 | `apps/web/src/app/features/admin/pages/parents/parent-detail-dialog/parent-detail-dialog.component.ts` | 入口 ① 顯示具體錯誤/警告 |
| 修改 | `apps/web/src/app/features/admin/pages/parents/parent-detail-dialog/parent-detail-dialog.component.html` | 入口 ① UI |
| 修改 | `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.ts` | 入口 ② 改用 inline-notice + 衝突確認 |
| 修改 | `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.html` | 入口 ② UI |
| 修改 | `apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/student-picker-dialog.component.ts` | 入口 ③ batch 回傳 warnings 時顯示衝突清單 |
| 修改 | `apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/student-picker-dialog.component.html` | 入口 ③ UI |

---

## 背景知識（API 層）

**關鍵表結構：**

- `classes`: `max_students integer NULL`（可能為 null，視為不限）
- `schedules`: `class_id, weekday (1-7), start_time time, end_time time, effective_to date NULL`
- `enrollments`: `class_id, student_id, status enrollment_status, effective_from date, effective_to date NULL`
- `enrollments_active_class_student_unique` unique index：`(class_id, student_id) WHERE status NOT IN ('withdrawal', 'void')`

**Active 的定義：** status IN (`'active'`, `'pending_payment'`) 是「計入人數且會上課」的狀態。

**Enrollment 生命週期狀態：** `active` / `pending_payment` / `withdrawal` / `void`（以 enrollments.ts 現有查詢為準）

**時間重疊判斷公式：** 兩個時間區間 [aStart, aEnd) 與 [bStart, bEnd) 重疊 ⇔ `aStart < bEnd AND bStart < aEnd`

**日期區間重疊（enrollment 有效期）：** [aFrom, aTo] 與 [bFrom, bTo]（`to` 可能為 null 代表開放式）
- 都展開為 [from, to ?? '9999-12-31']
- 判斷同上

---

## Task 1：API — 新增共用驗證 helper

**Files:**

- Create: `apps/api/src/routes/enrollments/validation.ts`

### 背景知識

- `apps/api/src/routes/enrollments.ts` 目前是單檔，第 608-705 行的 batch 端點已經有自製的容量檢查，要把那段抽出來並補上時段衝突。
- Supabase client 透過 `c.get('supabase')` 注入，型別為 `SupabaseClient` from `@supabase/supabase-js`。
- 所有查詢都要 `.eq('org_id', orgId)` 以維持跨組織隔離。

- [ ] **Step 1：建立 `apps/api/src/routes/enrollments/validation.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export interface EnrollmentPreconditionInput {
  readonly supabase: SupabaseClient;
  readonly orgId: string;
  readonly classId: string;
  /** 欲新增的學生 id（可為單筆或批次） */
  readonly studentIds: readonly string[];
  /** 新 enrollment 的生效起始日（YYYY-MM-DD） */
  readonly effectiveFrom: string;
  /** 新 enrollment 的生效結束日（YYYY-MM-DD 或 null = 開放式） */
  readonly effectiveTo: string | null;
}

export type EnrollmentPreconditionError =
  | { code: 'CLASS_NOT_FOUND'; message: string }
  | { code: 'OVER_QUOTA'; message: string; quota: number; currentActive: number; adding: number }
  | { code: 'SERVER_ERROR'; message: string };

export interface StudentScheduleConflict {
  readonly studentId: string;
  readonly conflictingClassId: string;
  readonly conflictingClassName: string;
  readonly conflictingCourseName: string;
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
}

export interface EnrollmentPreconditionResult {
  /** hard block；呼叫方應回對應 HTTP status */
  readonly error: EnrollmentPreconditionError | null;
  /** soft warning；呼叫方於 response 中附上 warnings 讓前端提示 */
  readonly conflicts: readonly StudentScheduleConflict[];
}

/**
 * 在報名前做三項檢查：
 * 1. 班級存在且屬於 org（hard）
 * 2. 班級人數是否會超過 max_students（hard）
 * 3. 學生是否與已有的 active enrollment 時段衝突（soft）
 *
 * 注意：本 helper 不檢查「同班重複報名」——該檢查由 DB unique index 保證，
 * 呼叫方捕捉 insert 錯誤 code `23505` 即可。
 */
export async function checkEnrollmentPreconditions(
  input: EnrollmentPreconditionInput,
): Promise<EnrollmentPreconditionResult> {
  const { supabase, orgId, classId, studentIds, effectiveFrom, effectiveTo } = input;
  const uniqueStudentIds = Array.from(new Set(studentIds));

  if (uniqueStudentIds.length === 0) {
    return { error: null, conflicts: [] };
  }

  // ── Step 1: 班級存在與上限 ─────────────────────────────
  const { data: cls, error: classError } = await supabase
    .from('classes')
    .select('id, max_students')
    .eq('id', classId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (classError) {
    return {
      error: { code: 'SERVER_ERROR', message: classError.message },
      conflicts: [],
    };
  }
  if (!cls) {
    return {
      error: { code: 'CLASS_NOT_FOUND', message: '班級不存在' },
      conflicts: [],
    };
  }

  // 當前 active 人數（不含此次欲新增的學生，避免重複計算）
  const { count: currentActive, error: countErr } = await supabase
    .from('enrollments')
    .select('*', { count: 'exact', head: true })
    .eq('class_id', classId)
    .eq('org_id', orgId)
    .in('status', ['active', 'pending_payment']);

  if (countErr) {
    return {
      error: { code: 'SERVER_ERROR', message: countErr.message },
      conflicts: [],
    };
  }

  // 欲新增的學生中，有多少是已經在此班的（將被 unique index 阻擋或 already_exists）
  const { count: alreadyIn, error: alreadyErr } = await supabase
    .from('enrollments')
    .select('*', { count: 'exact', head: true })
    .eq('class_id', classId)
    .eq('org_id', orgId)
    .in('status', ['active', 'pending_payment'])
    .in('student_id', uniqueStudentIds);

  if (alreadyErr) {
    return {
      error: { code: 'SERVER_ERROR', message: alreadyErr.message },
      conflicts: [],
    };
  }

  const projectedAdd = uniqueStudentIds.length - (alreadyIn ?? 0);
  const quota = cls.max_students ?? Number.MAX_SAFE_INTEGER;

  if ((currentActive ?? 0) + projectedAdd > quota) {
    return {
      error: {
        code: 'OVER_QUOTA',
        message: '班級人數已達上限',
        quota: cls.max_students ?? 0,
        currentActive: currentActive ?? 0,
        adding: projectedAdd,
      },
      conflicts: [],
    };
  }

  // ── Step 2: 學生時段衝突 ─────────────────────────────
  // 2a. 撈目標班級的所有 schedule（weekday + 時間區間）
  const { data: targetSchedules, error: targetSchedError } = await supabase
    .from('schedules')
    .select('weekday, start_time, end_time, effective_to')
    .eq('class_id', classId);

  if (targetSchedError) {
    return {
      error: { code: 'SERVER_ERROR', message: targetSchedError.message },
      conflicts: [],
    };
  }

  if (!targetSchedules || targetSchedules.length === 0) {
    // 目標班級沒有週期性時段 → 不需要檢查衝突（可能是手動排課班）
    return { error: null, conflicts: [] };
  }

  // 2b. 撈這些學生的所有 active enrollment（不含目標班自己）
  const { data: existingEnrollments, error: existErr } = await supabase
    .from('enrollments')
    .select(
      `
      student_id,
      class_id,
      effective_from,
      effective_to,
      classes!inner(
        id,
        name,
        courses(name),
        schedules(weekday, start_time, end_time, effective_to)
      )
    `,
    )
    .eq('org_id', orgId)
    .in('status', ['active', 'pending_payment'])
    .in('student_id', uniqueStudentIds)
    .neq('class_id', classId);

  if (existErr) {
    return {
      error: { code: 'SERVER_ERROR', message: existErr.message },
      conflicts: [],
    };
  }

  const conflicts: StudentScheduleConflict[] = [];
  const newEffTo = effectiveTo ?? '9999-12-31';

  for (const e of existingEnrollments ?? []) {
    const exEffFrom = (e as { effective_from: string }).effective_from;
    const exEffTo = ((e as { effective_to: string | null }).effective_to ?? '9999-12-31') as string;

    // 若兩個 enrollment 的生效日期完全不重疊，跳過
    if (newEffTo < exEffFrom || exEffTo < effectiveFrom) {
      continue;
    }

    const cls = (e as unknown as {
      classes: {
        id: string;
        name: string;
        courses: { name: string } | null;
        schedules: Array<{
          weekday: number;
          start_time: string;
          end_time: string;
          effective_to: string | null;
        }>;
      };
    }).classes;

    for (const existingSched of cls.schedules ?? []) {
      // 若已結束且結束日早於新 enrollment 起始，跳過
      if (existingSched.effective_to && existingSched.effective_to < effectiveFrom) continue;

      for (const targetSched of targetSchedules) {
        if (targetSched.effective_to && (targetSched as { effective_to: string }).effective_to < effectiveFrom) continue;
        if (existingSched.weekday !== targetSched.weekday) continue;

        // 時間重疊
        const aStart = toHM(existingSched.start_time);
        const aEnd = toHM(existingSched.end_time);
        const bStart = toHM((targetSched as { start_time: string }).start_time);
        const bEnd = toHM((targetSched as { end_time: string }).end_time);

        if (aStart < bEnd && bStart < aEnd) {
          conflicts.push({
            studentId: (e as { student_id: string }).student_id,
            conflictingClassId: cls.id,
            conflictingClassName: cls.name,
            conflictingCourseName: cls.courses?.name ?? '',
            weekday: existingSched.weekday,
            startTime: existingSched.start_time,
            endTime: existingSched.end_time,
          });
          break;
        }
      }
    }
  }

  return { error: null, conflicts };
}

/** HH:MM:SS → HH:MM（字典序可直接比較） */
function toHM(t: string): string {
  return t.substring(0, 5);
}
```

### 驗證

- [ ] 檢查 import：`import type { SupabaseClient } from '@supabase/supabase-js';` 型別是否可解析。
- [ ] 執行 `npx nx build api` 確認 TS 編譯通過（若沒有 api 的 build target，使用 `npx tsc -p apps/api/tsconfig.json --noEmit`）。

---

## Task 2：API — 更新 `POST /api/enrollments`（單筆）使用新 helper

**Files:**

- Modify: `apps/api/src/routes/enrollments.ts:420-477`

### 背景知識

- 原本單筆 POST 完全沒驗證，直接 insert。
- `CreateEnrollmentSchema` 已經有 `effectiveFrom / effectiveTo` 欄位。
- Response 型別在 Task 4 會加上 `warnings?`，這步先保留回傳 201 的行為，再透過 response schema 加上 warnings。

- [ ] **Step 1：在檔案最上方加入 import**

```typescript
// apps/api/src/routes/enrollments.ts 開頭現有 import 區
import {
  checkEnrollmentPreconditions,
  type StudentScheduleConflict,
} from './enrollments/validation';
```

- [ ] **Step 2：定義 Warning schema**

在 `EnrollmentSchema` 附近新增：

```typescript
const ScheduleConflictWarningSchema = z
  .object({
    studentId: z.uuid(),
    conflictingClassId: z.uuid(),
    conflictingClassName: z.string(),
    conflictingCourseName: z.string(),
    weekday: z.number().int().min(1).max(7),
    startTime: z.string(),
    endTime: z.string(),
  })
  .openapi('ScheduleConflictWarning');
```

- [ ] **Step 3：更新 `POST /` 的 response 定義**

將 201 response 改為：

```typescript
201: {
  content: {
    'application/json': {
      schema: z.object({
        data: EnrollmentSchema,
        warnings: z.array(ScheduleConflictWarningSchema).optional(),
      }),
    },
  },
  description: 'Created',
},
400: {
  content: { 'application/json': { schema: ErrorSchema } },
  description: 'Bad Request (over_quota)',
},
404: {
  content: { 'application/json': { schema: ErrorSchema } },
  description: 'Class not found',
},
```

- [ ] **Step 4：在 handler 中 insert 前先呼叫 helper**

```typescript
async (c) => {
  const body = c.req.valid('json');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const supabase = c.get('supabase');
  const effectiveFrom = body.effectiveFrom ?? new Date().toISOString().slice(0, 10);
  const effectiveTo = body.effectiveTo ?? null;

  // ── 前置驗證 ──
  // 注意：單筆 skipConflictCheck 由 query param 控制；預設會回 warnings，前端看情況決定是否繼續。
  // 若 body.skipConflictCheck === true，代表前端已確認覆蓋，不做 conflict 檢查。
  const skipConflictCheck = body.skipConflictCheck === true;

  const preconditions = await checkEnrollmentPreconditions({
    supabase,
    orgId,
    classId: body.classId,
    studentIds: [body.studentId],
    effectiveFrom,
    effectiveTo,
  });

  if (preconditions.error) {
    switch (preconditions.error.code) {
      case 'CLASS_NOT_FOUND':
        return c.json({ error: preconditions.error.message, code: 'CLASS_NOT_FOUND' }, 404);
      case 'OVER_QUOTA':
        return c.json(
          {
            error: preconditions.error.message,
            code: 'OVER_QUOTA',
            quota: preconditions.error.quota,
            currentActive: preconditions.error.currentActive,
          },
          400,
        );
      case 'SERVER_ERROR':
        return c.json({ error: preconditions.error.message }, 500);
    }
  }

  // soft warning：有衝突但前端沒要求 skip → 不 insert，回 warnings 讓前端確認
  if (!skipConflictCheck && preconditions.conflicts.length > 0) {
    return c.json(
      {
        error: 'SCHEDULE_CONFLICT',
        code: 'SCHEDULE_CONFLICT',
        warnings: preconditions.conflicts,
      },
      409,
    );
  }

  // ── Insert ──
  const { data, error } = await supabase
    .from('enrollments')
    .insert({
      org_id: orgId,
      class_id: body.classId,
      student_id: body.studentId,
      status: body.status ?? 'active',
      payment_cycle: body.paymentCycle ?? null,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      notes: body.notes ?? null,
      created_by: userId,
    })
    .select(/* 同原本 */)
    .single();

  if (error) {
    if (error.code === '23505') {
      return c.json(
        { error: '此學生已在此班', code: 'ALREADY_ENROLLED' },
        409,
      );
    }
    return c.json({ error: error.message }, 500);
  }

  if ((body.status ?? 'active') === 'active') {
    await syncLeaveAttendanceForEnrollment({ /* 同原本 */ });
  }

  return c.json({ data: toEnrollmentResponse(data) }, 201);
},
```

- [ ] **Step 5：更新 `CreateEnrollmentSchema` 加入 `skipConflictCheck`**

```typescript
// 在現有 CreateEnrollmentSchema 的 z.object({...}) 內加入：
skipConflictCheck: z.boolean().optional(),
```

### 驗證

- [ ] TS 編譯通過
- [ ] 手動 smoke test：在 DB 裡準備兩班時段重疊，呼叫 POST /api/enrollments 期望回 409 `SCHEDULE_CONFLICT`，帶 `skipConflictCheck: true` 期望回 201。

---

## Task 3：API — 重構 `POST /api/enrollments/batch` 使用新 helper

**Files:**

- Modify: `apps/api/src/routes/enrollments.ts:608-705`

### 背景知識

- 原本 batch 已有手寫的容量檢查，要改成呼叫新 helper。
- batch 的行為維持：逐筆 insert，單筆失敗不中斷整批，於 results 中標記。
- batch response 新增 `warnings` 欄位。

- [ ] **Step 1：更新 `BatchCreateResultSchema`**

```typescript
const BatchCreateResultSchema = z.object({
  results: z.array(BatchCreateResultItemSchema),
  warnings: z.array(ScheduleConflictWarningSchema).optional(),
});
```

- [ ] **Step 2：更新 `BatchCreateEnrollmentSchema`**

```typescript
// 加入 skipConflictCheck
skipConflictCheck: z.boolean().optional(),
```

- [ ] **Step 3：改寫 handler**

```typescript
async (c) => {
  const { classId, studentIds, skipConflictCheck } = c.req.valid('json');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const supabase = c.get('supabase');
  const uniqueStudentIds = Array.from(new Set(studentIds));

  const today = new Date().toISOString().slice(0, 10);

  const preconditions = await checkEnrollmentPreconditions({
    supabase,
    orgId,
    classId,
    studentIds: uniqueStudentIds,
    effectiveFrom: today,
    effectiveTo: null,
  });

  if (preconditions.error) {
    switch (preconditions.error.code) {
      case 'CLASS_NOT_FOUND':
        return c.json({ error: 'CLASS_NOT_FOUND' }, 404);
      case 'OVER_QUOTA':
        return c.json({ error: '人數已達上限', code: 'OVER_QUOTA' }, 400);
      case 'SERVER_ERROR':
        return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);
    }
  }

  // 衝突軟警告：前端未 skip 時，不執行 insert、回 409 + warnings
  if (!skipConflictCheck && preconditions.conflicts.length > 0) {
    return c.json(
      {
        error: 'SCHEDULE_CONFLICT',
        code: 'SCHEDULE_CONFLICT',
        warnings: preconditions.conflicts,
      },
      409,
    );
  }

  const results: z.infer<typeof BatchCreateResultItemSchema>[] = [];

  for (const studentId of uniqueStudentIds) {
    const { data, error } = await supabase
      .from('enrollments')
      .insert({
        org_id: orgId,
        class_id: classId,
        student_id: studentId,
        status: 'active',
        effective_from: today,
        created_by: userId,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        results.push({ studentId, status: 'already_exists' });
      } else {
        results.push({ studentId, status: 'error', message: error.message });
      }
    } else {
      results.push({ studentId, status: 'enrolled', enrollmentId: data.id });
      await syncLeaveAttendanceForEnrollment({
        supabase,
        orgId,
        studentId,
        classId,
        effectiveFrom: today,
        effectiveTo: null,
        recordedBy: userId,
      });
    }
  }

  return c.json({ results, warnings: preconditions.conflicts }, 200);
},
```

### 驗證

- [ ] TS 編譯通過
- [ ] 原有 `enrollments.spec.ts` 的 batch 測試應仍通過（回傳結構未變，只多一個 optional `warnings`）

---

## Task 4：API — 補測試

**Files:**

- Modify: `apps/api/src/routes/enrollments.spec.ts`

### 背景知識

- 現有測試已有容量測試（`OVER_QUOTA`），可參照風格。
- 時段衝突測試需要在 seed 階段建立 schedule 資料。
- Vitest + Hono testClient 模式：參照現有 `enrollments.spec.ts` 開頭即可。

- [ ] **Step 1：新增 "POST /enrollments 單筆 - 容量超過時回 400"**
- [ ] **Step 2：新增 "POST /enrollments 單筆 - 時段衝突回 409 + warnings"**
- [ ] **Step 3：新增 "POST /enrollments 單筆 - skipConflictCheck=true 覆蓋衝突 → 201"**
- [ ] **Step 4：新增 "POST /enrollments 單筆 - 同班重複報名 → 409 ALREADY_ENROLLED"**
- [ ] **Step 5：新增 "POST /enrollments/batch - 衝突回 409 + warnings"**
- [ ] **Step 6：新增 "POST /enrollments/batch - skipConflictCheck=true 時忽略衝突並照常 insert"**

### 驗證

- [ ] `npx nx test api` 全綠

---

## Task 5：前端 service 型別更新

**Files:**

- Modify: `apps/web/src/app/core/enrollments.service.ts`

- [ ] **Step 1：新增型別**

```typescript
export interface ScheduleConflictWarning {
  readonly studentId: string;
  readonly conflictingClassId: string;
  readonly conflictingClassName: string;
  readonly conflictingCourseName: string;
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
}

export interface CreateEnrollmentInput {
  // ... 原有欄位
  readonly skipConflictCheck?: boolean;
}

export interface BatchCreateInput {
  // ... 原有欄位
  readonly skipConflictCheck?: boolean;
}

export interface BatchCreateResult {
  readonly results: readonly BatchCreateResultItem[];
  readonly warnings?: readonly ScheduleConflictWarning[];
}

export interface CreateEnrollmentResponse {
  readonly data: Enrollment;
  readonly warnings?: readonly ScheduleConflictWarning[];
}
```

- [ ] **Step 2：更新 `create()` 與 `batchCreate()` 回傳型別**

```typescript
create(input: CreateEnrollmentInput): Observable<CreateEnrollmentResponse> {
  return this.http.post<CreateEnrollmentResponse>(this.base, input);
}

batchCreate(input: BatchCreateInput): Observable<BatchCreateResult> {
  return this.http.post<BatchCreateResult>(`${this.base}/batch`, input);
}
```

### 驗證

- [ ] `npx ng build web --configuration development` 確認 TS 無錯

---

## Task 6：前端入口 ① 家長詳情 dialog

**Files:**

- Modify: `apps/web/src/app/features/admin/pages/parents/parent-detail-dialog/parent-detail-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/parents/parent-detail-dialog/parent-detail-dialog.component.html`

### 背景知識

- 上一輪已改用 `app-inline-notice`、`notice: signal<InlineNoticeState | null>`、`dismissNotice()`。
- 本步驟要處理三種錯誤 code（`OVER_QUOTA` / `ALREADY_ENROLLED` / `SCHEDULE_CONFLICT`），並在衝突時顯示「仍要報名」按鈕（再呼叫一次帶 `skipConflictCheck: true`）。

- [ ] **Step 1：擴充 notice 型別與新 signal**

```typescript
interface ConflictPrompt {
  readonly student: ParentDetailStudent;
  readonly cls: Class;
  readonly warnings: readonly ScheduleConflictWarning[];
}

protected readonly conflictPrompt = signal<ConflictPrompt | null>(null);
```

- [ ] **Step 2：改寫 `enroll()` 處理所有錯誤分支**

```typescript
private enroll(student: ParentDetailStudent, cls: Class, force = false): void {
  this.enrollmentsService
    .create({
      classId: cls.id,
      studentId: student.id,
      skipConflictCheck: force,
    })
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe({
      next: () => {
        this.conflictPrompt.set(null);
        this.notice.set({
          severity: 'success',
          summary: '報名成功',
          detail: `「${student.name}」已加入「${cls.name}」`,
        });
        // 重新拉 parent 資料以更新學生狀態（如果有顯示 active 班級數）
      },
      error: (err) => {
        const code = err?.error?.code;
        const warnings = err?.error?.warnings as ScheduleConflictWarning[] | undefined;
        if (code === 'SCHEDULE_CONFLICT' && warnings?.length) {
          this.conflictPrompt.set({ student, cls, warnings });
          this.notice.set(null);
          return;
        }
        if (code === 'OVER_QUOTA') {
          this.notice.set({
            severity: 'error',
            summary: '班級人數已達上限',
            detail: '無法加入，請聯絡管理員調整上限或改選其他班級',
          });
          return;
        }
        if (code === 'ALREADY_ENROLLED') {
          this.notice.set({
            severity: 'warning',
            summary: '已經在此班',
            detail: `「${student.name}」已經是「${cls.name}」的成員`,
          });
          return;
        }
        this.notice.set({
          severity: 'error',
          summary: '報名失敗',
          detail: '無法完成報名，請稍後再試',
        });
      },
    });
}

protected confirmConflictEnroll(): void {
  const prompt = this.conflictPrompt();
  if (!prompt) return;
  this.enroll(prompt.student, prompt.cls, true);
}

protected cancelConflictPrompt(): void {
  this.conflictPrompt.set(null);
}

protected weekdayLabel(weekday: number): string {
  return ['一', '二', '三', '四', '五', '六', '日'][weekday - 1] ?? `${weekday}`;
}
```

- [ ] **Step 3：template 加入衝突 prompt 區塊**

在現有 `@if (notice(); as n)` 下方新增：

```html
@if (conflictPrompt(); as prompt) {
  <div class="parent-detail__conflict">
    <app-inline-notice
      severity="warning"
      summary="與其他班級時段衝突"
      [detail]="'此學生已報名以下時段衝突的班級'"
      [dismissible]="false"
    />
    <ul class="parent-detail__conflict-list">
      @for (w of prompt.warnings; track w.conflictingClassId) {
        <li>
          {{ w.conflictingCourseName }} · {{ w.conflictingClassName }}
          （週{{ weekdayLabel(w.weekday) }} {{ w.startTime.substring(0, 5) }}–{{ w.endTime.substring(0, 5) }}）
        </li>
      }
    </ul>
    <div class="parent-detail__conflict-actions">
      <p-button label="取消" severity="secondary" [text]="true" (onClick)="cancelConflictPrompt()" />
      <p-button label="仍要報名" severity="warn" (onClick)="confirmConflictEnroll()" />
    </div>
  </div>
}
```

- [ ] **Step 4：對應 SCSS**（加在 `.parent-detail` block 內）

```scss
&__conflict {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--p-warning-200, #fde68a);
  border-radius: 8px;
  background: var(--p-warning-50, #fffbeb);
}

&__conflict-list {
  margin: 0;
  padding-left: var(--space-5);
  font-size: 0.8125rem;
  color: var(--p-zinc-700);
  line-height: 1.6;
}

&__conflict-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
```

### 驗證

- [ ] 手動測試：準備衝突情境，報名時應顯示 prompt；點「仍要報名」後應成功。

---

## Task 7：前端入口 ② 學生詳情

**Files:**

- Modify: `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.html`

### 背景知識

- 原本使用 `messageService.add()` toast。本次改為 inline-notice（與入口 ① 對稱）。
- 若 `student-detail.page.html` 目前沒有 toast 以外的區塊可以放 notice，應在頁首下方加一個固定位置的 notice 區。

- [ ] **Step 1：加入 `InlineNoticeComponent` import 與 notice signal**

(結構同入口 ①，略)

- [ ] **Step 2：改寫 `addToClass()` 複製入口 ① 的錯誤分支處理**

```typescript
private addToClass(cls: Class, force = false): void {
  const s = this.student();
  if (!s) return;
  this.enrollmentsService
    .create({ classId: cls.id, studentId: s.id, skipConflictCheck: force })
    // ... 同入口 ① 的 error 處理
}
```

- [ ] **Step 3：template 加入 notice + conflict prompt**

- [ ] **Step 4：移除 `MessageService` 依賴與 `<p-toast>`**
  - 若此頁面其他地方還有用 toast，則保留 MessageService；否則一併清掉 import 與 `providers`。

### 驗證

- [ ] `npx ng build web` 通過
- [ ] `npx nx test web --testNamePattern=StudentDetailPage`（若有對應 spec）

---

## Task 8：前端入口 ③ 課程 → 班級詳情 → 添加學生

**Files:**

- Modify: `apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/student-picker-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/student-picker-dialog.component.html`

### 背景知識

- 此 dialog 已有容量錯誤處理（`OVER_QUOTA` → 顯示 `confirmError` 訊息）。
- 本次要加上時段衝突處理：若 batchCreate 回 409 `SCHEDULE_CONFLICT`，顯示衝突學生清單與「仍要加入」按鈕；按下後以 `skipConflictCheck: true` 再呼叫一次。

- [ ] **Step 1：新增 signal 與處理函式**

```typescript
import type { ScheduleConflictWarning } from '@core/enrollments.service';

protected readonly conflictWarnings = signal<readonly ScheduleConflictWarning[]>([]);
```

- [ ] **Step 2：改寫 `confirm()` 與新增 `confirmForce()`**

```typescript
protected confirm(force = false): void {
  this.confirming.set(true);
  this.confirmError.set(null);
  if (!force) this.conflictWarnings.set([]);

  this.enrollmentsService
    .batchCreate({
      classId: this.classId,
      studentIds: Array.from(this.selectedIds()),
      skipConflictCheck: force,
    })
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe({
      next: (res) => {
        this.confirming.set(false);
        this.ref.close(res);
      },
      error: (err) => {
        this.confirming.set(false);
        const code = err?.error?.code;
        const warnings = err?.error?.warnings as ScheduleConflictWarning[] | undefined;

        if (code === 'SCHEDULE_CONFLICT' && warnings?.length) {
          this.conflictWarnings.set(warnings);
          return;
        }
        if (code === 'OVER_QUOTA' || code === 'over_quota') {
          this.confirmError.set('超過班級人數上限，請減少加入人數');
          return;
        }
        this.confirmError.set('加入失敗，請稍後再試');
      },
    });
}

protected confirmForce(): void {
  this.confirm(true);
}

protected clearConflicts(): void {
  this.conflictWarnings.set([]);
}

protected weekdayLabel(w: number): string {
  return ['一', '二', '三', '四', '五', '六', '日'][w - 1] ?? `${w}`;
}
```

- [ ] **Step 3：取得學生名稱 map 以便顯示衝突時對應學生姓名**

`conflictWarnings` 只有 `studentId`，前端必須對應到學生名字。Dialog 內已有 `students()` signal（或類似），建立 computed：

```typescript
protected readonly conflictByStudent = computed(() => {
  const byId = new Map<string, ScheduleConflictWarning[]>();
  for (const w of this.conflictWarnings()) {
    const list = byId.get(w.studentId) ?? [];
    list.push(w);
    byId.set(w.studentId, list);
  }
  const students = this.students(); // 視現有 signal 名稱調整
  return Array.from(byId.entries()).map(([studentId, warnings]) => ({
    student: students.find((s) => s.id === studentId) ?? null,
    warnings,
  }));
});
```

- [ ] **Step 4：template 在 review step 新增衝突清單與確認按鈕**

```html
@if (conflictWarnings().length > 0) {
  <app-inline-notice
    severity="warning"
    summary="部分學生與其他班級時段衝突"
    detail="請確認後決定是否強制加入"
    [dismissible]="false"
  />
  <ul class="student-picker__conflict-list">
    @for (row of conflictByStudent(); track row.warnings[0].studentId) {
      <li>
        <strong>{{ row.student?.name ?? '（未知學生）' }}</strong>
        @for (w of row.warnings; track w.conflictingClassId) {
          <div class="student-picker__conflict-item">
            · {{ w.conflictingCourseName }} · {{ w.conflictingClassName }}
            （週{{ weekdayLabel(w.weekday) }} {{ w.startTime.substring(0, 5) }}–{{ w.endTime.substring(0, 5) }}）
          </div>
        }
      </li>
    }
  </ul>
  <div class="student-picker__conflict-actions">
    <p-button label="返回修改" [text]="true" severity="secondary" (onClick)="clearConflicts()" />
    <p-button label="仍要加入" severity="warn" [loading]="confirming()" (onClick)="confirmForce()" />
  </div>
}
```

- [ ] **Step 5：對應 SCSS**（可重複使用入口 ① 的樣式風格）

### 驗證

- [ ] 手動測試：選一組含衝突學生的 batch，提交後應顯示衝突清單；按「仍要加入」應成功；按「返回修改」應回到 review step。

---

## Task 9：整合驗證

- [ ] **Step 1：**`npx ng build web --configuration development` 無錯
- [ ] **Step 2：**`npx tsc -p apps/api/tsconfig.json --noEmit` 無錯
- [ ] **Step 3：**`npx nx test api` 全綠
- [ ] **Step 4：**`npx nx test web` 無新增失敗（既有失敗請與實作前的 baseline 比對）
- [ ] **Step 5：**手動端對端測試三個入口：
  - 正常報名成功
  - 班級額滿 → OVER_QUOTA inline-notice
  - 已在班 → ALREADY_ENROLLED inline-notice
  - 時段衝突 → 衝突 prompt → 點「仍要報名」成功

---

## 邊界情境注意事項

1. **沒有 schedule 的班級**：helper 第 2a 步若查不到 target schedule 會直接回 `conflicts: []`，不會誤報衝突。這符合現有 codebase 允許無 schedule 的「手動排課班」。

2. **`effective_to` 為 null 的 enrollment / schedule**：一律展開為 `9999-12-31`，確保日期區間比較正確。

3. **同一學生多個 schedule 都衝突**：helper 在找到第一個重疊就 break inner loop，該筆 enrollment 只會產生一筆 warning（避免重複）。若需要列出所有重疊時段，可拿掉 break，但會增加訊息長度。**本計畫採單筆 warning**，以保持 UI 清爽。

4. **效能**：時段衝突查詢對每個 request 都會跑 `enrollments → classes → schedules` 的 join，對於 batch 且 studentIds 很多時可能較慢。目前先不做 cache，若測試發現 batch 30+ 人明顯卡頓，再加 index 或改成分批查詢。

5. **Race condition**：兩個 admin 同時報名可能造成人數超過 max_students（check 與 insert 之間有 gap）。此為可接受風險，因為短期內 overflow 1 位學生不是災難性問題；若要嚴格保證，需改用 DB-level trigger 或 advisory lock，目前不在本計畫範圍。

6. **隱藏的第四個入口？**：招生活動的 `POST /api/enrollments/batch-match`（`enrollments.ts:890`）與 `POST /api/enrollments/copy-from-class`（`enrollments.ts:749`）也會建立 enrollment。本計畫 **不** 涵蓋這兩個，理由：
   - `batch-match` 是報名活動匹配，使用情境不同
   - `copy-from-class` 是複製 roster，通常來源班本來就有驗證過
   - 若後續發現需要，請另開計畫

---

## 完成後要更新的文件

- [ ] `doc/rules/enrollment-rules.md`（若不存在則建立）：記錄「容量 hard block、時段衝突 soft warning、skipConflictCheck 可覆蓋」的規則
- [ ] Obsidian `clessia_project_atlas` vault：更新 enrollment 流程圖
