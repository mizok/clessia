-- ============================================================
-- 業務表補開 RLS（fail-closed 後盾）
--
-- AGENTS.md 與憲法 c1 的脈絡都寫明：業務表一律啟用 RLS 且不建任何 policy。
-- API 用 service role key，它會繞過 RLS —— 所以這不是第二道防線，
-- 而是「將來若真的接上 anon client，會被全拒而不是全放」的後盾。
--
-- 實際狀況是早期的表有開、後期新增的沒開（30 張裡 13 張開著）。
-- 這支把剩下的 16 張補齊，讓文件寫的跟資料庫做的一致。
--
-- 執行期影響為零，已驗證：
--   - apps/web 沒有任何 supabase client
--   - apps/api 只用 SUPABASE_SERVICE_ROLE_KEY 建 client
--   - SUPABASE_ANON_KEY 在 .dev.vars 裡宣告，但程式碼一次都沒用到
-- ============================================================
ALTER TABLE public.academy_exam_classes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_exams            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_scores           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_checkins           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_student_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parents                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_changes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_exams             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_scores            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schools                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students                 ENABLE ROW LEVEL SECURITY;
