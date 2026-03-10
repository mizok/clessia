# Unassigned Session Lifecycle MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 讓課程管理可正式建立與管理無主課堂，並提供單班級批次指派教師能力，同時消除「預覽可建但實際 0 筆」的落差。

**Architecture:** 將「課堂可否建立／是否無主／是否衝突」抽成後端純函式領域層，`classes` 路由與 `sessions` 路由僅負責 I/O。資料層新增 `assignment_status` 與一致性 constraint，前端以同一份 API 統計呈現預覽與實際建立結果。批次指派採 `skip-conflicts` 預設策略，僅更新符合條件的 `scheduled + unassigned` 課堂。

**Tech Stack:** Angular 21 (Signals, Standalone), PrimeNG 21, Hono + Zod OpenAPI, Supabase PostgreSQL, Vitest/Jasmine (web unit test executor), Nx。

---

### Task 1: 建立 Session Assignment 領域型別與規則（後端可測核心）

**Files:**
- Create: `apps/api/src/domain/session-assignment/session-assignment.types.ts`
- Create: `apps/api/src/domain/session-assignment/session-assignment.rules.ts`
- Test: `apps/api/src/domain/session-assignment/session-assignment.rules.spec.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { validateAssignmentState } from './session-assignment.rules';

describe('validateAssignmentState', () => {
  it('assigned 必須有 teacherId', () => {
    expect(() => validateAssignmentState({ assignmentStatus: 'assigned', teacherId: null })).toThrow();
  });

  it('unassigned 必須沒有 teacherId', () => {
    expect(() =>
      validateAssignmentState({ assignmentStatus: 'unassigned', teacherId: 'teacher-1' }),
    ).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run apps/api/src/domain/session-assignment/session-assignment.rules.spec.ts`
Expected: FAIL，找不到 `validateAssignmentState`。

**Step 3: Write minimal implementation**

```ts
export function validateAssignmentState(input: { assignmentStatus: 'assigned' | 'unassigned'; teacherId: string | null }): void {
  if (input.assignmentStatus === 'assigned' && !input.teacherId) {
    throw new Error('assigned requires teacherId');
  }
  if (input.assignmentStatus === 'unassigned' && input.teacherId) {
    throw new Error('unassigned requires null teacherId');
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run apps/api/src/domain/session-assignment/session-assignment.rules.spec.ts`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/api/src/domain/session-assignment/session-assignment.types.ts apps/api/src/domain/session-assignment/session-assignment.rules.ts apps/api/src/domain/session-assignment/session-assignment.rules.spec.ts
git commit -m "feat(api): add session assignment invariant rules"
```

### Task 2: 建立 Preview/Generate 共用規劃器（避免預覽與實作不一致）

**Files:**
- Create: `apps/api/src/domain/session-assignment/session-generation-planner.ts`
- Test: `apps/api/src/domain/session-assignment/session-generation-planner.spec.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildSessionGenerationPlan } from './session-generation-planner';

describe('buildSessionGenerationPlan', () => {
  it('includeUnassigned=true 時，無老師時段應標記 willBeUnassigned', () => {
    const plan = buildSessionGenerationPlan({
      includeUnassigned: true,
      schedules: [{ weekday: 1, startTime: '18:00:00', endTime: '20:00:00', teacherId: null, effectiveFrom: '2026-02-01', effectiveTo: null }],
      from: '2026-02-02',
      to: '2026-02-02',
      existingKeys: new Set(),
      excludeDates: new Set(),
    });
    expect(plan.preview[0].willBeUnassigned).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run apps/api/src/domain/session-assignment/session-generation-planner.spec.ts`
Expected: FAIL，找不到 `buildSessionGenerationPlan`。

**Step 3: Write minimal implementation**

```ts
export function buildSessionGenerationPlan(/* input */) {
  // 回傳 preview 列表 + summary：createdAssigned/createdUnassigned/skippedExisting/skippedNoTeacher/totalPlanned
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run apps/api/src/domain/session-assignment/session-generation-planner.spec.ts`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/api/src/domain/session-assignment/session-generation-planner.ts apps/api/src/domain/session-assignment/session-generation-planner.spec.ts
git commit -m "feat(api): add shared session generation planner"
```

### Task 3: 建立批次指派衝突判斷器（skip-conflicts 預設）

**Files:**
- Create: `apps/api/src/domain/session-assignment/batch-assign-planner.ts`
- Test: `apps/api/src/domain/session-assignment/batch-assign-planner.spec.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { planBatchAssign } from './batch-assign-planner';

describe('planBatchAssign', () => {
  it('skip-conflicts 應僅更新無衝突課堂', () => {
    const result = planBatchAssign({
      mode: 'skip-conflicts',
      targetSessions: [/* ... */],
      teacherBusySlots: [/* ... */],
    });
    expect(result.updatedIds.length).toBe(1);
    expect(result.conflicts.length).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run apps/api/src/domain/session-assignment/batch-assign-planner.spec.ts`
Expected: FAIL。

**Step 3: Write minimal implementation**

```ts
export function planBatchAssign(/* input */) {
  // 輸出 updatedIds / skippedConflicts / skippedNotEligible / conflicts
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run apps/api/src/domain/session-assignment/batch-assign-planner.spec.ts`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/api/src/domain/session-assignment/batch-assign-planner.ts apps/api/src/domain/session-assignment/batch-assign-planner.spec.ts
git commit -m "feat(api): add batch assign conflict planner"
```

### Task 4: 實作 DB Migration（assignment_status + constraint）

**Files:**
- Create: `supabase/migrations/20260224121000_add_assignment_status_to_sessions.sql`

**Step 1: Write the failing verification SQL (local check script)**

```sql
-- 驗證應失敗：assigned + null teacher
insert into public.sessions (..., teacher_id, assignment_status) values (..., null, 'assigned');
```

**Step 2: Run migration reset to verify current schema lacks required column/constraint**

Run: `supabase db reset`
Expected: 目前 schema 尚未有 `assignment_status`。

**Step 3: Write minimal migration**

```sql
create type public.session_assignment_status as enum ('assigned', 'unassigned');
alter table public.sessions add column assignment_status public.session_assignment_status;
update public.sessions set assignment_status = 'assigned' where teacher_id is not null;
alter table public.sessions alter column assignment_status set not null;
alter table public.sessions alter column teacher_id drop not null;
alter table public.sessions add constraint sessions_assignment_consistent_chk check (
  (assignment_status = 'assigned' and teacher_id is not null)
  or (assignment_status = 'unassigned' and teacher_id is null)
);
```

**Step 4: Run DB reset to verify migration passes**

Run: `supabase db reset`
Expected: PASS，無 migration error。

**Step 5: Commit**

```bash
git add supabase/migrations/20260224121000_add_assignment_status_to_sessions.sql
git commit -m "feat(db): support unassigned sessions with assignment status"
```

### Task 5: 整合 classes 路由（preview/generate + batch-assign）

**Files:**
- Modify: `apps/api/src/routes/classes.ts`
- Modify: `apps/api/src/routes/classes.ts` (新增 route schema/handler)
- Test: `apps/api/src/domain/session-assignment/session-generation-planner.spec.ts`
- Test: `apps/api/src/domain/session-assignment/batch-assign-planner.spec.ts`

**Step 1: Write failing contract assertions in planner specs**

```ts
it('summary 統計應包含 createdAssigned / createdUnassigned / skippedExisting / skippedNoTeacher', () => {
  expect(plan.summary).toMatchObject({
    createdAssigned: expect.any(Number),
    createdUnassigned: expect.any(Number),
    skippedExisting: expect.any(Number),
    skippedNoTeacher: expect.any(Number),
    totalPlanned: expect.any(Number),
  });
});
```

**Step 2: Run tests to confirm fail before route integration**

Run: `npx vitest run apps/api/src/domain/session-assignment/*.spec.ts`
Expected: FAIL。

**Step 3: Route minimal implementation**

```ts
// preview: 接 includeUnassigned，回傳 planner.preview
// generate: 依 planner result 寫入 sessions（含 assignment_status）
// patch /:id/sessions/batch-assign-teacher: 套用 planBatchAssign 結果
```

**Step 4: Re-run tests + build**

Run:
- `npx vitest run apps/api/src/domain/session-assignment/*.spec.ts`
- `npx nx build api`

Expected:
- Unit tests PASS
- API build PASS

**Step 5: Commit**

```bash
git add apps/api/src/routes/classes.ts apps/api/src/domain/session-assignment
git commit -m "feat(api): unify preview/generate rules and add batch assign endpoint"
```

### Task 6: sessions 路由加入 SESSION_UNASSIGNED 擋板（R1 後端層）

**Files:**
- Modify: `apps/api/src/routes/sessions.ts`
- Create: `apps/api/src/domain/session-assignment/session-operation-guard.ts`
- Test: `apps/api/src/domain/session-assignment/session-operation-guard.spec.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { assertSessionOperable } from './session-operation-guard';

it('unassigned 課堂應拋 SESSION_UNASSIGNED', () => {
  expect(() =>
    assertSessionOperable({ assignmentStatus: 'unassigned', status: 'scheduled' }),
  ).toThrow(/SESSION_UNASSIGNED/);
});
```

**Step 2: Run test to confirm fail**

Run: `npx vitest run apps/api/src/domain/session-assignment/session-operation-guard.spec.ts`
Expected: FAIL。

**Step 3: Write minimal implementation + wire into sessions routes**

```ts
export function assertSessionOperable(session: { assignmentStatus: 'assigned' | 'unassigned'; status: 'scheduled' | 'completed' | 'cancelled' }) {
  if (session.assignmentStatus === 'unassigned') {
    throw new Error('SESSION_UNASSIGNED');
  }
}
```

**Step 4: Run tests + build**

Run:
- `npx vitest run apps/api/src/domain/session-assignment/session-operation-guard.spec.ts`
- `npx nx build api`

Expected: PASS。

**Step 5: Commit**

```bash
git add apps/api/src/routes/sessions.ts apps/api/src/domain/session-assignment/session-operation-guard.ts apps/api/src/domain/session-assignment/session-operation-guard.spec.ts
git commit -m "feat(api): block unassigned sessions from restricted operations"
```

### Task 7: 前端 service/type 對齊新 API

**Files:**
- Modify: `apps/web/src/app/core/classes.service.ts`
- Modify: `apps/web/src/app/core/sessions.service.ts`
- Test: `apps/web/src/app/core/sessions.service.spec.ts` (new)

**Step 1: Write failing test for response typing / API params**

```ts
it('generateSessions should send includeUnassigned and parse detailed summary', () => {
  // mock HttpClient expect POST body has includeUnassigned
});
```

**Step 2: Run web tests to verify fail**

Run: `npx nx test web --watch=false`
Expected: FAIL (new spec / type mismatch)。

**Step 3: Write minimal implementation**

```ts
export interface GenerateSessionsResponse {
  createdAssigned: number;
  createdUnassigned: number;
  skippedExisting: number;
  skippedNoTeacher: number;
  totalPlanned: number;
}
```

**Step 4: Run web tests**

Run: `npx nx test web --watch=false`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/web/src/app/core/classes.service.ts apps/web/src/app/core/sessions.service.ts apps/web/src/app/core/sessions.service.spec.ts
git commit -m "feat(web): align session APIs with unassigned model"
```

### Task 8: 課程管理 UI + 行事曆限制（R1 前端層）

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.html`
- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.scss`
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.html`
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.spec.ts`

**Step 1: Write failing UI behavior test**

```ts
it('should disable operations when selected session is unassigned', () => {
  // 建立 selectedSession.assignmentStatus = 'unassigned'
  // 預期 canOperate() === false
});
```

**Step 2: Run tests to verify fail**

Run: `npx nx test web --watch=false`
Expected: FAIL。

**Step 3: Write minimal implementation**

```ts
protected canOperate(session: Session | null): boolean {
  return !!session && session.status !== 'cancelled' && session.assignmentStatus !== 'unassigned';
}
```

**Step 4: Run tests + build web**

Run:
- `npx nx test web --watch=false`
- `npx nx build web --configuration=production`

Expected:
- tests PASS
- build PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/classes/classes.page.ts apps/web/src/app/features/admin/pages/classes/classes.page.html apps/web/src/app/features/admin/pages/classes/classes.page.scss apps/web/src/app/features/admin/pages/calendar/calendar.page.ts apps/web/src/app/features/admin/pages/calendar/calendar.page.html apps/web/src/app/features/admin/pages/calendar/calendar.page.spec.ts
git commit -m "feat(web): support unassigned preview/assignment and operation guards"
```

### Task 9: 最終驗證與文件補齊

**Files:**
- Modify: `doc/specs/admin/calendar.md`
- Modify: `doc/specs/admin/tasks.md`
- Modify: `doc/specs/admin/dashboard.md` (若有無主課堂統計顯示)

**Step 1: Write failing checklist (manual verification doc section)**

```md
- [ ] 產生課堂 summary 顯示四種統計
- [ ] includeUnassigned=false 時，無老師課堂不建立
- [ ] batch assign skip-conflicts 可部分成功
- [ ] unassigned 無法停課/代課/調課
```

**Step 2: Run full verification**

Run:
- `supabase db reset`
- `npx vitest run apps/api/src/domain/session-assignment/*.spec.ts`
- `npx nx build api`
- `npx nx test web --watch=false`
- `npx nx build web --configuration=production`

Expected: 全部 PASS。

**Step 3: 補齊文件**

```md
新增「無主課堂生命週期」與「批次指派老師」操作說明
```

**Step 4: Re-run impacted checks**

Run:
- `npx nx test web --watch=false`
- `npx nx build api`

Expected: PASS。

**Step 5: Commit**

```bash
git add doc/specs/admin/calendar.md doc/specs/admin/tasks.md doc/specs/admin/dashboard.md
git commit -m "docs: document unassigned session lifecycle MVP"
```
