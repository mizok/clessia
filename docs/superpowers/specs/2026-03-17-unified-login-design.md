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

`POST /api/login` covers **staff and parent accounts only**. System accounts (e.g. `root`) have no staff or parents record and use Better Auth's native endpoint (`/api/auth/sign-in/username`) directly. There is no fallback path in `/api/login`.

---

## Credential Strategy

Every account needs a Better Auth-compatible credential for password verification:

| Account type | ba_user.email | ba_user.phone | ba_user.username | Better Auth method |
|---|---|---|---|---|
| Staff / admin (email) | set | optional | optional | `signInEmail` |
| Parent (email) | set | optional | optional | `signInEmail` |
| Parent (phone-only) | NULL | set | = phone number | `signInUsername` |
| System (root) | NULL | NULL | `root` | `signInUsername` (external) |

**Phone-only accounts** store the phone number in both `ba_user.phone` (for lookup) and `ba_user.username` (for Better Auth `signInUsername`). The login endpoint looks up by `ba_user.phone`, then authenticates via `signInUsername` using the stored username (= phone).

This is the only case where username equals a phone number. All other usernames are human-readable (e.g. `demo_admin`).

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
- `parents.ts` CREATE: remove `email` / `phone` from `parents` INSERT; write to `ba_user` via `auth.api.admin.createUser()`; for phone-only accounts, set `username = phone`
- `parents.ts` UPDATE: remove `email` / `phone` from `parents` UPDATE SET; sync changes to `ba_user` via `auth.api.admin.updateUser()`; if phone changes, update `ba_user.username` as well
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
   - If no records in either table → 401 INVALID_CREDENTIALS

5. Verify password via Better Auth
   ba_user.email present → auth.api.signInEmail({ email, password }, asResponse: true)
   ba_user.email absent  → auth.api.signInUsername({ username: ba_user.username, password }, asResponse: true)
   Forward raw response to client (includes Set-Cookie)

6. On Better Auth error → 401 INVALID_CREDENTIALS
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

- Parent accounts: write phone to `ba_user.phone` AND `ba_user.username` (for phone-only accounts); remove phone/email from `parents` INSERT
- Staff accounts: remove email/phone from `staff` INSERT
- No `banUser()` calls for any seed accounts

---

## Out of Scope

- Forgot password for phone-only users (contact admin)
- OTP / SMS verification
- Rate limiting on `/api/login`
- System account login UX (root uses `/api/auth/sign-in/username` directly)
- Captcha enforcement on `/api/login` server-side
