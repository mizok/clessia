/**
 * 契約從 seed **借**現成的人或資料時，一律限定 seed 機構（#2554）。
 *
 * 「`role = 'teacher' order by user_id limit 2`」這種全庫借法，會借到**別支契約臨時建的人**：
 * Better Auth 建的 user id 是隨機字串，常排在 seed 的 `40000000-…` 前面；`staff-scope-2493`
 * 建了臨時老師，別支契約借去在自己的 org 排課，它的 afterAll 刪使用者時就撞 `sessions_teacher_id_fkey`。
 * 之前失敗沒清掉的殘留帳號也會被借走。seed 機構的 id 寫死在 `supabase/seed.sql`（demo_org_id）。
 */
export const SEED_ORG_ID = '11111111-1111-1111-1111-111111111111';

/** 接在 `user_roles` 的 where 後面：只借 seed 機構裡有教職員身分的人 */
export const SEED_STAFF_USER = `user_id in (select user_id from staff where org_id = '${SEED_ORG_ID}')`;
