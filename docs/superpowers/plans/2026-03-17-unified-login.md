# Unified Login Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `POST /api/parents/login` with a unified `POST /api/login` that supports email and phone for all account types, removes contact fields from `staff` and `parents` tables, and uses manual scrypt verification + session creation.

**Architecture:** Three DB migrations clean the schema (add UNIQUE to `ba_user.phone`, drop `staff.email`/`staff.phone`, drop `parents.email`/`parents.phone`). The new `/api/login` endpoint does a two-step: look up `ba_user` by email or phone, manually verify the scrypt hash from `ba_account`, then call `auth.api.createSession()`. Staff and parents routes JOIN `ba_user` for contact info. Frontend `AuthService.signIn()` hits the new endpoint via plain `fetch`.

**Spec:** `docs/superpowers/specs/2026-03-17-unified-login-design.md`

**Tech Stack:** Hono + `@hono/zod-openapi`, Better Auth (admin + username plugins), Supabase JS client, Node.js `crypto.scrypt`, Angular 21 Signals

---

## Chunk 1: DB Migrations + /api/login

### Task 1: Write migration files (SQL only — do not apply yet)

**Files:**
- Create: `supabase/migrations/20260317000003_unified_login_schema.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260317000003_unified_login_schema.sql
-- Unified login schema changes:
-- 1. Add UNIQUE constraint to ba_user.phone (nullable; PostgreSQL allows multiple NULLs)
-- 2. Remove email/phone from staff (single source of truth: ba_user)
-- 3. Remove email/phone from parents (single source of truth: ba_user)

ALTER TABLE public.ba_user
  ADD CONSTRAINT ba_user_phone_key UNIQUE (phone);

ALTER TABLE public.staff
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS phone;

ALTER TABLE public.parents
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS phone;
```

- [ ] **Step 2: Verify the file exists**

Run: `ls supabase/migrations/20260317000003_unified_login_schema.sql`
Expected: file listed

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260317000003_unified_login_schema.sql
git commit -m "chore: add migration for unified login schema (drop email/phone from staff and parents)"
```

---

### Task 2: New POST /api/login endpoint

**Files:**
- Modify: `apps/api/src/index.ts` (replace `/api/parents/login` with `/api/login`)

The new endpoint:
1. Validates `account` and `password` are present
2. Detects email vs phone (contains `@` → email, otherwise → phone)
3. Looks up `ba_user` by email or phone
4. Checks `staff` and `parents` status — at least one active record must exist (or no records = system account, proceed)
5. Fetches `ba_account` to get password hash
6. Verifies scrypt hash manually
7. Creates a session via Better Auth admin API

- [ ] **Step 1: Write a unit test for the password verification helper**

Create file `apps/api/src/lib/password.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { verifyPassword } from './password';

describe('verifyPassword', () => {
  it('returns true for correct password against stored hash', async () => {
    // This hash is the scrypt hash of 'Test123' used in seed.sql
    // Format: saltHex:keyHex — 32 hex chars salt (16 bytes), 128 hex chars key (64 bytes)
    const storedHash =
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6:6ad04372a2a78a5adde77793f33e0a316de3077333eb0704947f8213c2adac9fdf3713001d762b95d0c259fa048006a2b79b994c79c7de0d380668f31695ce75';
    const result = await verifyPassword('Test123', storedHash);
    expect(result).toBe(true);
  });

  it('returns false for wrong password', async () => {
    const storedHash =
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6:6ad04372a2a78a5adde77793f33e0a316de3077333eb0704947f8213c2adac9fdf3713001d762b95d0c259fa048006a2b79b994c79c7de0d380668f31695ce75';
    const result = await verifyPassword('WrongPassword', storedHash);
    expect(result).toBe(false);
  });

  it('returns false for malformed hash (no colon separator)', async () => {
    const result = await verifyPassword('Test123', 'notavalidhash');
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL (module not found)**

Run: `cd apps/api && npx vitest run src/lib/password.spec.ts`
Expected: FAIL — `Cannot find module './password'`

- [ ] **Step 3: Create the verifyPassword helper**

Create file `apps/api/src/lib/password.ts`:

```typescript
import { promisify } from 'node:util';
import { scrypt } from 'node:crypto';

const scryptAsync = promisify(scrypt);

/**
 * Verifies a plain-text password against a Better Auth scrypt hash.
 *
 * Better Auth hash format: `saltHex:keyHex`
 * - saltHex: 32 hex chars (16-byte salt passed AS HEX STRING to scrypt — not decoded)
 * - keyHex: 128 hex chars (64-byte derived key)
 * - scrypt params: N=16384, r=16, p=1
 * - Password is NFKC-normalized before hashing
 */
export async function verifyPassword(
  inputPassword: string,
  storedHash: string,
): Promise<boolean> {
  const colonIndex = storedHash.indexOf(':');
  if (colonIndex === -1) return false;

  const saltHex = storedHash.slice(0, colonIndex);
  const keyHex = storedHash.slice(colonIndex + 1);

  if (!saltHex || !keyHex) return false;

  try {
    const normalizedPassword = inputPassword.normalize('NFKC');
    // Salt is passed as the hex string itself (not decoded to bytes) — matches Better Auth
    const derivedKey = (await scryptAsync(normalizedPassword, saltHex, 64, {
      N: 16384,
      r: 16,
      p: 1,
    })) as Buffer;
    return derivedKey.toString('hex') === keyHex;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `cd apps/api && npx vitest run src/lib/password.spec.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Replace /api/parents/login with /api/login in index.ts**

In `apps/api/src/index.ts`, remove the entire `app.post('/api/parents/login', ...)` block (lines 147–205) and replace it with:

```typescript
import { verifyPassword } from './lib/password';

// ── Unified login (before authMiddleware) ────────────────────────────────────
// Accepts email or phone. Looks up ba_user, checks status, verifies scrypt hash,
// creates session via Better Auth admin API.
app.post('/api/login', async (c) => {
  const body = await c.req.json<{ account?: string; password?: string }>();
  const account = body.account?.trim();
  const password = body.password;

  if (!account || !password) {
    return c.json({ error: 'account 與 password 為必填', code: 'MISSING_FIELDS' }, 400);
  }

  const supabase = createServiceClientFromEnv(c.env);

  // 1. Look up ba_user by email or phone
  const isEmail = account.includes('@');
  const { data: baUser } = isEmail
    ? await supabase.from('ba_user').select('id, email, phone').eq('email', account).maybeSingle()
    : await supabase.from('ba_user').select('id, email, phone').eq('phone', account).maybeSingle();

  if (!baUser) {
    return c.json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' }, 401);
  }

  // 2. Status check — query both staff and parents
  const [{ data: staffRows }, { data: parentRows }] = await Promise.all([
    supabase.from('staff').select('status').eq('user_id', baUser.id),
    supabase.from('parents').select('status').eq('user_id', baUser.id),
  ]);

  const allRows = [...(staffRows ?? []), ...(parentRows ?? [])];

  if (allRows.length > 0) {
    const hasActive = allRows.some((r: { status: string }) => r.status === 'active');
    if (!hasActive) {
      return c.json({ error: '帳號已停用，請聯繫管理員', code: 'ACCOUNT_DISABLED' }, 401);
    }
  }
  // If no rows in staff or parents → system account (e.g. root), proceed

  // 3. Fetch password hash from ba_account
  const { data: baAccount } = await supabase
    .from('ba_account')
    .select('password')
    .eq('userId', baUser.id)
    .eq('providerId', 'credential')
    .maybeSingle();

  if (!baAccount?.password) {
    return c.json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' }, 401);
  }

  // 4. Verify password
  const valid = await verifyPassword(password, baAccount.password);
  if (!valid) {
    return c.json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' }, 401);
  }

  // 5. Create session and return response with Set-Cookie
  const auth = createAuth(c.env);
  try {
    // Better Auth admin plugin: createSession
    // Server-side action names follow plugin-id prefix convention.
    // Try in order (all use `as any` to bypass TS type check):
    //   (auth.api as any).adminCreateSession(...)   ← flat namespace, likely correct
    //   (auth.api as any).admin?.createSession(...)  ← nested, per spec notation
    // To confirm at runtime: console.log(Object.keys(auth.api))
    const sessionRes = await (auth.api as any).adminCreateSession({
      body: { userId: baUser.id },
      asResponse: true,
    });
    return sessionRes;
  } catch {
    return c.json({ error: 'Session creation failed', code: 'SESSION_ERROR' }, 500);
  }
});
```

Also add the import at the top of index.ts:
```typescript
import { verifyPassword } from './lib/password';
```

> **Note:** The Better Auth admin `createSession` method name must be verified from the type system. Run `cd apps/api && npx tsc --noEmit` after writing and check the error if `adminCreateSession` doesn't exist. Alternative names to try: `createSession`, `adminCreateSession`, or inspect `Object.keys(auth.api)` at runtime.

- [ ] **Step 6: Build check — verify createSession method name**

Run: `cd apps/api && npx tsc --noEmit`

If TypeScript errors on `auth.api.createSession` not found:
1. Check Better Auth admin plugin types: `node_modules/better-auth/plugins/admin/index.d.ts`
2. Try `(auth.api as any).createSession(...)` as fallback
3. Or add a runtime probe before deploying: temporarily add `console.log(Object.keys(auth.api))` to see available methods

Expected: 0 errors

- [ ] **Step 7: Run existing tests to ensure no regression**

Run: `cd apps/api && npx vitest run`
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/password.ts apps/api/src/lib/password.spec.ts apps/api/src/index.ts
git commit -m "feat: add POST /api/login with manual scrypt verification and createSession"
```

---

## Chunk 2: Staff + Parents route refactoring

### Task 3: Staff routes — read path (GET, LIST, search)

**Files:**
- Modify: `apps/api/src/routes/staff.ts`

Currently, `mapStaff()` reads `email` and `phone` from the `staff` row. After the migration, these columns don't exist. We need to read them from `ba_user`.

**Changes needed:**
- Add a `baUserMap` to `loadStaffRelations()` to batch-fetch `ba_user` data
- Update `mapStaff()` to accept `baUser?: { email: string | null; phone: string | null }`
- Update `getStaffById()` to also fetch `ba_user` data
- Update the search query to first look up matching `ba_user` IDs, then filter staff

- [ ] **Step 1: Write a unit test for the `buildStaffSummary` helper (it should still pass after changes)**

Run: `cd apps/api && npx vitest run src/routes/staff.spec.ts`
Expected: all pass (no changes needed here, just verify baseline)

- [ ] **Step 2: Update `loadStaffRelations` to batch-fetch ba_user**

In `apps/api/src/routes/staff.ts`, update `loadStaffRelations()` (currently around line 383):

```typescript
async function loadStaffRelations(
  supabase: SupabaseClient,
  staffRows: Record<string, unknown>[],
): Promise<{
  campusMap: Map<string, string[]>;
  subjectMap: Map<string, SubjectInfo>;
  roleInfoMap: Map<string, RoleInfo>;
  baUserMap: Map<string, { email: string | null; phone: string | null }>;
}> {
  const staffIds = staffRows.map((row) => row['id'] as string);
  const userIds = staffRows.map((row) => row['user_id'] as string);

  if (staffIds.length === 0 || userIds.length === 0) {
    return {
      campusMap: new Map(),
      subjectMap: new Map(),
      roleInfoMap: new Map(),
      baUserMap: new Map(),
    };
  }

  const [{ data: campusRows }, { data: subjectRows }, { data: roleRows }, { data: baUserRows }] =
    await Promise.all([
      supabase
        .from('staff_campuses')
        .select('staff_id, campus_id, campuses!inner(id)')
        .in('staff_id', staffIds),
      supabase
        .from('staff_subjects')
        .select('staff_id, subject_id, subjects(name)')
        .in('staff_id', staffIds),
      supabase.from('user_roles').select('user_id, role, permissions').in('user_id', userIds),
      supabase.from('ba_user').select('id, email, phone').in('id', userIds),
    ]);

  const filteredRoleRows = (roleRows || []).filter(
    (row) => row.role === 'admin' || row.role === 'teacher',
  ) as UserRoleRow[];

  const baUserMap = new Map<string, { email: string | null; phone: string | null }>();
  for (const u of baUserRows ?? []) {
    baUserMap.set(u.id as string, {
      email: (u.email as string | null) ?? null,
      phone: (u.phone as string | null) ?? null,
    });
  }

  return {
    campusMap: toCampusMap((campusRows || []) as StaffCampusRow[]),
    subjectMap: toSubjectMap((subjectRows || []) as StaffSubjectRow[]),
    roleInfoMap: toRoleInfoMap(filteredRoleRows),
    baUserMap,
  };
}
```

- [ ] **Step 3: Update `mapStaff` to accept and use baUserMap**

Update `mapStaff()` signature and body:

```typescript
function mapStaff(
  row: Record<string, unknown>,
  campusMap: Map<string, string[]>,
  subjectMap: Map<string, SubjectInfo>,
  roleInfoMap: Map<string, RoleInfo>,
  baUserMap: Map<string, { email: string | null; phone: string | null }>,
) {
  const userId = row['user_id'] as string;
  const staffId = row['id'] as string;
  const roleInfo = roleInfoMap.get(userId) ?? { roles: [] as StaffRole[], permissions: [] };
  const baUser = baUserMap.get(userId) ?? { email: null, phone: null };

  return {
    id: staffId,
    userId,
    orgId: row['org_id'] as string,
    displayName: row['display_name'] as string,
    phone: baUser.phone,
    email: baUser.email ?? '',
    birthday: row['birthday'] as string | null,
    notes: row['notes'] as string | null,
    subjectIds: subjectMap.get(staffId)?.ids ?? [],
    subjectNames: subjectMap.get(staffId)?.names ?? [],
    status: row['status'] as 'active' | 'inactive' | 'archived',
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
    campusIds: campusMap.get(staffId) || [],
    roles: roleInfo.roles,
    permissions: roleInfo.permissions,
  };
}
```

- [ ] **Step 4: Update all `mapStaff` call sites to pass `baUserMap`**

There are two call sites: in the LIST handler and the GET handler. Update both:

**LIST handler** (around line 633):
```typescript
const { campusMap, subjectMap, roleInfoMap, baUserMap } = await loadStaffRelations(supabase, staffRows);
const staffList = staffRows.map((row) => mapStaff(row, campusMap, subjectMap, roleInfoMap, baUserMap));
```

**GET handler** (around line 743):
```typescript
const { campusMap, subjectMap, roleInfoMap, baUserMap } = await loadStaffRelations(supabase, [staffRow]);
return c.json({ data: mapStaff(staffRow, campusMap, subjectMap, roleInfoMap, baUserMap) }, 200);
```

**CREATE handler** (around line 969):
```typescript
const { campusMap, subjectMap, roleInfoMap, baUserMap } = await loadStaffRelations(supabase, [freshStaffRow]);
return c.json({ data: mapStaff(freshStaffRow, campusMap, subjectMap, roleInfoMap, baUserMap), initialPassword: password }, 201);
```

**UPDATE handler** — find the block near the bottom of the `app.openapi(updateRoute, ...)` handler where `freshStaffRow` is read after all updates. It looks like:
```typescript
// OLD (find this block):
const freshStaffRow = await getStaffById(supabase, id);
// ...
const { campusMap, subjectMap, roleInfoMap } = await loadStaffRelations(supabase, [freshStaffRow]);
return c.json({ data: mapStaff(freshStaffRow, campusMap, subjectMap, roleInfoMap) }, 200);

// REPLACE the last two lines with:
const { campusMap, subjectMap, roleInfoMap, baUserMap } = await loadStaffRelations(supabase, [freshStaffRow]);
return c.json({ data: mapStaff(freshStaffRow, campusMap, subjectMap, roleInfoMap, baUserMap) }, 200);
```

- [ ] **Step 5: Update the LIST search query to use two-step ba_user lookup**

Currently (around line 603):
```typescript
if (query.search) {
  dbQuery = dbQuery.or(`display_name.ilike.%${query.search}%,email.ilike.%${query.search}%`);
}
```

Replace with:
```typescript
if (query.search) {
  // First: find ba_user IDs matching email or phone
  const { data: baMatches } = await supabase
    .from('ba_user')
    .select('id')
    .or(`email.ilike.%${query.search}%,phone.ilike.%${query.search}%`);
  const matchingUserIds = (baMatches ?? []).map((u: { id: string }) => u.id);

  if (matchingUserIds.length > 0) {
    dbQuery = dbQuery.or(
      `display_name.ilike.%${query.search}%,user_id.in.(${matchingUserIds.join(',')})`,
    );
  } else {
    dbQuery = dbQuery.ilike('display_name', `%${query.search}%`);
  }
}
```

Also update the **summary search** (around line 640) the same way:
```typescript
if (query.search) {
  const { data: baMatchesSummary } = await supabase
    .from('ba_user')
    .select('id')
    .or(`email.ilike.%${query.search}%,phone.ilike.%${query.search}%`);
  const matchingUserIdsSummary = (baMatchesSummary ?? []).map((u: { id: string }) => u.id);

  if (matchingUserIdsSummary.length > 0) {
    summaryQuery = summaryQuery.or(
      `display_name.ilike.%${query.search}%,user_id.in.(${matchingUserIdsSummary.join(',')})`,
    );
  } else {
    summaryQuery = summaryQuery.ilike('display_name', `%${query.search}%`);
  }
}
```

- [ ] **Step 6: Build check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 7: Run all tests**

Run: `cd apps/api && npx vitest run`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/staff.ts
git commit -m "refactor: staff routes read email/phone from ba_user instead of staff table"
```

---

### Task 4: Staff routes — write path (CREATE, UPDATE)

**Files:**
- Modify: `apps/api/src/routes/staff.ts`

Currently the CREATE writes `email` and `phone` to the `staff` table. After the migration, these columns won't exist. The UPDATE currently writes `phone` to the `staff` table.

> **Note — staff ban calls:** The spec (Schema Changes §4) mentions removing `ba_user.banned` calls from `PATCH /api/staff/:id/deactivate|activate|archive`. The current staff routes do **not** call `banUser`/`unbanUser` — no changes needed for staff status routes on this front.

- [ ] **Step 1: Update CREATE handler — remove email/phone from staff INSERT**

In the CREATE handler (around line 884), find:
```typescript
const { data: staffRow, error: insertStaffError } = await supabase
  .from('staff')
  .insert({
    user_id: createdUserId,
    org_id: orgId,
    display_name: body.displayName,
    phone: body.phone || null,
    email: body.email,
    birthday: body.birthday || null,
    notes: body.notes || null,
    status: 'active',
  })
```

Replace with (remove `phone` and `email`):
```typescript
const { data: staffRow, error: insertStaffError } = await supabase
  .from('staff')
  .insert({
    user_id: createdUserId,
    org_id: orgId,
    display_name: body.displayName,
    birthday: body.birthday || null,
    notes: body.notes || null,
    status: 'active',
  })
```

- [ ] **Step 2: Update CREATE handler — add phone to createUser + write to ba_user**

**2a.** First, update the `auth.api.createUser()` call (around line 832) to include phone:

```typescript
// FIND the existing createUser call body:
const newUser = await auth.api.createUser({
  body: {
    name: body.displayName,
    email: body.email,
    password,
    data: { display_name: body.displayName },
  },
  asResponse: false,
});

// REPLACE with (add phone field):
const newUser = await auth.api.createUser({
  body: {
    name: body.displayName,
    email: body.email,
    phone: body.phone ?? undefined,   // writes to ba_user.phone via additionalField
    password,
    data: { display_name: body.displayName },
  },
  asResponse: false,
});
```

**2b.** After the `update orgId` block (after line ~882), also write phone directly to confirm it's set (belt-and-suspenders, harmless if createUser already wrote it):

```typescript
// Write phone to ba_user if provided
if (body.phone) {
  await supabase.from('ba_user').update({ phone: body.phone }).eq('id', createdUserId);
}
```

- [ ] **Step 3: Update UPDATE handler — remove phone from staff updateData, sync to ba_user**

In the update handler (around line 1069), find:
```typescript
if (body.phone !== undefined) updateData['phone'] = body.phone;
```

Remove that line. Instead, after the staff UPDATE block, add a ba_user phone sync:

```typescript
// Sync phone to ba_user (staff.phone column no longer exists)
if (body.phone !== undefined) {
  await supabase.from('ba_user').update({ phone: body.phone }).eq('id', userId);
}
```

Where `userId = staffRow['user_id'] as string` (already defined earlier in the handler as `const userId = staffRow['user_id'] as string;`).

> **Note — staff email update:** The `UpdateStaffSchema` does **not** include an `email` field. Staff email is set at CREATE time and cannot be changed via `PUT /api/staff/:id`. No email sync needed in the UPDATE handler.

- [ ] **Step 4: Build check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Run all tests**

Run: `cd apps/api && npx vitest run`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/staff.ts
git commit -m "refactor: staff CREATE/UPDATE write phone to ba_user, remove from staff table"
```

---

### Task 5: Parents routes — read path (GET, LIST, search)

**Files:**
- Modify: `apps/api/src/routes/parents.ts`

Currently, `toParentResponse()` reads `email` and `phone` from the parent row. After the migration, these don't exist in `parents`. We need to enrich from `ba_user`.

- [ ] **Step 1: Run existing parents tests to establish baseline**

Run: `cd apps/api && npx vitest run src/routes/parents.spec.ts`
Expected: all pass

- [ ] **Step 2: Update `toParentResponse` to accept optional baUser override**

Find `toParentResponse` (around line 94):
```typescript
export function toParentResponse(row: Record<string, unknown>, studentCount = 0) {
  const email = (row['email'] as string | null) ?? null;
  const phone = (row['phone'] as string | null) ?? null;
  return {
    ...
  };
}
```

Replace with:
```typescript
export function toParentResponse(
  row: Record<string, unknown>,
  studentCount = 0,
  baUser?: { email: string | null; phone: string | null },
) {
  const email = baUser?.email ?? (row['email'] as string | null) ?? null;
  const phone = baUser?.phone ?? (row['phone'] as string | null) ?? null;
  return {
    id: row['id'] as string,
    userId: row['user_id'] as string,
    orgId: row['org_id'] as string,
    name: row['name'] as string,
    phone,
    email,
    loginAccount: email ?? phone ?? '',
    status: row['status'] as string,
    studentCount,
    notes: (row['notes'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}
```

This is backward-compatible: existing tests still pass because they don't pass `baUser` and the function falls back to `row['email']`/`row['phone']`.

- [ ] **Step 3: Run tests — expect still PASS (backward compatible)**

Run: `cd apps/api && npx vitest run src/routes/parents.spec.ts`
Expected: all pass

- [ ] **Step 4: Update LIST handler — batch-fetch ba_user for contact info**

In the LIST handler, after fetching `data` from `supabase.from('parents')`, add a batch ba_user fetch and build a map:

```typescript
const rows = (data ?? []) as Array<Record<string, unknown>>;

// Batch-fetch ba_user for contact info (email/phone moved from parents to ba_user)
const userIds = rows.map((r) => r['user_id'] as string).filter(Boolean);
const baUserMap = new Map<string, { email: string | null; phone: string | null }>();
if (userIds.length > 0) {
  const { data: baUsers } = await supabase
    .from('ba_user')
    .select('id, email, phone')
    .in('id', userIds);
  for (const u of baUsers ?? []) {
    baUserMap.set(u.id as string, {
      email: (u.email as string | null) ?? null,
      phone: (u.phone as string | null) ?? null,
    });
  }
}

const total = count ?? 0;
const parents = rows.map((row) =>
  toParentResponse(
    row,
    studentCountMap.get(row['id'] as string) ?? 0,
    baUserMap.get(row['user_id'] as string),
  ),
);
```

- [ ] **Step 5: Update LIST search to use two-step ba_user lookup**

Currently (around line 188):
```typescript
if (search) {
  query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
}
```

Replace with:
```typescript
if (search) {
  // Find ba_user IDs matching email or phone
  const { data: baMatches } = await supabase
    .from('ba_user')
    .select('id')
    .or(`email.ilike.%${search}%,phone.ilike.%${search}%`);
  const matchingUserIds = (baMatches ?? []).map((u: { id: string }) => u.id);

  if (matchingUserIds.length > 0) {
    query = query.or(
      `name.ilike.%${search}%,user_id.in.(${matchingUserIds.join(',')})`,
    );
  } else {
    query = query.ilike('name', `%${search}%`);
  }
}
```

- [ ] **Step 6: Update GET /api/parents/:id to fetch ba_user**

In the GET handler, after fetching the parent row, add a ba_user fetch:

```typescript
const row = data as Record<string, unknown>;

// Fetch contact info from ba_user
const { data: baUserData } = await supabase
  .from('ba_user')
  .select('email, phone')
  .eq('id', row['user_id'] as string)
  .maybeSingle();
const baUser = baUserData
  ? { email: baUserData.email as string | null, phone: baUserData.phone as string | null }
  : undefined;

// ... (rest of the handler, pass baUser to toParentResponse)
return c.json(
  { data: { ...toParentResponse(row, students.length, baUser), students } },
  200,
);
```

- [ ] **Step 7: Build check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 8: Run tests**

Run: `cd apps/api && npx vitest run src/routes/parents.spec.ts`
Expected: all pass

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/parents.ts
git commit -m "refactor: parents routes read email/phone from ba_user, update search to join ba_user"
```

---

### Task 6: Parents routes — write path + remove banned calls

**Files:**
- Modify: `apps/api/src/routes/parents.ts`

Changes:
1. CREATE: remove `email`/`phone` from `parents` INSERT; phone already written to ba_user via `createUser` (phone is in additionalFields)
2. UPDATE: remove `email`/`phone` from `parents` UPDATE; sync email via `auth.api.updateUser`, sync phone directly via supabase
3. activate/deactivate/archive: remove all `ba_user.banned` calls

- [ ] **Step 1: Update CREATE handler — remove email/phone from parents INSERT**

Find in CREATE handler (around line 312):
```typescript
const { data: parentRow, error: insertError } = await supabase
  .from('parents')
  .insert({
    user_id: createdUserId,
    org_id: orgId,
    name: body.name,
    email: body.email ?? null,
    phone: body.phone ?? null,
    notes: body.notes ?? null,
    status: 'active',
  })
```

Replace with:
```typescript
const { data: parentRow, error: insertError } = await supabase
  .from('parents')
  .insert({
    user_id: createdUserId,
    org_id: orgId,
    name: body.name,
    notes: body.notes ?? null,
    status: 'active',
  })
```

Also in the `createUser` call (around line 270), update to write phone:

```typescript
const newUser = await auth.api.createUser({
  body: {
    name: body.name,
    email: body.email ?? undefined,
    phone: body.phone ?? undefined,   // writes to ba_user.phone (additionalField, input: true)
    // phone-only accounts strategy:
    // Better Auth requires email OR username to create a credential account.
    // Attempt WITHOUT username first (BA username plugin may accept phone-only via additionalField).
    // If createUser throws "email or username required" for phone-only parents,
    // add: username: !body.email && body.phone ? body.phone : undefined
    // The /api/login endpoint does NOT use username — it looks up ba_user.phone directly.
    password,
  },
  asResponse: false,
});
```

- [ ] **Step 2: Update UPDATE handler — remove email/phone from parents UPDATE**

Find in PUT handler (around line 480):
```typescript
if (body.email !== undefined) updatePayload['email'] = body.email;
if (body.phone !== undefined) updatePayload['phone'] = body.phone;
```

Remove both lines.

Then update the ba_user sync block. Find the email sync (around line 500):
```typescript
if (body.email !== undefined && body.email !== (existingRow['email'] as string | null)) {
  try {
    await auth.api.updateUser({
      body: { userId, email: body.email ?? undefined },
      asResponse: false,
    });
  } catch {
    // best effort
  }
}
```

Keep the email sync but remove the condition comparing to `existingRow['email']` (we can't read that from parents anymore). Simplify to:
```typescript
// Sync email to ba_user
if (body.email !== undefined) {
  try {
    await auth.api.updateUser({
      body: { userId, email: body.email ?? undefined },
      asResponse: false,
    });
  } catch {
    // best effort — duplicate email handled by BA
  }
}

// Sync phone to ba_user
if (body.phone !== undefined) {
  await supabase.from('ba_user').update({ phone: body.phone }).eq('id', userId);
}
```

- [ ] **Step 3: Remove ba_user.banned calls from activate handler**

Find activate handler (around line 670):
```typescript
// 解除 ba_user.banned
const { error: banError } = await supabase
  .from('ba_user')
  .update({ banned: false })
  .eq('id', (parentRow as Record<string, unknown>)['user_id'] as string);

if (banError) {
  return c.json({ error: banError.message, code: 'DB_ERROR' }, 400);
}
```

Delete this entire block (7 lines). Status is managed via `parents.status` only.

- [ ] **Step 4: Remove ba_user.banned calls from deactivate handler**

Find deactivate handler (around line 741):
```typescript
// 設定 ba_user.banned = true
const { error: banError } = await supabase
  .from('ba_user')
  .update({ banned: true })
  .eq('id', (parentRow as Record<string, unknown>)['user_id'] as string);

if (banError) {
  return c.json({ error: banError.message, code: 'DB_ERROR' }, 400);
}
```

Delete this entire block.

- [ ] **Step 5: Remove ba_user.banned calls from archive handler**

Find archive handler (around line 815):
```typescript
// 設定 ba_user.banned = true
const { error: banError } = await supabase
  .from('ba_user')
  .update({ banned: true })
  .eq('id', (parentRow as Record<string, unknown>)['user_id'] as string);

if (banError) {
  return c.json({ error: banError.message, code: 'DB_ERROR' }, 400);
}
```

Delete this entire block.

- [ ] **Step 6: Build check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 7: Run all tests**

Run: `cd apps/api && npx vitest run`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/parents.ts
git commit -m "refactor: parents write email/phone to ba_user, remove banned calls from status routes"
```

---

## Chunk 3: Seed + Frontend + DB Verification

### Task 7: Update seed.sql — remove email/phone from staff and parents INSERTs

**Files:**
- Modify: `supabase/seed.sql`

The migration drops `staff.email`, `staff.phone`, `parents.email`, `parents.phone`. The seed must not insert into these columns.

- [ ] **Step 1: Remove email/phone from the 11 admin staff INSERT (around line 258)**

Find:
```typescript
INSERT INTO public.staff (user_id, org_id, display_name, phone, email, status)
VALUES (
    admin_user_id,
    demo_org_id,
    format('管理員%s', lpad(staff_index::text, 2, '0')),
    format('0911%06s', lpad(staff_index::text, 6, '0')),
    'admin' || lpad(staff_index::text, 2, '0') || '@demo.clessia.app',
    'active'
)
ON CONFLICT (user_id, org_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    phone = EXCLUDED.phone,
    email = EXCLUDED.email,
    status = EXCLUDED.status,
```

Replace with:
```sql
INSERT INTO public.staff (user_id, org_id, display_name, status)
VALUES (
    admin_user_id,
    demo_org_id,
    format('管理員%s', lpad(staff_index::text, 2, '0')),
    'active'
)
ON CONFLICT (user_id, org_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    status = EXCLUDED.status,
```

- [ ] **Step 2: Remove email/phone from the teacher staff INSERT (around line 345)**

Find:
```sql
INSERT INTO public.staff (user_id, org_id, display_name, phone, email, status)
VALUES (
    teacher_user_id,
    demo_org_id,
    v_teacher_display_name,
    '0922' || lpad(teacher_index::text, 6, '0'),
    format('teacher%s@demo.clessia.app', lpad(teacher_index::text, 4, '0')),
    'active'
)
ON CONFLICT (user_id, org_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    phone = EXCLUDED.phone,
    email = EXCLUDED.email,
    status = EXCLUDED.status,
```

Replace with:
```sql
INSERT INTO public.staff (user_id, org_id, display_name, status)
VALUES (
    teacher_user_id,
    demo_org_id,
    v_teacher_display_name,
    'active'
)
ON CONFLICT (user_id, org_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    status = EXCLUDED.status,
```

- [ ] **Step 3: Remove email/phone from parents INSERT (around line 469)**

Find:
```sql
INSERT INTO public.parents (org_id, user_id, name, phone, email, status)
VALUES (
  demo_org_id,
  v_parent_user_id,
  parent_last_names[...] || parent_given_names[...],
  '09' || LPAD(...),
  'parent' || ... || '@demo.clessia.app',
  'active'
)
```

Replace with (note: the `[((student_index - 1) % 8) + 1]` is real PostgreSQL array subscript syntax, not a placeholder):
```sql
INSERT INTO public.parents (org_id, user_id, name, status)
VALUES (
  demo_org_id,
  v_parent_user_id,
  parent_last_names[((student_index - 1) % 8) + 1] || parent_given_names[((student_index - 1) % 8) + 1],
  'active'
)
-- No ON CONFLICT clause: the cleanup DELETE at the top of this DO block
-- already removes all demo parents before re-inserting (idempotency via DELETE).
```

Note: email and phone are already in `ba_user` (written by the `ba_user` INSERT above). The `parents` table no longer has email/phone columns after the migration.

- [ ] **Step 4: Commit**

```bash
git add supabase/seed.sql
git commit -m "chore: remove email/phone from staff and parents seed INSERTs (now in ba_user)"
```

---

### Task 8: Frontend — AuthService.signIn()

**Files:**
- Modify: `apps/web/src/app/core/auth.service.ts`

Currently `signIn()` calls `authClient.signIn.email()`. Replace with a plain `fetch` to `/api/login`. After the fetch succeeds, call `authClient.getSession()` to sync the client state.

- [ ] **Step 1: Update `signIn()` method in AuthService**

In `apps/web/src/app/core/auth.service.ts`, find and replace the entire `signIn()` method.

Find anchor (old signature + first line of body):
```typescript
async signIn(email: string, password: string, _captchaToken?: string): Promise<string | null> {
  const { data, error } = await authClient.signIn.email({
```

Replace the entire method (lines 116–130):

```typescript
async signIn(account: string, password: string, _captchaToken?: string): Promise<string | null> {
  const res = await fetch(`${environment.apiUrl}/api/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if ((body as { code?: string }).code === 'ACCOUNT_DISABLED') {
      return '帳號已停用，請聯繫管理員';
    }
    return '帳號或密碼錯誤';
  }

  // Session cookie is now set. Sync client state.
  const { data: session } = await authClient.getSession();
  this._user.set(session?.user ?? null);
  await this.loadProfile();
  return null;
}
```

- [ ] **Step 2: Build check (Angular)**

Run: `cd apps/web && npx ng build --configuration development`
Expected: build succeeds with 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/core/auth.service.ts
git commit -m "feat: AuthService.signIn() uses POST /api/login instead of authClient.signIn.email"
```

---

### Task 9: Apply migrations and verify end-to-end

- [ ] **Step 1: Reset the local database**

Run: `supabase db reset`
Expected:
```
Resetting database...
Applying migration 20260208000001_profiles.sql...
...
Applying migration 20260317000003_unified_login_schema.sql...
Seeding...
Finished supabase db reset.
```

If seed fails with a column error (`email`, `phone`), check that Task 7 changes are complete.

- [ ] **Step 2: Start the API server**

Run: `cd apps/api && npx wrangler dev --local` (keep running in background)

- [ ] **Step 3: Test root login via /api/login (email)**

```bash
curl -s -c /tmp/cookies.txt -X POST http://localhost:8787/api/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"root@clessia.com","password":"Test123"}'
```
Expected: `200 OK` with a JSON body containing user info and `Set-Cookie` headers.

- [ ] **Step 4: Test admin login via /api/login**

Admin seed password is `password123` (see `demo_admin_password_hash` in seed.sql).

```bash
curl -s -X POST http://localhost:8787/api/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"admin@demo.clessia.app","password":"password123"}'
```
Expected: `200 OK`

- [ ] **Step 5: Test wrong password**

```bash
curl -s -X POST http://localhost:8787/api/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"root@clessia.com","password":"WrongPassword"}'
```
Expected: `401` with `INVALID_CREDENTIALS`

- [ ] **Step 6: Test parent login via email**

Parent email is in `ba_user` (seed inserts it at `ba_user.email = 'parent01@demo.clessia.app'`).
Parent seed password is `Demo1234!` (see `demo_parent_password_hash` in seed.sql).

```bash
curl -s -X POST http://localhost:8787/api/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"parent01@demo.clessia.app","password":"Demo1234!"}'
```
Expected: `200 OK`

- [ ] **Step 7: Test /api/parents/login is gone (404)**

```bash
curl -s -X POST http://localhost:8787/api/parents/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"parent01@demo.clessia.app","password":"Demo1234!"}'
```
Expected: `404 Not Found`

- [ ] **Step 8: Verify staff GET returns email/phone from ba_user**

```bash
# First get a token via login
curl -s -c /tmp/cookies.txt -X POST http://localhost:8787/api/login \
  -H 'Content-Type: application/json' \
  -d '{"account":"root@clessia.com","password":"Test123"}'

# Then fetch staff list
curl -s -b /tmp/cookies.txt http://localhost:8787/api/staff
```
Expected: staff list with `email` and `phone` fields populated from ba_user.

- [ ] **Step 9: Start web dev server and test login UI**

Run: `cd apps/web && npx ng serve` (in background)

Navigate to `http://localhost:4200/login`:
- Login with `root@clessia.com` / `Test123` → succeeds, navigates to admin shell
- Login with wrong password → shows "帳號或密碼錯誤"
- Password reveal button works (eye icon toggles)

- [ ] **Step 10: Run all API unit tests**

Run: `cd apps/api && npx vitest run`
Expected: all pass

- [ ] **Step 11: Final commit (if any uncommitted changes remain)**

```bash
git status
# Stage only changed project files — do NOT use git add -A
git add supabase/migrations/20260317000003_unified_login_schema.sql \
        supabase/seed.sql \
        apps/api/src/index.ts \
        apps/api/src/lib/password.ts \
        apps/api/src/lib/password.spec.ts \
        apps/api/src/routes/staff.ts \
        apps/api/src/routes/parents.ts \
        apps/web/src/app/core/auth.service.ts
git commit -m "chore: verify unified login implementation complete"
```
