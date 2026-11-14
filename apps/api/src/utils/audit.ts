import type { SupabaseClient } from '@supabase/supabase-js';
import { loadDisplayName } from '../lib/display-name';

type ResourceType =
  | 'class'
  | 'course'
  | 'campus'
  | 'staff'
  | 'session'
  | 'student'
  | 'parent'
  // SQL 的 CHECK 從 `20260319000001_create_enrollments.sql` 就有這個值，
  // 而這裡一直沒有 —— 單向漂移了半年（#830）。
  // **沒有人依賴這個缺口**（`enrollments.ts` 的 `logAudit` 數是 0、
  // 全 repo 沒有任何 `resourceType: 'enrollment'`），所以補齊是純加法。
  // （#830 當時另記了「報名的建立與退班完全沒有稽核紀錄」—— 那個缺口已由 #851 接上，
  // `enrollments.ts` 現在有建立／更新／刪除的 `logAudit`。#999 一併更正這句。）
  | 'enrollment'
  | 'attendance'
  | 'leave'
  | 'academy_exam'
  | 'school_exam'
  | 'school'
  | 'contact_book_entry'
  | 'class_log'
  | 'billing_period'
  | 'fee_template'
  | 'invoice'
  | 'payment_record'
  | 'session_pack'
  | 'meal_record'
  | 'billing_run'
  // #828：科目與組織設定的寫入原本完全沒有 audit_logs。
  // **這個 union 與 DB 的 CHECK constraint 是兩份清單** ——
  // 加值一定要兩邊一起加，`logAudit` 是 fire-and-forget，
  // 只加這裡的話 insert 會被 DB 拒絕而**只在 console 留一行**。
  | 'subject'
  | 'organization'
  // #911：只記「發佈」—— 已讀兩支刻意不記（使用者 2026-09-30 裁定）：
  // `announcement_reads` 本身就存了誰、何時第一次讀，而且永久；audit_logs 90 天就清
  | 'announcement'
  | 'public_application'
  // #1707：管理端處理家長登入後送的申請（migration 20261016144718 同時加進 CHECK）
  | 'enrollment_request'
  | 'trial_request'
  // #1820：學年升級（migration 20261022061817 同時加進 CHECK）
  | 'grade_promotion';

export interface AuditLogParams {
  orgId: string;
  userId: string;
  resourceType: ResourceType;
  resourceId?: string | null;
  resourceName?: string | null;
  action: string;
  details?: Record<string, unknown>;
  /**
   * 這筆稽核所屬的分校（#2496）。**平常不用帶** —— DB trigger 依 resource_type 反查（`audit_campus_ids()`）。
   * 只有反查不到的時候要帶：**刪除**（寫稽核時那一列已經不在）。帶了 trigger 就不蓋。
   * 受限的管理員只看得到 campus_ids 跟自己範圍有交集、或機構層級（{}）的紀錄
   */
  campusIds?: readonly string[];
}

function joinAuditResourceParts(parts: Array<string | null | undefined>): string | null {
  const normalizedParts = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  if (normalizedParts.length === 0) {
    return null;
  }

  return normalizedParts.join(' / ');
}

export function formatAuditCourseResourceName(params: {
  courseName?: string | null;
  campusName?: string | null;
}): string | null {
  return joinAuditResourceParts([params.courseName, params.campusName]);
}

export function formatAuditClassResourceName(params: {
  className?: string | null;
  courseName?: string | null;
  campusName?: string | null;
}): string | null {
  return joinAuditResourceParts([params.className, params.courseName, params.campusName]);
}

export function formatAuditSessionResourceName(params: {
  courseName?: string | null;
  className?: string | null;
  sessionDate?: string | null;
  startTime?: string | null;
}): string | null {
  const dateTime = [params.sessionDate, params.startTime].filter(Boolean).join(' ');
  return joinAuditResourceParts([params.courseName, params.className, dateTime || null]);
}

/**
 * **刪除之前**先算好這筆稽核的分校（#2496）：刪完再寫稽核時 DB trigger 已經反查不到那一列，
 * 會變成 NULL（受限的管理員看不到自己做的刪除）。跟 trigger 呼叫同一個 SQL 函式，判準只有一份。
 * 出錯回 undefined —— 交給 trigger（結果是 NULL、fail-closed），不擋刪除本身
 */
export async function auditCampusIdsBeforeDelete(
  supabase: SupabaseClient,
  resourceType: ResourceType,
  resourceId: string,
): Promise<string[] | undefined> {
  try {
    const { data, error } = await supabase.rpc('audit_campus_ids', {
      p_type: resourceType,
      p_id: resourceId,
    });
    return error || !Array.isArray(data) ? undefined : (data as string[]);
  } catch {
    return undefined;
  }
}

/**
 * 寫入 audit_logs。
 * 在 Cloudflare Workers 環境中必須傳入 waitUntil，
 * 確保 response 送出後 Promise 仍能繼續執行。
 *
 * 用法：
 *   logAudit(supabase, params, waitUntilFrom(c));
 */
export function logAudit(
  supabase: SupabaseClient,
  params: AuditLogParams,
  waitUntil?: (promise: Promise<unknown>) => void,
): void {
  const promise = (async () => {
    try {
      const userName = await loadDisplayName(supabase, params.orgId, params.userId);

      await supabase.from('audit_logs').insert({
        org_id: params.orgId,
        user_id: params.userId,
        user_name: userName,
        resource_type: params.resourceType,
        resource_id: params.resourceId ?? null,
        resource_name: params.resourceName ?? null,
        action: params.action,
        details: params.details ?? {},
        ...(params.campusIds ? { campus_ids: params.campusIds } : {}),
      });
    } catch (e) {
      console.warn('[audit] log failed:', e);
    }
  })();

  waitUntil?.(promise);
}

/**
 * 同一個人一次寫多筆稽核（批次端點，#1314 P5）：**每個資源仍是一筆**，但只查一次名字、
 * 一次 insert —— 逐筆呼叫 `logAudit` 的話 200 張是 400 個 subrequest，會撞 Workers 的上限。
 */
export function logAuditMany(
  supabase: SupabaseClient,
  base: Omit<AuditLogParams, 'resourceId' | 'resourceName'>,
  resources: ReadonlyArray<{ resourceId: string; resourceName?: string | null }>,
  waitUntil?: (promise: Promise<unknown>) => void,
): void {
  if (resources.length === 0) return;
  const promise = (async () => {
    try {
      const userName = await loadDisplayName(supabase, base.orgId, base.userId);

      await supabase.from('audit_logs').insert(
        resources.map((r) => ({
          org_id: base.orgId,
          user_id: base.userId,
          user_name: userName,
          resource_type: base.resourceType,
          resource_id: r.resourceId,
          resource_name: r.resourceName ?? null,
          action: base.action,
          details: base.details ?? {},
        })),
      );
    } catch (e) {
      console.warn('[audit] log failed:', e);
    }
  })();

  waitUntil?.(promise);
}
