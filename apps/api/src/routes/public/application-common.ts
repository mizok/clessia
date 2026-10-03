import { z } from '@hono/zod-openapi';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Context } from 'hono';

import type { AppEnv } from '../../index';

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
  /** honeypot（#1126）：前端藏起來的欄位，真人不會填。有值就回假成功、不寫 */
  website: z.string().max(500).optional(),
  /** Cloudflare Turnstile 的 token（#1126）；部署沒設 `TURNSTILE_SECRET_KEY` 時不看 */
  captchaToken: z.string().max(2048).optional(),
};

/**
 * 速率限制（#1126，計畫席裁：數字是起點、可調）。計數直接數 `public_applications` ——
 * c12 不准用 Workers KV／Durable Objects／Cloudflare Rate Limiting。
 * ALTCHA（MIT 自架 proof-of-work）是客戶不要 Cloudflare 時取代 Turnstile 的後路，這裡沒做。
 */
export const RATE_LIMITS = {
  /** 同一來源（IP hash）一小時內，報名＋試聽合計 */
  perSourcePerHour: 5,
  /** 同一聯絡方式（手機或 Email）24 小時內，同類型 */
  perContactPerDay: 3,
} as const;

/** 只存 HMAC：數得出「同一個來源」，表裡沒有可還原的 IP（個資） */
export async function hashClientIp(ip: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(ip));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 來源 IP：Workers 的 `CF-Connecting-IP` → `X-Real-IP` → `X-Forwarded-For` 第一段；都沒有回 null（只剩聯絡方式那條限制）。
 * ⚠️ Node 自架前面沒有會覆寫這些標頭的反向代理時，它們可以偽造（見 deploying.md）。
 */
export function clientIp(c: Context<AppEnv>): string | null {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? (forwarded || null);
}

const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type GuardResult =
  | { kind: 'pass'; ipHash: string | null }
  | { kind: 'honeypot' }
  | { kind: 'reject'; status: 400; body: { error: string; code: 'CAPTCHA_FAILED' } }
  | {
      kind: 'reject';
      status: 429;
      body: { error: string; code: 'RATE_LIMITED' };
      retryAfterSeconds: number;
    }
  | { kind: 'reject'; status: 503; body: { error: string; code: 'CAPTCHA_UNAVAILABLE' } };

/**
 * 防濫用（#1126）。順序 honeypot → rate limit → CAPTCHA（便宜的先擋）；都過了才走原本的驗證與寫入。
 */
export async function guardSubmission(
  c: Context<AppEnv>,
  body: Applicant & { website?: string; captchaToken?: string },
  kind: 'enrollment' | 'trial',
): Promise<GuardResult> {
  if (body.website?.trim()) return { kind: 'honeypot' };

  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const ip = clientIp(c);
  const ipHash = ip ? await hashClientIp(ip, c.env.BETTER_AUTH_SECRET) : null;
  const now = Date.now();
  const rateLimited = (retryAfterSeconds: number): GuardResult => ({
    kind: 'reject',
    status: 429,
    body: { error: '送出太多次了，請稍後再試', code: 'RATE_LIMITED' },
    retryAfterSeconds,
  });

  const count = async (column: string, value: string, sinceMs: number, sameKind: boolean) => {
    let query = supabase
      .from('public_applications')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq(column, value)
      .gte('created_at', new Date(now - sinceMs).toISOString());
    if (sameKind) query = query.eq('kind', kind);
    return (await query).count ?? 0;
  };

  const HOUR = 60 * 60 * 1000;
  if (
    ipHash &&
    (await count('client_ip_hash', ipHash, HOUR, false)) >= RATE_LIMITS.perSourcePerHour
  ) {
    return rateLimited(60 * 60);
  }
  for (const [column, value] of [
    ['parent_phone', body.parent.phone],
    ['parent_email', body.parent.email],
  ] as const) {
    if (value && (await count(column, value, 24 * HOUR, true)) >= RATE_LIMITS.perContactPerDay) {
      return rateLimited(24 * 60 * 60);
    }
  }

  // Turnstile 可選（c12：客戶要能離開 Cloudflare）—— 沒設 secret 就不檢查
  const secret = c.env.TURNSTILE_SECRET_KEY?.trim();
  if (secret) {
    if (!body.captchaToken) {
      return {
        kind: 'reject',
        status: 400,
        body: { error: '請完成機器人驗證', code: 'CAPTCHA_FAILED' },
      };
    }
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', body.captchaToken);
    if (ip) form.append('remoteip', ip);
    let ok: boolean;
    try {
      const res = await fetch(TURNSTILE_VERIFY, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`siteverify ${res.status}`);
      ok = ((await res.json()) as { success?: boolean }).success === true;
    } catch {
      // fail-closed：驗證服務掛了不放行
      return {
        kind: 'reject',
        status: 503,
        body: { error: '驗證服務暫時無法使用，請稍後再試', code: 'CAPTCHA_UNAVAILABLE' },
      };
    }
    if (!ok) {
      return {
        kind: 'reject',
        status: 400,
        body: { error: '機器人驗證沒有通過，請重試', code: 'CAPTCHA_FAILED' },
      };
    }
  }

  return { kind: 'pass', ipHash };
}

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
  extra: {
    preferred_start_date?: string | null;
    preferred_times?: string | null;
    client_ip_hash?: string | null;
  },
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
      client_ip_hash: extra.client_ip_hash ?? null,
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
