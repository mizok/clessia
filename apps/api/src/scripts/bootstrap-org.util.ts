/**
 * 開站的寫入序列。從 `bootstrap-org.ts` 抽出來是為了讓它**測得到** ——
 * 那支腳本是 top-level `main()` + `process.exit`，直接 import 就會跑起來。
 *
 * 這裡不碰環境變數、不印東西、不 exit：失敗就丟例外，由腳本決定怎麼呈現。
 */

/** 只要 `pg` 的 `Pool.query` 那一小塊形狀 —— 測試餵一個會記錄呼叫的假的進來。 */
export interface BootstrapDeps {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  /** 走 Better Auth 建帳號（`ba_*` 不得由應用程式碼直接寫入，c2），回傳 user id。 */
  createAdminUser: (input: { name: string; email: string }) => Promise<string>;
}

export interface BootstrapInput {
  orgName: string;
  orgSlug: string;
  adminEmail: string;
  adminName: string;
}

export async function provisionOrg(
  deps: BootstrapDeps,
  { orgName, orgSlug, adminEmail, adminName }: BootstrapInput,
): Promise<{ orgId: string; userId: string }> {
  // 冪等：slug 已存在就整個中止，不覆寫任何東西 —— 也不能先建帳號再發現組織撞名，
  // 那會留下一個沒有組織的孤兒使用者
  const existing = await deps.query('select id from public.organizations where slug = $1', [
    orgSlug,
  ]);
  if (existing.rowCount && existing.rowCount > 0) {
    throw new Error(`slug「${orgSlug}」的組織已存在，未做任何變更。`);
  }

  const orgResult = await deps.query(
    'insert into public.organizations (name, slug) values ($1, $2) returning id',
    [orgName, orgSlug],
  );
  const orgId = orgResult.rows[0]['id'] as string;

  const userId = await deps.createAdminUser({ name: adminName, email: adminEmail });

  // orgId 是 Better Auth 的 additionalField，createUser 不吃，補上去
  await deps.query('update public.ba_user set "orgId" = $1 where id = $2', [orgId, userId]);

  await deps.query(
    `insert into public.user_roles (user_id, role, permissions) values ($1, 'admin', '["*"]'::jsonb)`,
    [userId],
  );

  // **人員名冊裡的那一列。** 沒有它的話第一個管理員在人員管理頁（讀 staff 表）根本不存在
  // ——看不到自己、也改不了自己的角色；而 `/api/me` 的 displayName 也少了一個來源。
  // 這一步原本沒有，對每個乾淨部署都成立。
  //
  // 不掛 campus：開站不建分校，`staff_campuses` 是另一張表、沒有列就是還沒指派。
  // birthday / notes / status 交給 schema 的預設值（status 預設 'active'）。
  await deps.query('insert into public.staff (user_id, org_id, display_name) values ($1, $2, $3)', [
    userId,
    orgId,
    adminName,
  ]);

  return { orgId, userId };
}
