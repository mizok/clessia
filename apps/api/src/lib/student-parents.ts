import type { SupabaseClient } from '@supabase/supabase-js';

/** `parent_student_relations(id, is_primary, relation, parents(id, name, user_id))` 那一層 */
export interface ParentRelationRow {
  id: string;
  is_primary: boolean;
  relation: string | null;
  parents: { id: string; name: string; user_id: string } | null;
}

export interface StudentParentContact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  relation: string | null;
  isPrimary: boolean;
}

/**
 * 學生的家長＋聯絡方式。電話與 email 的真身在 `ba_user`（`parents` 的 phone／email 在 unified login 時拿掉了），
 * **只讀**（c2）。學生詳情（`GET /api/students/:id`）與單張帳單（#1625）共用 —— 兩條路都要先過各自的範圍判斷
 * 才能呼叫這裡，這裡不做授權。
 *
 * **`ba_user` 讀不到要回 `error`，不能當成「沒有留電話」**（#1625 計畫席擋點）：吞掉的話畫面跟
 * 真的沒留一模一樣，行政會以為聯絡不到而放棄（kb lessons/broken-looks-identical-to-normal）。
 */
export async function attachParentContacts(
  supabase: SupabaseClient,
  relations: readonly ParentRelationRow[],
): Promise<{ parents: StudentParentContact[]; error: unknown }> {
  const validRelations = relations.filter((r) => r.parents);
  const userIds = validRelations.map((r) => r.parents!.user_id).filter(Boolean);

  const baUserMap = new Map<string, { email: string | null; phone: string | null }>();
  if (userIds.length > 0) {
    const { data: baUsers, error } = await supabase
      .from('ba_user')
      .select('id, email, phone')
      .in('id', userIds);
    if (error) return { parents: [], error };
    for (const u of baUsers ?? []) {
      baUserMap.set(u.id as string, {
        email: (u.email as string | null) ?? null,
        phone: (u.phone as string | null) ?? null,
      });
    }
  }

  const parents = validRelations.map((r) => {
    const baUser = baUserMap.get(r.parents!.user_id) ?? { email: null, phone: null };
    return {
      id: r.parents!.id,
      name: r.parents!.name,
      phone: baUser.phone,
      email: baUser.email,
      relation: r.relation,
      isPrimary: r.is_primary,
    };
  });
  return { parents, error: null };
}
