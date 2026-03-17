# Unified Login Design

## Goal

Replace role-specific login endpoints with a single `POST /api/login` that accepts email or phone number, supports staff and parent accounts, and enforces account status before returning a session.

## Background

- Parents had `POST /api/parents/login` using reverse-lookup from the `parents` table.
- Staff could only log in with email via Better Auth directly.
- Phone numbers were duplicated across `ba_user.phone`, `staff.phone`, and `parents.phone`.
- This design unifies login, makes `ba_user` the single source of truth for credentials, and eliminates redundant contact fields.

---

## Scope

`POST /api/login` covers **all accounts** — staff, parents, and system accounts (e.g. `root`). All accounts authenticate via email (`root@clessia.com`) or phone number. There is no separate endpoint for system accounts.

---

## Credential Strategy

Password verification is done manually against Better Auth's stored hash, bypassing `signInEmail` / `signInUsername`. This allows a single code path regardless of whether the account has an email or is phone-only.

**Flow:**
1. Look up `ba_user` by email or phone → obtain `ba_user.id`
2. Query `ba_account WHERE userId = ba_user.id AND providerId = 'credential'` → get `password` field (format: `saltHex:keyHex`)
3. Derive key: `scrypt(inputPassword.normalize('NFKC'), saltHex, { N: 16384, r: 16, p: 1, dkLen: 64 })`
   - `saltHex` is passed as a hex string (not decoded to bytes) — matching Better Auth's own implementation
4. Compare derived hex key with stored `keyHex`
5. On match → call `auth.api.admin.createSession({ userId: ba_user.id, asResponse: true })` and forward response to client

**Why not `signInEmail` / `signInUsername`?**
Better Auth has no `signInByUserId`. For phone-only accounts there is no email to pass. Storing `username = phone` as a workaround works technically but is a design smell. Manual verification + `createSession` is cleaner and treats all account types uniformly.

**`ba_user` lookup summary:**

| Input type | Lookup column | Notes |
|---|---|---|
| Contains `@` | `ba_user.email` | Standard email accounts |
| Otherwise | `ba_user.phone` | Phone-only parents |

Phone-only accounts have `ba_user.email = NULL`. No username field is overloaded.

---

## Schema Changes

### 1. `ba_user.phone` — add UNIQUE constraint

```sql
ALTER TABLE ba_user ADD CONSTRAINT ba_user_phone_key UNIQUE (phone);
```

`ba_user.phone` is nullable. PostgreSQL allows multiple NULLs under a UNIQUE constraint.

### 2. Remove `staff.email` and `staff.phone`

```sql
ALTER TABLE staff DROP COLUMN email;
ALTER TABLE staff DROP COLUMN phone;
```

Contact info is served by JOINing `ba_user`. Staff must always have an email (email-only accounts).

**JOIN note:** `staff.user_id` is UUID but `ba_user.id` is TEXT. Join with a cast: `JOIN ba_user u ON u.id = s.user_id::text`.

**Application code to update simultaneously:**
- `staff.ts` CREATE: remove `email` / `phone` from `staff` INSERT; write email/phone to `ba_user` via `auth.api.admin.createUser()`
- `staff.ts` UPDATE: remove `email` / `phone` from `staff` UPDATE SET; sync changes to `ba_user` via `auth.api.admin.updateUser()`
- `staff.ts` LIST / GET: JOIN `ba_user` to include `email` and `phone` in response
- `staff.ts` SEARCH: rewrite to query `ba_user` columns (see Search Queries section)
- `StaffSchema`: `email` remains required (staff must have email); `phone` becomes optional

### 3. Remove `parents.email` and `parents.phone`

```sql
ALTER TABLE parents DROP COLUMN email;
ALTER TABLE parents DROP COLUMN phone;
```

**Application code to update simultaneously:**
- `parents.ts` CREATE: remove `email` / `phone` from `parents` INSERT; write to `ba_user` via `auth.api.admin.createUser()`
- `parents.ts` UPDATE: remove `email` / `phone` from `parents` UPDATE SET; sync changes to `ba_user` via `auth.api.admin.updateUser()`
- `parents.ts` LIST / GET: JOIN `ba_user` to include `email` and `phone` in response
- `parents.ts` SEARCH: rewrite to query `ba_user` columns (see Search Queries section)
- `ParentSchema`: `email` and `phone` remain optional (at least one required); both come from `ba_user`

### 4. Remove `ba_user.banned` usage from status-change flows

`ba_user.banned` is **not used** for business accounts. Status is managed exclusively via `staff.status` and `parents.status`. The following routes must stop calling `banUser()` / `unbanUser()`:

- `PATCH /api/parents/:id/deactivate`
- `PATCH /api/parents/:id/activate`
- `PATCH /api/parents/:id/archive`
- Same three routes on `PATCH /api/staff/:id/...` (if they call ban)

### 5. Search Query Strategy

Since `email` and `phone` are removed from `staff` and `parents`, search queries must JOIN `ba_user`. Use Supabase's `.select()` with a relation join, or raw SQL via `supabase.rpc()`.

**Parents search example:**

```sql
SELECT p.id, p.name, p.status, p.user_id,
       u.email, u.phone
FROM parents p
JOIN ba_user u ON u.id = p.user_id
WHERE p.org_id = $org_id
  AND (
    p.name ILIKE '%' || $search || '%'
    OR u.email ILIKE '%' || $search || '%'
    OR u.phone ILIKE '%' || $search || '%'
  )
LIMIT $limit OFFSET $offset;
```

**Staff search example:**

```sql
SELECT s.id, s.display_name, s.status, s.user_id,
       u.email, u.phone
FROM staff s
JOIN ba_user u ON u.id = s.user_id
WHERE s.org_id = $org_id
  AND (
    s.display_name ILIKE '%' || $search || '%'
    OR u.email ILIKE '%' || $search || '%'
    OR u.phone ILIKE '%' || $search || '%'
  )
LIMIT $limit OFFSET $offset;
```

---

## API

### New endpoint: `POST /api/login`

Public route (before `authMiddleware`). Replaces `POST /api/parents/login`.

**Request body:**

```json
{ "account": "string", "password": "string" }
```

**Flow:**

```
1. Validate: account and password must be present → 400 MISSING_FIELDS

2. Detect input type
   contains "@" → email
   otherwise   → phone

3. Look up ba_user (parameterised .eq(), no string interpolation)
   email → ba_user WHERE email = account
   phone → ba_user WHERE phone = account
   Not found → 401 INVALID_CREDENTIALS

4. Status check
   Query staff  WHERE user_id = ba_user.id
   Query parents WHERE user_id = ba_user.id

   - If in staff AND staff.status ≠ active → staff_blocked
   - If in parents AND parents.status ≠ active → parent_blocked
   - If ALL found records are blocked → 401 ACCOUNT_DISABLED
   - If at least one record is active → proceed
   - If no records in either table → proceed (system account, e.g. root)

5. Verify password manually
   Query ba_account WHERE userId = ba_user.id AND providerId = 'credential'
   Not found → 401 INVALID_CREDENTIALS
   Split stored password field → saltHex:keyHex
   Derive: scrypt(inputPassword.normalize('NFKC'), saltHex, { N: 16384, r: 16, p: 1, dkLen: 64 })
   Compare derived hex with keyHex
   Mismatch → 401 INVALID_CREDENTIALS

6. Create session
   auth.api.admin.createSession({ userId: ba_user.id, asResponse: true })
   Forward raw response to client (includes Set-Cookie)
```

**Error responses:**

| Scenario | HTTP | Code |
|---|---|---|
| Missing fields | 400 | `MISSING_FIELDS` |
| Not found / wrong password | 401 | `INVALID_CREDENTIALS` |
| All roles blocked | 401 | `ACCOUNT_DISABLED` |

**Security note:** `ACCOUNT_DISABLED` confirms the account exists but is disabled. This is an intentional UX trade-off — a disabled user deserves a clear message rather than "帳號或密碼錯誤". Acceptable in a closed cram school system.

### Deprecated: `POST /api/parents/login`

Remove this endpoint entirely.

---

## Frontend Changes

### `AuthService.signIn()`

Replace `authClient.signIn.email()` with a fetch to `/api/login`. Captcha token is not forwarded to the new endpoint (captcha is a Cloudflare Turnstile widget rendered on the frontend; the token was previously sent to Better Auth but is not part of the new custom endpoint's contract — if captcha enforcement is needed server-side, it is a future concern).

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
    if (body.code === 'ACCOUNT_DISABLED') return '帳號已停用，請聯繫管理員';
    return '帳號或密碼錯誤';
  }

  const session = await authClient.getSession();
  this._user.set(session.data?.user ?? null);
  await this.loadProfile();
  return null;
}
```

### Multi-role navigation

Already implemented in `AuthService`. After `loadProfile()`:
- `roles.length === 1` → `navigateToRoleShell(roles[0])`
- `roles.length > 1` → navigate to `/select-role`

No changes needed.

---

## Seed Data Updates

- Parent accounts: write phone to `ba_user.phone`; remove phone/email from `parents` INSERT. No need to set `ba_user.username = phone`.
- Staff accounts: remove email/phone from `staff` INSERT
- No `banUser()` calls for any seed accounts

---

## Out of Scope

- Forgot password for phone-only users (contact admin)
- OTP / SMS verification
- Rate limiting on `/api/login`
- System account login UX (root uses `/api/auth/sign-in/username` directly)
- Captcha enforcement on `/api/login` server-side
