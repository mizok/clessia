-- ============================================================
-- leave_request_sessions：請假單勾選綁定的堂次（#1114）
--
-- 設計：kb/wiki/architecture/leave-session-binding.md
--
-- 一張假**有綁定列**就只蓋綁定的那幾堂；**沒有綁定列**沿用舊語意（整天／單日時間窗），
-- 所以既有資料不用遷移。
--
-- - 帶 org_id：寫入以 org 定位（c1），並進 lib/org-scope.ts 的 OrgTable（A23）。
-- - 關聯表而不是 leave_requests.session_ids uuid[]：陣列沒有 FK，堂次被刪時會留下懸空 id；
--   也沒辦法從堂次反查「這堂誰請假」（roster 要的方向）。
-- - session 被刪 → 綁定列 cascade；假單剩零列**不**自動刪（留痕，管理員自己收）。
-- ============================================================

CREATE TABLE public.leave_request_sessions (
  leave_request_id uuid NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,
  session_id       uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (leave_request_id, session_id)
);

-- 從堂次反查（roster、重疊檢查）
CREATE INDEX leave_request_sessions_session_idx ON public.leave_request_sessions (session_id);

-- fail-closed：業務表啟用 RLS、沒有 policy（API 走 service role）
ALTER TABLE public.leave_request_sessions ENABLE ROW LEVEL SECURITY;
