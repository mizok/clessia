-- #2496：稽核紀錄分分校（#2493 授權盤點 R12）。
--
-- audit_logs 原本沒有任何分校資訊，`GET /api/audit-logs` 只篩 org —— 只管一個分校的管理員看得到
-- 全機構的稽核（含別校人員與班級變更）。
--
-- 1. 新欄 `campus_ids uuid[]`：寫入當下這個資源所屬的**所有**分校。不是單一 campus_id ——
--    學生（多個報名）、家長（多個孩子）、職員（staff_campuses）、帳單都可能跨分校；讀取用 overlap，
--    跟學生列表「任一報名的班在範圍內就算」同一條。
--      NULL ＝ 推不出來（資源已刪、id 對不到）→ 受限者看不到（fail-closed）
--      '{}' ＝ 機構層級（科目、學校、帳期…）→ 受限者也看得到（計畫席 11-13 裁 Q1 (a)）
-- 2. 由 BEFORE INSERT trigger 依 resource_type 反查，**呼叫端明確帶了就不蓋**（刪除類由 API 先讀那一列帶上）。
--    不在 API 的 logAudit 反查：那樣每筆稽核多一個 subrequest，請假／學生／開帳單都有預算測試在守。
-- 3. `audit_campus_ids()` 是防禦式的：任何反查出錯（非 uuid 的 resource_id、表結構變了）都回 NULL，
--    **稽核的寫入永遠不能因為這裡失敗**（計畫席 11-13 補充）。
--
-- 同一種 resource_type 的 resource_id 不統一（attendance 有 event／daily_checkin／leave 三種；
-- enrollment 有兩處放的是 classId），所以依 type 列出可能的來源表逐一試 —— uuid 不會跨表撞號。
-- 新增的 resource_type 沒寫進這裡 → 落到 ELSE ＝ NULL ＝ 受限者看不到（fail-closed），不會誤放。
--
-- 授權仍只在 Hono 層（c1）：這裡只補資料，篩選在 routes/audit-logs.ts。
-- 舊資料的 backfill 另開 PR（after-deploy），跟這支分開（計畫席 11-13 裁 Q3）。

ALTER TABLE public.audit_logs ADD COLUMN campus_ids uuid[];

COMMENT ON COLUMN public.audit_logs.campus_ids IS
  '寫入當下資源所屬的所有分校（#2496）。NULL＝推不出（受限者看不到）；{}＝機構層級（所有管理員看得到）';

CREATE INDEX audit_logs_campus_ids_idx ON public.audit_logs USING gin (campus_ids);

CREATE FUNCTION public.audit_campus_ids(p_type text, p_id text)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v    uuid[];
BEGIN
  -- 機構層級：不屬於任何分校
  IF p_type IN ('school', 'school_exam', 'subject', 'organization', 'announcement',
                'billing_period', 'billing_run', 'fee_template', 'grade_promotion',
                'public_application') THEN
    RETURN '{}'::uuid[];
  END IF;

  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;
  v_id := p_id::uuid;  -- 不是 uuid → 例外 → 下面接住回 NULL

  CASE p_type
    WHEN 'campus' THEN
      SELECT array_agg(c.id) INTO v FROM public.campuses c WHERE c.id = v_id;

    WHEN 'class' THEN
      SELECT array_agg(cl.campus_id) INTO v FROM public.classes cl WHERE cl.id = v_id;

    WHEN 'class_log' THEN
      SELECT array_agg(cl.campus_id) INTO v
        FROM public.class_logs lg JOIN public.classes cl ON cl.id = lg.class_id
       WHERE lg.id = v_id;

    WHEN 'course' THEN
      SELECT array_agg(co.campus_id) INTO v FROM public.courses co WHERE co.id = v_id;

    WHEN 'session' THEN
      SELECT array_agg(cl.campus_id) INTO v
        FROM public.sessions s JOIN public.classes cl ON cl.id = s.class_id
       WHERE s.id = v_id;

    WHEN 'attendance' THEN
      -- 出勤事件（sessions.event_id）→ 到班打卡 → 請假單
      SELECT array_agg(DISTINCT cl.campus_id) INTO v
        FROM public.sessions s JOIN public.classes cl ON cl.id = s.class_id
       WHERE s.event_id = v_id;
      IF v IS NULL THEN
        SELECT array_agg(dc.campus_id) INTO v FROM public.daily_checkins dc WHERE dc.id = v_id;
      END IF;
      IF v IS NULL THEN
        v := public.audit_campus_ids('leave', p_id);
      END IF;

    WHEN 'leave' THEN
      -- 綁了堂次就看那幾堂的班；沒綁就看學生的報名
      SELECT array_agg(DISTINCT cl.campus_id) INTO v
        FROM public.leave_request_sessions lrs
        JOIN public.sessions s  ON s.id = lrs.session_id
        JOIN public.classes  cl ON cl.id = s.class_id
       WHERE lrs.leave_request_id = v_id;
      IF v IS NULL THEN
        SELECT public.audit_campus_ids('student', lr.student_id::text) INTO v
          FROM public.leave_requests lr WHERE lr.id = v_id;
      END IF;

    WHEN 'enrollment' THEN
      SELECT array_agg(cl.campus_id) INTO v
        FROM public.enrollments e JOIN public.classes cl ON cl.id = e.class_id
       WHERE e.id = v_id;
      IF v IS NULL THEN
        -- 批次報名、複製名單那兩處 resource_id 放的是 classId
        SELECT array_agg(cl.campus_id) INTO v FROM public.classes cl WHERE cl.id = v_id;
      END IF;

    WHEN 'session_pack' THEN
      SELECT array_agg(cl.campus_id) INTO v
        FROM public.session_packs sp
        JOIN public.enrollments e ON e.id = sp.enrollment_id
        JOIN public.classes cl    ON cl.id = e.class_id
       WHERE sp.id = v_id;

    WHEN 'student' THEN
      SELECT array_agg(DISTINCT cl.campus_id) INTO v
        FROM public.enrollments e JOIN public.classes cl ON cl.id = e.class_id
       WHERE e.student_id = v_id AND e.status <> 'void';

    WHEN 'contact_book_entry' THEN
      SELECT public.audit_campus_ids('student', cb.student_id::text) INTO v
        FROM public.contact_book_entries cb WHERE cb.id = v_id;

    WHEN 'meal_record' THEN
      SELECT public.audit_campus_ids('student', m.student_id::text) INTO v
        FROM public.meal_records m WHERE m.id = v_id;

    WHEN 'parent' THEN
      SELECT array_agg(DISTINCT cl.campus_id) INTO v
        FROM public.parent_student_relations r
        JOIN public.enrollments e ON e.student_id = r.student_id AND e.status <> 'void'
        JOIN public.classes cl    ON cl.id = e.class_id
       WHERE r.parent_id = v_id;

    WHEN 'staff' THEN
      SELECT array_agg(sc.campus_id) INTO v FROM public.staff_campuses sc WHERE sc.staff_id = v_id;

    WHEN 'invoice' THEN
      -- 帳單上掛的報名的班；沒有掛報名（講義費、餐費）就看學生
      SELECT array_agg(DISTINCT cl.campus_id) INTO v
        FROM public.invoice_items ii
        JOIN public.enrollments e ON e.id = ii.enrollment_id
        JOIN public.classes cl    ON cl.id = e.class_id
       WHERE ii.invoice_id = v_id;
      IF v IS NULL THEN
        SELECT public.audit_campus_ids('student', i.student_id::text) INTO v
          FROM public.invoices i WHERE i.id = v_id;
      END IF;

    WHEN 'payment_record' THEN
      SELECT public.audit_campus_ids('invoice', p.invoice_id::text) INTO v
        FROM public.payment_records p WHERE p.id = v_id;

    WHEN 'academy_exam' THEN
      SELECT array_agg(DISTINCT x.campus_id) INTO v FROM (
        SELECT ae.campus_id FROM public.academy_exams ae WHERE ae.id = v_id
        UNION
        SELECT cl.campus_id
          FROM public.academy_exam_classes aec JOIN public.classes cl ON cl.id = aec.class_id
         WHERE aec.exam_id = v_id
      ) x WHERE x.campus_id IS NOT NULL;

    WHEN 'enrollment_request' THEN
      SELECT array_agg(cl.campus_id) INTO v
        FROM public.enrollment_requests er JOIN public.classes cl ON cl.id = er.class_id
       WHERE er.id = v_id;

    WHEN 'trial_request' THEN
      SELECT array_agg(co.campus_id) INTO v
        FROM public.trial_requests tr JOIN public.courses co ON co.id = tr.course_id
       WHERE tr.id = v_id;

    ELSE
      v := NULL;
  END CASE;

  -- 對不到任何列 ＝ 推不出來（不是機構層級）
  IF cardinality(v) IS NULL OR cardinality(v) = 0 THEN
    RETURN NULL;
  END IF;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.audit_campus_ids(text, text) IS
  '稽核紀錄的資源 → 所屬分校（#2496）。機構層級回 {}，推不出或出錯回 NULL；永不丟例外';

CREATE FUNCTION public.audit_logs_fill_campus_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.campus_ids IS NULL THEN
    NEW.campus_ids := public.audit_campus_ids(NEW.resource_type, NEW.resource_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- 保險：反查函式已經自己接住例外，這裡再接一次 —— 稽核寫入不能因為補分校失敗
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_logs_fill_campus_ids
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_fill_campus_ids();
