# Batch Import DB Conflict Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/parents/batch-check` endpoint and integrate it into the Excel import preview step to warn when imported parent names already exist in DB with different contact info.

**Architecture:** Lightweight read-only endpoint that queries DB parents by name and returns `same_name_exists` warnings; frontend calls it after local parse, merges warnings into `ParsedRow.warnings[]`, then shows them in the existing preview table.

**Tech Stack:** Hono + `@hono/zod-openapi` (backend), Angular 21 Signals + RxJS `firstValueFrom` (frontend), Supabase (DB query)

---

## File Map

| File | Change |
|------|--------|
| `apps/api/src/routes/parents.ts` | Add Zod schemas + `POST /batch-check` route handler **before** the `batch-import` section |
| `apps/web/src/app/core/parents.service.ts` | Add `BatchCheckRow`, `BatchCheckWarning`, `BatchCheckResponse` interfaces + `batchCheck()` method |
| `apps/web/src/app/features/admin/pages/parents/parent-import-dialog/parent-import-dialog.component.ts` | Refactor `processFile()` to async, call `batchCheck()`, merge warnings |

---

## Task 1: Backend — Zod Schemas

**Files:**
- Modify: `apps/api/src/routes/parents.ts` (after line 954, before `app.openapi(createRoute...batch-import)`)

> **Context:** This file uses `@hono/zod-openapi`. All schema variables are declared before the `app.openapi(createRoute(...))` call that uses them. Follow the exact same pattern as `BatchImportBodySchema` / `BatchImportResponseSchema` already in the file.

- [ ] **Step 1: Add BatchCheck schemas before the `// POST /api/parents/batch-import` comment block (around line 910)**

Insert the entire batch-check block (schemas + route handler in Task 2) **before** the existing `// ============================================================\n// POST /api/parents/batch-import\n// ============================================================` comment:

```typescript
// ============================================================
// POST /api/parents/batch-check
// ============================================================

const BatchCheckRowSchema = z
  .object({
    parentName: z.string().min(1).max(100),
    parentPhone: z.string().optional(),
    parentEmail: z.string().optional(),
  })
  .openapi('BatchCheckRow');

const BatchCheckBodySchema = z
  .object({
    rows: z.array(BatchCheckRowSchema).min(1).max(500),
  })
  .openapi('BatchCheckBody');

const BatchCheckWarningSchema = z
  .object({
    rowIndex: z.number().int().min(0),
    type: z.literal('same_name_exists'),
    message: z.string(),
  })
  .openapi('BatchCheckWarning');

const BatchCheckResponseSchema = z
  .object({
    warnings: z.array(BatchCheckWarningSchema),
  })
  .openapi('BatchCheckResponse');
```

- [ ] **Step 2: Verify TypeScript compiles without error**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (no errors)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/parents.ts
git commit -m "feat(api): add BatchCheck Zod schemas"
```

---

## Task 2: Backend — Route Handler

**Files:**
- Modify: `apps/api/src/routes/parents.ts` (add route handler right after the schemas from Task 1, so the entire batch-check block is before the `batch-import` section at line ~910)

> **Context:** The route handler follows the `app.openapi(createRoute({...}), async (c) => {...})` pattern. Look at how `batch-import` route accesses `c.get('supabase')`, `c.get('orgId')`, `c.env.PLACEHOLDER_EMAIL_DOMAIN`, and `c.req.valid('json')`.
>
> The existing `isPlaceholderEmail(email, domain)` helper is already defined (exported) at line ~99. Use it directly — no import needed (same file).
>
> `ErrorSchema` is defined at line ~82 — it is available throughout the file.
>
> DB schema: `parents` table has `id uuid`, `name text`, `user_id text`, `org_id uuid`. `ba_user` table has `id text`, `phone text`, `email text`.

- [ ] **Step 4: Add route handler after BatchCheckResponseSchema**

```typescript
app.openapi(
  createRoute({
    method: 'post',
    path: '/batch-check',
    tags: ['Parents'],
    summary: '批次匯入前 DB 同名衝突預檢（僅讀取）',
    request: {
      body: { content: { 'application/json': { schema: BatchCheckBodySchema } } },
    },
    responses: {
      200: {
        description: '預檢結果（warnings 為空代表無衝突）',
        content: { 'application/json': { schema: BatchCheckResponseSchema } },
      },
      400: { description: '請求格式錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { rows } = c.req.valid('json');
    const placeholderDomain = c.env.PLACEHOLDER_EMAIL_DOMAIN ?? 'phone.internal';

    // Step 1: 收集不重複的正規化姓名
    const nameMap = new Map<string, number[]>(); // normalizedName -> rowIndexes
    for (let i = 0; i < rows.length; i++) {
      const normalized = rows[i].parentName.trim().toLowerCase();
      if (!normalized) continue;
      const bucket = nameMap.get(normalized) ?? [];
      bucket.push(i);
      nameMap.set(normalized, bucket);
    }

    if (nameMap.size === 0) {
      return c.json({ warnings: [] }, 200);
    }

    // Step 2: 查詢 DB 同名家長（ilike 縮小範圍，JS 端精確比對）
    const namesToQuery = Array.from(nameMap.keys());
    const { data: dbParents, error: parentsError } = await supabase
      .from('parents')
      .select('id, name, user_id')
      .eq('org_id', orgId)
      .or(namesToQuery.map((n) => `name.ilike.${n}`).join(','));

    if (parentsError || !dbParents || dbParents.length === 0) {
      return c.json({ warnings: [] }, 200);
    }

    // Step 3: 查詢每個 DB 家長的聯絡資訊
    const userIds = dbParents.map((p: { user_id: string }) => p.user_id);
    const { data: baUsers } = await supabase
      .from('ba_user')
      .select('id, phone, email')
      .in('id', userIds);

    const userContactMap = new Map<string, { phone: string | null; email: string | null }>();
    for (const u of (baUsers ?? []) as Array<{ id: string; phone: string | null; email: string | null }>) {
      userContactMap.set(u.id, {
        phone: u.phone ?? null,
        email: isPlaceholderEmail(u.email, placeholderDomain) ? null : (u.email ?? null),
      });
    }

    // Step 4: 比對每個匯入行
    const warnings: Array<{ rowIndex: number; type: 'same_name_exists'; message: string }> = [];

    for (const [normalizedName, rowIndexes] of nameMap.entries()) {
      // 找 DB 中同名家長（JS 精確比對）
      const matchingDbParents = (dbParents as Array<{ id: string; name: string; user_id: string }>).filter(
        (p) => p.name.trim().toLowerCase() === normalizedName
      );
      if (matchingDbParents.length === 0) continue;

      for (const rowIndex of rowIndexes) {
        const row = rows[rowIndex];
        const importPhone = (row.parentPhone ?? '').trim();
        const importEmail = (row.parentEmail ?? '').trim().toLowerCase();

        // 對每個同名 DB 家長判斷是否可合併
        let canMerge = false;
        for (const dbParent of matchingDbParents) {
          const contact = userContactMap.get(dbParent.user_id);
          if (!contact) continue;

          const phoneMatch = importPhone && contact.phone && importPhone === contact.phone;
          const emailMatch = importEmail && contact.email && importEmail === contact.email.toLowerCase();

          if (phoneMatch || emailMatch) {
            canMerge = true;
            break;
          }
        }

        if (!canMerge) {
          // 取第一個無法合併的同名家長的原始名稱作為訊息
          const displayName = matchingDbParents[0].name;
          warnings.push({
            rowIndex,
            type: 'same_name_exists',
            message: `系統已有同名家長「${displayName}」，請確認是否為不同人`,
          });
        }
      }
    }

    return c.json({ warnings }, 200);
  },
);
```

- [ ] **Step 5: Verify TypeScript compiles without error**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/parents.ts
git commit -m "feat(api): add POST /parents/batch-check route"
```

---

## Task 3: Frontend Service — Types & Method

**Files:**
- Modify: `apps/web/src/app/core/parents.service.ts`

> **Context:** All existing interfaces are declared before the `@Injectable` class. Add new ones after `BatchImportResponse`. The `batchImport()` method is at line 139 — add `batchCheck()` immediately after it. `this.endpoint` = `${environment.apiUrl}/api/parents`.

- [ ] **Step 7: Add interfaces after `BatchImportResponse` (around line 92)**

```typescript
export interface BatchCheckRow {
  parentName: string;
  parentPhone?: string;
  parentEmail?: string;
}

export interface BatchCheckWarning {
  rowIndex: number; // 0-based, maps to parsedRows array index
  type: 'same_name_exists';
  message: string;
}

export interface BatchCheckResponse {
  warnings: BatchCheckWarning[];
}
```

- [ ] **Step 8: Add batchCheck() method after batchImport() (around line 141)**

```typescript
batchCheck(rows: BatchCheckRow[]): Observable<BatchCheckResponse> {
  return this.http.post<BatchCheckResponse>(`${this.endpoint}/batch-check`, { rows });
}
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/app/core/parents.service.ts
git commit -m "feat(parents-service): add batchCheck() method and types"
```

---

## Task 4: Frontend Component — Integrate batchCheck

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/parents/parent-import-dialog/parent-import-dialog.component.ts`

> **Context:**
> - Import `firstValueFrom` from `'rxjs'` — currently only `finalize` is imported from rxjs
> - Import `BatchCheckWarning`, `BatchCheckResponse` from `'../../../../../core/parents.service'`
> - `processFile()` is currently a sync method that chains `.then().catch()` on `parseExcelFile()`
> - `parseRows()` returns `ParsedRow[]` synchronously
> - `ParsedRow.warnings` is `string[]`, `ParsedRow.index` is 1-based display index (0-based array index = `index - 1`)
> - After adding DB warnings, step goes to 2 (preview)

- [ ] **Step 11: Update imports**

In the `import { ... } from 'rxjs'` line, add `firstValueFrom`:
```typescript
import { finalize, firstValueFrom } from 'rxjs';
```

Add `BatchCheckWarning`, `BatchCheckResponse` to the parents.service import:
```typescript
import {
  ParentsService,
  type BatchImportResponse,
  type BatchImportRow,
  type BatchCheckRow,
  type BatchCheckWarning,
  type BatchCheckResponse,
} from '../../../../../core/parents.service';
```

- [ ] **Step 12: Refactor processFile() to async with batchCheck integration**

Replace the existing `processFile()` method:

```typescript
private async processFile(file: File): Promise<void> {
  try {
    const sheetRows = await this.parseExcelFile(file);
    const parsedRows = this.parseRows(sheetRows);

    // DB 同名衝突檢查（靜默降級：API 失敗不阻擋流程）
    const checkRows: BatchCheckRow[] = parsedRows.map((row) => ({
      parentName: row.parentName,
      parentPhone: row.parentPhone || undefined,
      parentEmail: row.parentEmail || undefined,
    }));

    const dbResult: BatchCheckResponse = await firstValueFrom(
      this.parentsService.batchCheck(checkRows)
    ).catch((): BatchCheckResponse => ({ warnings: [] }));

    for (const w of dbResult.warnings) {
      parsedRows[w.rowIndex]?.warnings.push(w.message);
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

- [ ] **Step 13: Verify TypeScript compiles**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors

- [ ] **Step 14: Commit**

```bash
git add apps/web/src/app/features/admin/pages/parents/parent-import-dialog/parent-import-dialog.component.ts
git commit -m "feat(parent-import-dialog): integrate batchCheck for DB same-name conflict warning"
```

---

## Manual Verification Checklist

After all tasks complete, verify end-to-end in the browser:

- [ ] Upload an Excel with a parent name that **does not exist** in DB → no warning shown
- [ ] Upload an Excel with a parent name that **exists in DB with the same phone** → no warning (will merge, no conflict)
- [ ] Upload an Excel with a parent name that **exists in DB but different phone/email** → `⚠️ 需確認` warning shown in preview table
- [ ] Kill the API dev server, then upload Excel → warning silently skipped, preview shows normally
- [ ] Upload Excel with 0 rows of data → no crash

---

## Notes for Implementor

- The `batch-check` schemas and route handler are inserted **before** the `batch-import` block for readability and logical grouping. Note: `@hono/zod-openapi` (like Hono) gives static paths higher priority than dynamic `/:id` routes regardless of declaration order — there is no routing conflict risk. The ordering is a readability convention only.
- `ParsedRow.index` is 1-based (display row number). `dbResult.warnings[].rowIndex` is 0-based (array index). The line `parsedRows[w.rowIndex]?.warnings.push(w.message)` uses array index directly — this is correct.
- The `?.` optional chaining on `parsedRows[w.rowIndex]` guards against out-of-range rowIndex from a malformed API response.
