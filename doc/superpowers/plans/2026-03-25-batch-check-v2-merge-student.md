# Batch Check v2: Merge Info + Duplicate Student Error Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `POST /api/parents/batch-check` endpoint and frontend to (1) show an info notice when an imported parent will merge with an existing DB record, and (2) block rows where the existing parent already has a student with the same name.

**Architecture:** Additive changes only — extend existing schemas, route handler logic, service types, and `processFile()` merge loop. No new files, no new routes. Backend logic refactor replaces the simple `canMerge` boolean path with a three-way branch (warning / merge-info / student-error).

**Tech Stack:** Hono + `@hono/zod-openapi` (backend), Angular 21 Signals + RxJS `firstValueFrom` (frontend), Supabase JS SDK v2

---

## File Map

| File | Change |
|------|--------|
| `apps/api/src/routes/parents.ts` | Extend schemas (lines 915–941) + refactor Step 4 handler logic (lines 1004–1046) |
| `apps/web/src/app/core/parents.service.ts` | Extend `BatchCheckRow`, add `BatchCheckMerge`/`BatchCheckError` interfaces, update `BatchCheckResponse` |
| `apps/web/.../parent-import-dialog/parent-import-dialog.component.ts` | Add `studentName` to checkRows map, update catch fallback, add merge/error loops |

---

## Task 1: Backend — Extend Zod Schemas

**Files:**
- Modify: `apps/api/src/routes/parents.ts` lines 915–941

> **Context:** The existing `BatchCheckRowSchema` (line 915) only has `parentName`, `parentPhone`, `parentEmail`. `BatchCheckResponseSchema` (line 937) only has `warnings`. We need to:
> 1. Add `studentName: z.string().max(50).optional()` to `BatchCheckRowSchema`
> 2. Add `BatchCheckMergeSchema` and `BatchCheckErrorSchema` (new variables)
> 3. Update `BatchCheckResponseSchema` to include `merges` and `errors`

- [ ] **Step 1: Update `BatchCheckRowSchema` (line 915–921)**

Replace:
```typescript
const BatchCheckRowSchema = z
  .object({
    parentName: z.string().min(1).max(100),
    parentPhone: z.string().optional(),
    parentEmail: z.string().optional(),
  })
  .openapi('BatchCheckRow');
```
With:
```typescript
const BatchCheckRowSchema = z
  .object({
    parentName: z.string().min(1).max(100),
    parentPhone: z.string().optional(),
    parentEmail: z.string().optional(),
    studentName: z.string().max(50).optional(), // optional: skip student check if absent
  })
  .openapi('BatchCheckRow');
```

- [ ] **Step 2: Add `BatchCheckMergeSchema` and `BatchCheckErrorSchema` after `BatchCheckWarningSchema` (after line 935)**

Insert after the `BatchCheckWarningSchema` block:
```typescript
const BatchCheckMergeSchema = z
  .object({
    rowIndex: z.number().int().min(0),
    type: z.literal('merging_with_existing'),
    message: z.string(),
  })
  .openapi('BatchCheckMerge');

const BatchCheckErrorSchema = z
  .object({
    rowIndex: z.number().int().min(0),
    type: z.literal('student_already_exists'),
    message: z.string(),
  })
  .openapi('BatchCheckError');
```

- [ ] **Step 3: Update `BatchCheckResponseSchema` (line 937–941)**

Replace:
```typescript
const BatchCheckResponseSchema = z
  .object({
    warnings: z.array(BatchCheckWarningSchema),
  })
  .openapi('BatchCheckResponse');
```
With:
```typescript
const BatchCheckResponseSchema = z
  .object({
    warnings: z.array(BatchCheckWarningSchema),
    merges: z.array(BatchCheckMergeSchema),
    errors: z.array(BatchCheckErrorSchema),
  })
  .openapi('BatchCheckResponse');
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api && npx tsc --noEmit 2>&1 | grep "parents.ts"
```
Expected: no output (no errors in parents.ts)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/parents.ts
git commit -m "feat(api): extend BatchCheck schemas — add studentName, merges, errors"
```

---

## Task 2: Backend — Refactor Route Handler Logic

**Files:**
- Modify: `apps/api/src/routes/parents.ts` lines 1004–1048

> **Context:** The current Step 4 logic (lines 1004–1046):
> - Declares `const warnings: Array<...> = []`
> - Loops over `nameMap`, finds `matchingDbParents`
> - Uses a simple `canMerge` boolean; if `canMerge = false` → pushes to `warnings`
> - Returns `c.json({ warnings }, 200)`
>
> We need to:
> 1. Also declare `merges` and `errors` arrays alongside `warnings`
> 2. When `canMerge = true`: find the specific `mergeTarget` parent, check for duplicate student, push to `merges` or `errors`
> 3. Fix early-return stubs (lines 977–990) to return `{ warnings: [], merges: [], errors: [] }`
> 4. Update final return to include all three arrays

- [ ] **Step 6: Fix early-return stubs that return only `{ warnings: [] }`**

There are two early returns in the handler (around lines 977 and 989). Both currently return `{ warnings: [] }`. Replace both with `{ warnings: [], merges: [], errors: [] }`.

Line ~977:
```typescript
// Before:
return c.json({ warnings: [] }, 200);
// After:
return c.json({ warnings: [], merges: [], errors: [] }, 200);
```

Line ~989 (after the `dbParents` query fails):
```typescript
// Before:
return c.json({ warnings: [] }, 200);
// After:
return c.json({ warnings: [], merges: [], errors: [] }, 200);
```

- [ ] **Step 7: Replace Step 4 logic (lines 1004–1046)**

Replace the entire Step 4 block with:

```typescript
// Step 4: 比對每個匯入行
const warnings: Array<{ rowIndex: number; type: 'same_name_exists'; message: string }> = [];
const merges: Array<{ rowIndex: number; type: 'merging_with_existing'; message: string }> = [];
const errors: Array<{ rowIndex: number; type: 'student_already_exists'; message: string }> = [];

for (const [normalizedName, rowIndexes] of nameMap.entries()) {
  const matchingDbParents = (dbParents as Array<{ id: string; name: string; user_id: string }>).filter(
    (p) => p.name.trim().toLowerCase() === normalizedName,
  );
  if (matchingDbParents.length === 0) continue;

  for (const rowIndex of rowIndexes) {
    const row = rows[rowIndex];
    const importPhone = (row.parentPhone ?? '').trim();
    const importEmail = (row.parentEmail ?? '').trim().toLowerCase();

    // 找第一個可合併的 DB 家長（phone 或 email 任一匹配）
    const mergeTarget = matchingDbParents.find((p) => {
      const contact = userContactMap.get(p.user_id);
      if (!contact) return false;
      const phoneMatch = importPhone && contact.phone && importPhone === contact.phone;
      const emailMatch = importEmail && contact.email && importEmail === contact.email.toLowerCase();
      return !!(phoneMatch || emailMatch);
    });

    if (!mergeTarget) {
      // canMerge = false → 同名不同聯絡
      warnings.push({
        rowIndex,
        type: 'same_name_exists',
        message: `系統已有同名家長「${matchingDbParents[0].name}」，請確認是否為不同人`,
      });
      continue;
    }

    // canMerge = true → 查重複學生
    const importStudentName = (row.studentName ?? '').trim().toLowerCase();

    if (importStudentName) {
      const { data: relations } = await supabase
        .from('parent_student_relations')
        .select('students!inner(id, name)')
        .eq('parent_id', mergeTarget.id);

      const isDuplicateStudent = (relations ?? []).some(
        (r: { students: { id: string; name: string } }) =>
          r.students.name.trim().toLowerCase() === importStudentName,
      );

      if (isDuplicateStudent) {
        errors.push({
          rowIndex,
          type: 'student_already_exists',
          message: `學生「${row.studentName!.trim()}」已存在於此家長帳號下，無需重複建立`,
        });
        continue;
      }
    }

    // canMerge = true + 無重複學生
    merges.push({
      rowIndex,
      type: 'merging_with_existing',
      message: '此家長已存在於系統，匯入將合併至現有帳號',
    });
  }
}

return c.json({ warnings, merges, errors }, 200);
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/api && npx tsc --noEmit 2>&1 | grep "parents.ts"
```
Expected: no output

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/parents.ts
git commit -m "feat(api): batch-check v2 — merging_with_existing info + student_already_exists error"
```

---

## Task 3: Frontend Service — Update Types

**Files:**
- Modify: `apps/web/src/app/core/parents.service.ts` lines 94–108

> **Context:** Current types (lines 94–108):
> - `BatchCheckRow`: `{ parentName, parentPhone?, parentEmail? }`
> - `BatchCheckWarning`: `{ rowIndex, type: 'same_name_exists', message }`
> - `BatchCheckResponse`: `{ warnings: BatchCheckWarning[] }`
>
> Need to add `studentName?` to `BatchCheckRow`, add two new interfaces, and extend `BatchCheckResponse`.

- [ ] **Step 10: Update `BatchCheckRow` interface (line 94–98)**

Replace:
```typescript
export interface BatchCheckRow {
  parentName: string;
  parentPhone?: string;
  parentEmail?: string;
}
```
With:
```typescript
export interface BatchCheckRow {
  parentName: string;
  parentPhone?: string;
  parentEmail?: string;
  studentName?: string; // optional; absent means skip student duplicate check
}
```

- [ ] **Step 11: Add `BatchCheckMerge` and `BatchCheckError` interfaces after `BatchCheckWarning` (after line 104)**

Insert after the `BatchCheckWarning` interface:
```typescript
export interface BatchCheckMerge {
  rowIndex: number; // 0-based array index
  type: 'merging_with_existing';
  message: string;
}

export interface BatchCheckError {
  rowIndex: number; // 0-based array index
  type: 'student_already_exists';
  message: string;
}
```

- [ ] **Step 12: Update `BatchCheckResponse` interface (line 106–108)**

Replace:
```typescript
export interface BatchCheckResponse {
  warnings: BatchCheckWarning[];
}
```
With:
```typescript
export interface BatchCheckResponse {
  warnings: BatchCheckWarning[];
  merges: BatchCheckMerge[];
  errors: BatchCheckError[];
}
```

- [ ] **Step 13: Verify Angular build**

```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web && npx ng build --configuration development 2>&1 | grep "error TS" | head -10
```
Expected: no output (TypeScript errors only — there will be compile errors in the component until Task 4 is done, so check only for **new** errors unrelated to BatchCheck)

- [ ] **Step 14: Commit**

```bash
git add apps/web/src/app/core/parents.service.ts
git commit -m "feat(parents-service): batch-check v2 types — add studentName, BatchCheckMerge, BatchCheckError"
```

---

## Task 4: Frontend Component — Update processFile()

**Files:**
- Modify: `apps/web/.../parent-import-dialog/parent-import-dialog.component.ts`

> **Context:** Current `processFile()` (lines 111–139):
> - Maps `checkRows` without `studentName`
> - Catch fallback returns `{ warnings: [] }` (missing `merges`, `errors`)
> - Only loops over `dbResult.warnings`
>
> Also need to update the import statement to include `BatchCheckMerge` and `BatchCheckError`.

- [ ] **Step 15: Add `BatchCheckMerge` and `BatchCheckError` to the import from parents.service**

Current import (lines 10–16):
```typescript
import {
  ParentsService,
  type BatchImportResponse,
  type BatchImportRow,
  type BatchCheckRow,
  type BatchCheckResponse,
} from '../../../../../core/parents.service';
```
Replace with:
```typescript
import {
  ParentsService,
  type BatchImportResponse,
  type BatchImportRow,
  type BatchCheckRow,
  type BatchCheckMerge,
  type BatchCheckError,
  type BatchCheckResponse,
} from '../../../../../core/parents.service';
```

- [ ] **Step 16: Update `processFile()` — checkRows map, catch fallback, and merge loops**

Replace the entire `processFile()` method:
```typescript
private async processFile(file: File): Promise<void> {
  try {
    const sheetRows = await this.parseExcelFile(file);
    const parsedRows = this.parseRows(sheetRows);

    // DB 衝突預檢（靜默降級：API 失敗不阻擋流程）
    const checkRows: BatchCheckRow[] = parsedRows.map((row) => ({
      parentName: row.parentName,
      parentPhone: row.parentPhone || undefined,
      parentEmail: row.parentEmail || undefined,
      studentName: row.studentName || undefined,
    }));

    const dbResult: BatchCheckResponse = await firstValueFrom(
      this.parentsService.batchCheck(checkRows),
    ).catch((): BatchCheckResponse => ({ warnings: [], merges: [], errors: [] }));

    for (const w of dbResult.warnings) {
      parsedRows[w.rowIndex]?.warnings.push(w.message);
    }
    for (const m of dbResult.merges) {
      if (parsedRows[m.rowIndex]) {
        parsedRows[m.rowIndex].mergeNote = m.message; // DB merge info overrides in-file merge note
      }
    }
    for (const e of dbResult.errors) {
      parsedRows[e.rowIndex]?.errors.push(e.message);
    }

    this.rows.set(parsedRows);
    this.submitResult.set(null);
    this.step.set(2);
  } catch (error: unknown) {
    console.error('解析 Excel 失敗:', error);
    this.rows.set([]);
    this.step.set(1);
  }
}
```

Note: `BatchCheckMerge` and `BatchCheckError` imports added in Step 15 are used implicitly via `dbResult.merges` and `dbResult.errors` — TypeScript infers the loop variable types from `BatchCheckResponse`.

- [ ] **Step 17: Verify Angular build passes cleanly**

```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web && npx ng build --configuration development 2>&1 | grep "error TS" | head -10
```
Expected: no output

- [ ] **Step 18: Commit**

```bash
git add apps/web/src/app/features/admin/pages/parents/parent-import-dialog/parent-import-dialog.component.ts
git commit -m "feat(parent-import-dialog): batch-check v2 — merge info notice + student duplicate error"
```

---

## Manual Verification Checklist

After all tasks, verify end-to-end in the browser with a running dev server:

- [ ] **既有家長，同名同電話，不同學生** → 預覽顯示藍色 info「此家長已存在於系統，匯入將合併至現有帳號」，可繼續匯入
- [ ] **既有家長，同名同電話，相同學生名** → 預覽顯示紅色錯誤「學生「X」已存在於此家長帳號下，無需重複建立」，該列被排除匯入（灰色/不可選）
- [ ] **新家長（DB 無同名）** → 預覽正常，無任何警告或錯誤
- [ ] **同名不同聯絡方式** → 預覽顯示黃色警告「系統已有同名家長...」（既有行為，確認未被影響）
- [ ] **關閉 API dev server 後上傳** → 靜默降級，預覽正常顯示（無 crash）

---

## Notes for Implementor

- `BatchCheckMerge` and `BatchCheckError` imports added in Step 15 are technically not required for compilation (TypeScript infers through `BatchCheckResponse`), but are good practice for explicitness.
- The `(r: { students: { id: string; name: string } })` type annotation in Step 7 replaces the `(r: any)` pattern — avoids `strict: true` violations.
- `onSubmit()` does NOT need modification: it already filters `row.errors.length === 0`, so rows with DB errors pushed via `parsedRows[e.rowIndex].errors.push(...)` are automatically excluded.
- The existing in-file `mergeNote` (set by `applyMergeNotes()`) is overwritten by DB merge info in the `merges` loop — this is intentional since DB data is more authoritative.
