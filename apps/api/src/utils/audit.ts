import type { SupabaseClient } from '@supabase/supabase-js';

type ResourceType = 'class' | 'course' | 'campus' | 'staff';

export interface AuditLogParams {
  orgId: string;
  userId: string;
  resourceType: ResourceType;
  resourceId?: string | null;
  resourceName?: string | null;
  action: string;
  details?: Record<string, unknown>;
}

/**
 * 寫入 audit_logs。
 * 在 Cloudflare Workers 環境中必須傳入 waitUntil，
 * 確保 response 送出後 Promise 仍能繼續執行。
 *
 * 用法：
 *   logAudit(supabase, params, c.executionCtx.waitUntil.bind(c.executionCtx));
 */
export function logAudit(
  supabase: SupabaseClient,
  params: AuditLogParams,
  waitUntil?: (promise: Promise<unknown>) => void,
): void {
  const promise = (async () => {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', params.userId)
        .maybeSingle();

      await supabase.from('audit_logs').insert({
        org_id: params.orgId,
        user_id: params.userId,
        user_name: profile?.display_name ?? null,
        resource_type: params.resourceType,
        resource_id: params.resourceId ?? null,
        resource_name: params.resourceName ?? null,
        action: params.action,
        details: params.details ?? {},
      });
    } catch (e) {
      console.warn('[audit] log failed:', e);
    }
  })();

  waitUntil?.(promise);
}
