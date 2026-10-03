import { z } from '@hono/zod-openapi';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 公開報名（#1123）與公開試聽（#1124）共用：申請人欄位的驗證、寫入 `public_applications`＋targets。
 * 兩張表單的家長／學生欄位一樣（`specs/public/enrollment.md`、`trial.md`），各寫一份遲早會漂。
 */

const GRADES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'J1', 'J2', 'J3', 'S1', 'S2', 'S3'] as const;

/** 台灣手機：去掉空白與連字號後是 09 開頭 10 碼 */
const MobileSchema = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^09\d{8}$/, '手機號碼格式不正確'));

const text = (max: number) => z.string().trim().min(1).max(max);

/** 兩張表單共同的欄位；各自再加選班／選課程 */
export const ApplicantFields = {
  parent: z.object({
    name: text(50),
    email: z.string().trim().email().max(254).optional(),
    phone: MobileSchema.optional(),
    relation: z.enum(['father', 'mother', 'other']),
  }),
  student: z.object({
    name: text(50),
    grade: z.enum(GRADES),
    school: text(100),
  }),
  note: z.string().trim().max(500).optional(),
  /** 個資同意；沒勾不收 */
  consent: z.literal(true),
};

export const ApplicationErrorSchema = z
  .object({ error: z.string(), code: z.string() })
  .openapi('PublicApplicationError');

type Applicant = {
  parent: { name: string; email?: string; phone?: string; relation: string };
  student: { name: string; grade: string; school: string };
  note?: string;
};

export const EMAIL_OR_PHONE_REQUIRED = {
  error: 'Email 或手機號碼至少填一個',
  code: 'EMAIL_OR_PHONE_REQUIRED',
} as const;
export const hasContact = (a: Applicant) => !!(a.parent.email || a.parent.phone);

/**
 * 寫一筆申請＋targets。targets 寫失敗就收回主列（沒有班／課程的申請沒有用，讓對方重送）。
 * 回申請 id；失敗回 null。
 */
export async function insertApplication(
  supabase: SupabaseClient,
  orgId: string,
  kind: 'enrollment' | 'trial',
  applicant: Applicant,
  extra: { preferred_start_date?: string | null; preferred_times?: string | null },
  targets: Array<{ class_id?: string; course_id?: string; is_waitlist?: boolean }>,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('public_applications')
    .insert({
      org_id: orgId,
      kind,
      parent_name: applicant.parent.name,
      parent_email: applicant.parent.email ?? null,
      parent_phone: applicant.parent.phone ?? null,
      parent_relation: applicant.parent.relation,
      student_name: applicant.student.name,
      student_grade: applicant.student.grade,
      student_school: applicant.student.school,
      preferred_start_date: extra.preferred_start_date ?? null,
      preferred_times: extra.preferred_times ?? null,
      note: applicant.note || null,
      // 伺服器時間，不信前端
      consented_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) return null;
  const applicationId = (data as { id: string }).id;

  const { error: targetsError } = await supabase.from('public_application_targets').insert(
    targets.map((t) => ({
      application_id: applicationId,
      class_id: t.class_id ?? null,
      course_id: t.course_id ?? null,
      is_waitlist: t.is_waitlist ?? false,
    })),
  );
  if (targetsError) {
    await supabase.from('public_applications').delete().eq('id', applicationId).eq('org_id', orgId);
    return null;
  }
  return applicationId;
}
