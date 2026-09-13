-- ============================================================================
-- seed-demo.sql —— 展示用資料（一學期、像真的補習班）
--
-- **跟 `seed.sql` 並存，不取代它。** `seed.sql` 是冒煙測試用的（每張表 1–6 筆），
-- 而測試依賴它 —— 動它會動到 `test-baseline.json` 的基線。這一支只做**加法**。
--
-- ## 怎麼套用
--
--     set -a; . ./apps/api/.dev.vars; set +a
--     psql "$DATABASE_URL" -f supabase/seed-demo.sql
--
-- **不需要 `db:reset`** —— 它只 INSERT／UPDATE 自己造的列，不 TRUNCATE、不刪既有資料。
-- 所以別席正在跑的操作不會被沖掉。驗證方式也因此是**套用前後各查一次差值**，
-- 而不是「reset 之後查總數」——**後者靠的是一張乾淨的桌子，證不出加法真的加進去了。**
--
-- ## 它不建立使用者，這是刻意的（憲法 c2）
--
-- `ba_*` 由 Better Auth 管，**SQL 不得寫入**（`seed.sql` 的既有寫入是永久豁免，新增的不行；
-- pre-guard 會擋）。所以老師與家長**一律沿用 `seed.sql` 已經建好的帳號**。
--
-- **而那反而修掉了一個既有缺陷**：`seed.sql` 造出兩群不相交的人 ——
-- 15 位家長都有孩子，但**只有 3 位的孩子有報名**（issue #518 的殘餘）。
-- 這支把新造的學生掛到既有家長身上，於是**那 15 位家長在 demo 時全部都有東西可看**。
-- 這不是為了讓資料好看而扭曲關聯：現實上一個家長本來就可能有多個孩子。
--
-- ## 時間錨定
--
-- **全部相對 `current_date` 推算，沒有寫死日期。** 寫死的話過兩週 demo 就變成
-- 「全都是過去的課」。學期是 `今天 -10 週 ~ 今天 +6 週`，所以任何時候套用都同時有
-- 「已經上完、可以看點名與成績」與「還沒上、可以排課調課」的課堂。
--
-- ## 重複套用
--
-- 頭一段偵測自己是否已套過（找展示分校）。已套過就跳出，不會產生第二份。
-- ============================================================================

DO $$
DECLARE
  v_org           uuid := '11111111-1111-1111-1111-111111111111';
  v_campus        uuid;
  v_school_a      uuid;
  v_school_b      uuid;
  v_subj          uuid[];

  v_course        uuid;
  v_class         uuid;
  v_schedule      uuid;
  v_session       uuid;
  v_event         uuid;
  v_student       uuid;
  v_enrollment    uuid;
  v_invoice       uuid;
  v_exam          uuid;
  v_cancelled     uuid;

  v_term_start    date := (current_date - interval '10 weeks')::date;
  v_term_end      date := (current_date + interval '6 weeks')::date;
  v_receipt       integer;
  v_status        text;
  -- 所有 `created_by` / `recorded_by` / `submitted_by` 都有 FK 指向 `ba_user`，
  -- 所以不能塞任意字串。沿用既有的 demo 管理員（c2：不建立新使用者）。
  v_actor         text;

  v_teacher_ids   uuid[];   -- 沿用既有 staff（有 teacher 角色的）
  v_parent_ids    uuid[];   -- 沿用既有 parents
  v_student_ids   uuid[] := ARRAY[]::uuid[];
  v_class_ids     uuid[] := ARRAY[]::uuid[];

  v_class_names   text[] := ARRAY['國三數學 A 班','國二英文 B 班','國三國文 A 班',
                                  '國二自然 A 班','國小六年級數學班','國小五年級英文班'];
  v_course_names  text[] := ARRAY['國中數學','國中英文','國中國文','國中自然','國小數學','國小英文'];
  v_starts        time[] := ARRAY['17:00','19:00','17:00','19:00','15:00','15:00']::time[];
  v_ends          time[] := ARRAY['18:30','20:30','18:30','20:30','16:30','16:30']::time[];

  v_names         text[] := ARRAY[
    '王柏翰','李思妤','張宇軒','陳映彤','林子晴','黃冠廷','吳承翰','劉宜蓁','蔡孟儒','鄭涵予',
    '謝秉勳','許雅雯','洪家瑋','曾郁婷','彭立宇','廖偉誠','賴思穎','徐子豪','高詠晴','潘俊傑',
    '盧安琪','施柏宇','范芷寧','馬士豪','唐允中','石佳穎','溫柏勛','葉宸希','董語彤','鍾昀達',
    '傅千惠','阮柏睿','龔亦萱','嚴皓天','詹佩君','章立群','邱宥安','孟妍希','顧廷瑋','夏晨曦'
  ];
  v_grades        text[] := ARRAY['P5','P6','J1','J2','J3'];

  i               integer;
  j               integer;
  k               integer;
  d               date;
  v_day           integer;
BEGIN
  SELECT u.id INTO v_actor FROM public.ba_user u
  JOIN public.user_roles ur ON ur.user_id = u.id AND ur.role = 'admin'
  ORDER BY u."createdAt" LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION '找不到既有的管理員帳號 —— 先套用 seed.sql';
  END IF;

  IF EXISTS (SELECT 1 FROM public.campuses WHERE org_id = v_org AND name = '文山旗艦校') THEN
    RAISE NOTICE 'seed-demo 已經套用過（找到「文山旗艦校」），這次不做任何事。';
    RETURN;
  END IF;

  -- ── 沿用既有的人（不建立任何 ba_user，見檔頭 c2 那段）────────────────────
  SELECT array_agg(s.id) INTO v_teacher_ids FROM (
    SELECT s.id FROM public.staff s
    JOIN public.user_roles ur ON ur.user_id = s.user_id AND ur.role = 'teacher'
    WHERE s.org_id = v_org AND s.status = 'active'
    ORDER BY s.display_name LIMIT 6
  ) s;

  SELECT array_agg(p.id) INTO v_parent_ids FROM (
    SELECT p.id FROM public.parents p
    JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'parent'
    WHERE p.org_id = v_org AND p.status = 'active'
    ORDER BY p.created_at LIMIT 15
  ) p;

  IF v_teacher_ids IS NULL OR array_length(v_teacher_ids, 1) < 3 THEN
    RAISE EXCEPTION '找不到足夠的既有老師 —— 先套用 seed.sql';
  END IF;
  IF v_parent_ids IS NULL OR array_length(v_parent_ids, 1) < 5 THEN
    RAISE EXCEPTION '找不到足夠的既有家長 —— 先套用 seed.sql';
  END IF;

  -- ── 參照資料 ────────────────────────────────────────────────────────────
  INSERT INTO public.campuses (org_id, name, address, phone)
  VALUES (v_org, '文山旗艦校', '台北市文山區羅斯福路六段 142 號 3 樓', '02-2930-5678')
  RETURNING id INTO v_campus;

  INSERT INTO public.schools (org_id, name, short_name)
  VALUES (v_org, '臺北市立景美國民中學', '景美國中') RETURNING id INTO v_school_a;
  INSERT INTO public.schools (org_id, name, short_name)
  VALUES (v_org, '臺北市文山區興隆國民小學', '興隆國小') RETURNING id INTO v_school_b;

  -- 科目沿用 seed.sql 已建好的（順序：數學/英文/國文/自然，對應下面六個課程）
  SELECT ARRAY[
    (SELECT id FROM public.subjects WHERE org_id = v_org AND name = '數學'),
    (SELECT id FROM public.subjects WHERE org_id = v_org AND name = '英文'),
    (SELECT id FROM public.subjects WHERE org_id = v_org AND name = '國文'),
    (SELECT id FROM public.subjects WHERE org_id = v_org AND name = '自然')
  ] INTO v_subj;

  -- ── 學生 40 位 ──────────────────────────────────────────────────────────
  FOR i IN 1 .. array_length(v_names, 1) LOOP
    INSERT INTO public.students (org_id, name, grade, birthday, gender, phone, school_id, is_active)
    VALUES (
      v_org, v_names[i],
      (v_grades[1 + (i % 5)])::grade_level,
      current_date - ((11 + (i % 5)) * 365 + (i * 7)),
      (ARRAY['male','female','female','male'])[1 + (i % 4)]::student_gender,
      '09' || lpad(((i * 137137) % 100000000)::text, 8, '0'),
      CASE WHEN v_grades[1 + (i % 5)] LIKE 'P%' THEN v_school_b ELSE v_school_a END,
      true
    ) RETURNING id INTO v_student;
    v_student_ids := array_append(v_student_ids, v_student);
  END LOOP;

  -- ── 把新學生掛到既有家長身上（修掉 #518 的「兩群不相交」）─────────────────
  -- 15 位家長各拿 1–2 個孩子，而這些孩子下面都會有課、有出勤、有成績、有帳單。
  FOR i IN 1 .. array_length(v_parent_ids, 1) LOOP
    INSERT INTO public.parent_student_relations (parent_id, student_id, relation, is_primary)
    VALUES (v_parent_ids[i], v_student_ids[i],
            CASE WHEN i % 2 = 0 THEN '母' ELSE '父' END, true)
    ON CONFLICT DO NOTHING;

    -- 前五位家長有第二個孩子 —— demo 時可以展示「切換孩子」
    IF i <= 5 THEN
      INSERT INTO public.parent_student_relations (parent_id, student_id, relation, is_primary)
      VALUES (v_parent_ids[i], v_student_ids[i + 20],
              CASE WHEN i % 2 = 0 THEN '母' ELSE '父' END, false)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- ── 課程 / 班級 / 時段 / 一學期的課堂 ────────────────────────────────────
  FOR i IN 1 .. 6 LOOP
    INSERT INTO public.courses (org_id, campus_id, name, subject_id, grade_levels, is_active)
    VALUES (v_org, v_campus, v_course_names[i],
      v_subj[1 + ((i - 1) % 4)],
      CASE WHEN i <= 4 THEN ARRAY['J1','J2','J3']::grade_level[]
           ELSE ARRAY['P5','P6']::grade_level[] END,
      true)
    RETURNING id INTO v_course;

    INSERT INTO public.classes (org_id, campus_id, course_id, name, max_students,
                                grade_levels, is_active, start_date, end_date,
                                uses_contact_book, leave_deducts_session)
    VALUES (v_org, v_campus, v_course, v_class_names[i], 18,
      CASE WHEN i <= 4 THEN ARRAY['J1','J2','J3']::grade_level[]
           ELSE ARRAY['P5','P6']::grade_level[] END,
      true, v_term_start, v_term_end,
      (i <= 2), (i = 1))
    RETURNING id INTO v_class;
    v_class_ids := array_append(v_class_ids, v_class);

    v_day := i;  -- 週一~週六各一班
    INSERT INTO public.schedules (class_id, weekday, start_time, end_time, teacher_id)
    VALUES (v_class, v_day, v_starts[i], v_ends[i],
            v_teacher_ids[1 + (i % array_length(v_teacher_ids, 1))])
    RETURNING id INTO v_schedule;

    d := v_term_start;
    WHILE EXTRACT(ISODOW FROM d)::int <> v_day LOOP d := d + 1; END LOOP;

    WHILE d <= v_term_end LOOP
      v_status := CASE WHEN d < current_date THEN 'completed' ELSE 'scheduled' END;

      INSERT INTO public.sessions (org_id, class_id, schedule_id, session_date,
                                   start_time, end_time, teacher_id, status,
                                   assignment_status, created_by)
      VALUES (v_org, v_class, v_schedule, d, v_starts[i], v_ends[i],
              v_teacher_ids[1 + (i % array_length(v_teacher_ids, 1))],
              v_status, 'assigned', v_actor)
      RETURNING id INTO v_session;

      -- 過去的課補建 event 並標記已點名 —— 出勤紀錄掛在 event 上
      IF d < current_date THEN
        INSERT INTO public.events (org_id, event_type, title, campus_id, event_date,
                                   start_time, end_time, attendance_taken_at)
        VALUES (v_org, 'session', v_class_names[i], v_campus, d,
                v_starts[i], v_ends[i], d + interval '19 hours')
        RETURNING id INTO v_event;
        UPDATE public.sessions SET event_id = v_event WHERE id = v_session;
      END IF;

      d := d + 7;
    END LOOP;
  END LOOP;

  -- ── 報名：每班 10 人，狀態有分布 ─────────────────────────────────────────
  FOR i IN 1 .. 6 LOOP
    FOR j IN 1 .. 10 LOOP
      k := 1 + (((i - 1) * 6 + j - 1) % array_length(v_student_ids, 1));
      INSERT INTO public.enrollments (org_id, class_id, student_id, status,
                                      effective_from, billing_mode, agreed_amount, created_by)
      VALUES (v_org, v_class_ids[i], v_student_ids[k],
              CASE WHEN j = 9  THEN 'pending_payment'::enrollment_status
                   WHEN j = 10 THEN 'suspended'::enrollment_status
                   ELSE 'active'::enrollment_status END,
              v_term_start,
              CASE WHEN i = 1 THEN 'session_pack'::billing_mode ELSE 'monthly'::billing_mode END,
              CASE WHEN i <= 4 THEN 4800 ELSE 3600 END,
              v_actor)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  -- ── 出勤：present / absent / on_leave 三種都要有 ─────────────────────────
  FOR v_session, v_event, v_class, d IN
    SELECT s.id, s.event_id, s.class_id, s.session_date
    FROM public.sessions s
    JOIN public.classes c ON c.id = s.class_id
    WHERE c.campus_id = v_campus AND s.event_id IS NOT NULL
  LOOP
    k := 0;
    FOR v_student IN
      SELECT e.student_id FROM public.enrollments e
      WHERE e.class_id = v_class AND e.status = 'active'
    LOOP
      k := k + 1;
      INSERT INTO public.attendance_records (org_id, event_id, student_id, status,
                                             recorded_by, recorded_by_role)
      VALUES (v_org, v_event, v_student,
              CASE WHEN (k + EXTRACT(DAY FROM d)::int) % 11 = 0 THEN 'absent'::attendance_status
                   WHEN (k + EXTRACT(DAY FROM d)::int) % 7  = 0 THEN 'on_leave'::attendance_status
                   ELSE 'present'::attendance_status END,
              v_actor, 'teacher');
    END LOOP;
  END LOOP;

  -- ── 請假單 ──────────────────────────────────────────────────────────────
  FOR i IN 1 .. 6 LOOP
    INSERT INTO public.leave_requests (org_id, student_id, start_date, end_date,
                                       reason, submitted_by, submitted_by_role)
    VALUES (v_org, v_student_ids[i * 3], current_date - (i * 5), current_date - (i * 5),
            (ARRAY['發燒請假','家中有事','參加校內比賽','看牙醫','家族旅遊','身體不適'])[i],
            v_actor, 'parent');
  END LOOP;

  -- ── 課務異動：停課 / 補課 / 調課 / 代課 ───────────────────────────────────
  FOR i IN 1 .. 6 LOOP
    -- 停課（挑一堂未來的）
    SELECT id INTO v_cancelled FROM public.sessions
    WHERE class_id = v_class_ids[i] AND session_date > current_date AND status = 'scheduled'
    ORDER BY session_date LIMIT 1;

    IF v_cancelled IS NOT NULL THEN
      UPDATE public.sessions SET status = 'cancelled' WHERE id = v_cancelled;

      INSERT INTO public.schedule_changes (org_id, session_id, change_type, reason,
                                           created_by_name, operation_source, original_session_date)
      SELECT v_org, v_cancelled, 'cancellation',
             (ARRAY['颱風停課','老師臨時有事','教室整修','國定假日','校外教學','設備維護'])[i],
             '行政櫃台', 'admin', session_date
      FROM public.sessions WHERE id = v_cancelled;

      -- 補課：`sessions_makeup_for_unique` 是 partial unique index ——
      -- 一堂停課最多配一堂**未取消**的補課。前三班各配一堂。
      IF i <= 3 THEN
        INSERT INTO public.sessions (org_id, class_id, session_date, start_time, end_time,
                                     teacher_id, status, assignment_status, created_by,
                                     makeup_for_session_id)
        SELECT v_org, class_id, session_date + 3, start_time, end_time,
               teacher_id, 'scheduled', 'assigned', v_actor, v_cancelled
        FROM public.sessions WHERE id = v_cancelled
        RETURNING id INTO v_session;

        INSERT INTO public.schedule_changes (org_id, session_id, change_type, reason,
                                             created_by_name, operation_source)
        VALUES (v_org, v_session, 'makeup', '停課補課', '行政櫃台', 'admin');
      END IF;
    END IF;

    -- 調課
    IF i <= 4 THEN
      SELECT id INTO v_session FROM public.sessions
      WHERE class_id = v_class_ids[i] AND session_date > current_date + 7
        AND status = 'scheduled' AND makeup_for_session_id IS NULL
      ORDER BY session_date LIMIT 1;

      IF v_session IS NOT NULL THEN
        INSERT INTO public.schedule_changes (org_id, session_id, change_type, new_session_date,
                                             reason, created_by_name, operation_source,
                                             original_session_date)
        SELECT v_org, v_session, 'reschedule', session_date + 1, '配合學校段考調整',
               '行政櫃台', 'admin', session_date
        FROM public.sessions WHERE id = v_session;

        UPDATE public.sessions SET session_date = session_date + 1 WHERE id = v_session;
      END IF;
    END IF;

    -- 代課
    IF i <= 3 THEN
      SELECT id INTO v_session FROM public.sessions
      WHERE class_id = v_class_ids[i] AND session_date > current_date + 14 AND status = 'scheduled'
      ORDER BY session_date LIMIT 1;

      IF v_session IS NOT NULL THEN
        INSERT INTO public.schedule_changes (org_id, session_id, change_type, substitute_teacher_id,
                                             reason, created_by_name, operation_source,
                                             original_teacher_id)
        SELECT v_org, v_session, 'substitute',
               v_teacher_ids[array_length(v_teacher_ids, 1)], '原老師研習',
               '行政櫃台', 'admin', teacher_id
        FROM public.sessions WHERE id = v_session;
      END IF;
    END IF;
  END LOOP;

  -- ── 校內考：分數要有分布，不要全部 90 ────────────────────────────────────
  FOR i IN 1 .. 4 LOOP
    INSERT INTO public.academy_exams (org_id, campus_id, name, exam_type, subject_id,
                                      exam_date, total_score, pass_score, status, created_by)
    VALUES (v_org, v_campus,
            (ARRAY['第一次數學小考','英文單字週考','國文複習考','自然模擬考'])[i],
            (ARRAY['quiz','quiz','quiz','mock_exam'])[i]::academy_exam_type,
            v_subj[i], current_date - (i * 12), 100, 60,
            CASE WHEN i = 4 THEN 'active' ELSE 'closed' END::academy_exam_status,
            v_actor)
    RETURNING id INTO v_exam;

    -- **考試一定要綁班，否則它在「班級視角」是隱形的。**
    --
    -- 這個不變量由 `POST /api/academy-exams` 的 zod 守（`classIds` 是
    -- `z.array(...).min(1)`，`routes/academy-exams.ts:117`），**而 DB 沒有任何約束** ——
    -- 所以走 SQL 就繞得過。第一版忘了寫這一段，造出 4 場「有成績、沒有班」的考試：
    -- 考試管理看得到（8/8 已登錄），班級視角每一班都說「尚未建立考試」，
    -- 因為 `GET /api/academy-exams?classId=` 是嚴格走這張表取交集的
    -- （`routes/academy-exams.ts:531-535`）。**兩個畫面都沒錯，是資料違反了不變量。**
    INSERT INTO public.academy_exam_classes (exam_id, class_id)
    VALUES (v_exam, v_class_ids[i])
    ON CONFLICT DO NOTHING;

    k := 0;
    FOR v_student IN
      SELECT DISTINCT e.student_id FROM public.enrollments e
      WHERE e.class_id = v_class_ids[i] AND e.status = 'active'
    LOOP
      k := k + 1;
      -- 38 ~ 98 的分布 + 少數缺考
      INSERT INTO public.academy_scores (exam_id, student_id, score, status, created_by)
      VALUES (v_exam, v_student,
              CASE WHEN k % 13 = 0 THEN NULL ELSE 38 + ((k * 17 + i * 29) % 61) END,
              CASE WHEN k % 13 = 0 THEN 'absent' ELSE 'scored' END::score_status,
              v_actor)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  -- ── 學校段考 ────────────────────────────────────────────────────────────
  FOR i IN 1 .. 2 LOOP
    INSERT INTO public.school_exams (org_id, academic_year, semester, exam_type, name, label,
                                     exam_date, status, school_id, subject_id)
    VALUES (v_org, 114, 1, 'term_exam',
            (ARRAY['第一次段考','第二次段考'])[i],
            (ARRAY['114 上 第一次段考','114 上 第二次段考'])[i],
            -- `school_exams_subject_only_when_other`：段考的 subject_id 必須是 NULL，
            -- 科目住在 `school_scores` 那一層（一次段考有很多科）
            current_date - (i * 25), 'closed'::school_exam_status, v_school_a, NULL)
    RETURNING id INTO v_exam;

    k := 0;
    FOR v_student IN
      SELECT id FROM public.students
      WHERE org_id = v_org AND school_id = v_school_a ORDER BY name LIMIT 20
    LOOP
      k := k + 1;
      INSERT INTO public.school_scores (school_exam_id, student_id, subject_id, score,
                                        status, created_by)
      VALUES (v_exam, v_student, v_subj[1], 42 + ((k * 23 + i * 13) % 57),
              'scored'::score_status, v_actor)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  -- ── 繳費：未繳 / 已繳 / 逾期 ─────────────────────────────────────────────
  -- **`invoices` 沒有 status 欄位** —— 狀態是推導的（`due_date` 與 `payment_records`
  -- 的關係）。所以「逾期」是靠「due_date 已過 + 沒有付款紀錄」造出來的，
  -- 不是塞一個字串。驗收查詢也要照這個推導寫（見下方註解）。
  SELECT COALESCE(MAX(receipt_no), 0) INTO v_receipt
  FROM public.payment_records WHERE org_id = v_org;

  k := 0;
  FOREACH v_student IN ARRAY v_student_ids[1:24] LOOP
    k := k + 1;
    INSERT INTO public.invoices (org_id, student_id, issued_at, due_date, note, created_by)
    VALUES (v_org, v_student, current_date - 40,
            CASE WHEN k % 3 = 0 THEN current_date - 12    -- 已過期
                 WHEN k % 3 = 1 THEN current_date + 5     -- 快到期
                 ELSE current_date + 20 END,              -- 還早
            '本期學費', v_actor)
    RETURNING id INTO v_invoice;

    INSERT INTO public.invoice_items (invoice_id, type, amount, period_month, note)
    VALUES (v_invoice, 'tuition', CASE WHEN k % 2 = 0 THEN 4800 ELSE 3600 END,
            date_trunc('month', current_date)::date, '月費');

    -- 一部分已繳；`k % 3 = 0`（已過期那批）刻意不繳 → 那就是逾期
    IF k % 2 = 0 AND k % 3 <> 0 THEN
      v_receipt := v_receipt + 1;
      INSERT INTO public.payment_records (org_id, invoice_id, kind, amount, method,
                                          paid_at, receipt_no, recorded_by)
      VALUES (v_org, v_invoice, 'payment',
              CASE WHEN k % 2 = 0 THEN 4800 ELSE 3600 END,
              CASE WHEN k % 4 = 0 THEN 'transfer' ELSE 'cash' END::payment_method,
              current_date - 8, v_receipt, v_actor);
    END IF;
  END LOOP;

  -- ── 堂數包：剩很多 / 快用完 / 已用完 ─────────────────────────────────────
  -- 第 1 班是 session_pack 模式，已上約 10 堂，所以 24 / 12 / 8 分別對應三種畫面。
  k := 0;
  FOR v_enrollment IN
    SELECT id FROM public.enrollments
    WHERE org_id = v_org AND billing_mode = 'session_pack'
      AND class_id = ANY(v_class_ids)
  LOOP
    k := k + 1;
    INSERT INTO public.session_packs (org_id, enrollment_id, purchased_count,
                                      purchased_at, note, created_by)
    VALUES (v_org, v_enrollment, (ARRAY[24, 12, 8])[1 + (k % 3)],
            v_term_start, (ARRAY['購買 24 堂','購買 12 堂','購買 8 堂'])[1 + (k % 3)],
            v_actor);
  END LOOP;

  -- ── 讓「代課」與「批次指派老師」按得下去（#849）──────────────────────────
  --
  -- **問題**：這一支建了文山旗艦校與它的課堂、指派了任課老師，
  -- 卻沒有把那些老師登記進 `staff_campuses` —— 而代課／批次指派的候選讀的正是它
  -- （前端 `session-assign-dialog`、後端 `sessions.ts` 的 `substitute` 與
  -- `batch-assign-teacher` **三處一致**，後兩者會回 409 / skip）。
  --
  -- 於是本機 101 堂課（84%）所在的分校**一位被指派的老師都沒有**，
  -- 兩個動作在任何一堂課上都按不下去（#849 量到的）。
  --
  -- **修法是補資料不是放寬產品**：`staff_campuses` 是產品明確且在 API 層強制的判準，
  -- 放寬前端候選只會變成「選得到但送不出去」。
  --
  -- 兩件都要做，少一件代課仍然沒有候選：
  --   1. 有課堂的分校 → 它的任課老師要有該校的 `staff_campuses` 列
  --   2. 每個（分校, 科目）**至少 2 位**老師 —— 代課清單會排除原任課老師，
  --      只有 1 位的話扣掉他就是空的（#849 在示範分校01 量到的正是這個）
  --
  -- 資料驅動、`ON CONFLICT DO NOTHING`，所以重跑會自我修復（同本檔其餘部分）。

  -- 1. 任課老師 → 他實際在教的那個分校
  INSERT INTO public.staff_campuses (staff_id, campus_id)
  SELECT DISTINCT sch.teacher_id, cl.campus_id
    FROM public.schedules sch
    JOIN public.classes cl ON cl.id = sch.class_id
   WHERE cl.org_id = v_org AND sch.teacher_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- 2. 任課老師 → 他實際在教的那個科目
  INSERT INTO public.staff_subjects (staff_id, subject_id)
  SELECT DISTINCT sch.teacher_id, co.subject_id
    FROM public.schedules sch
    JOIN public.classes cl ON cl.id = sch.class_id
    JOIN public.courses co ON co.id = cl.course_id
   WHERE cl.org_id = v_org AND sch.teacher_id IS NOT NULL AND co.subject_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- 3. 每個（分校, 科目）補到至少 2 位 —— 把本檔用到的那批老師（`v_teacher_ids`）
  --    交叉指派到「有課堂的分校 × 那些課堂的科目」。
  --    **只補這 6 位、只補有課堂的分校**：不動其他分校的指派，
  --    也不讓全機構每個老師都變成能教所有科目。
  INSERT INTO public.staff_campuses (staff_id, campus_id)
  SELECT DISTINCT t.staff_id, x.campus_id
    FROM unnest(v_teacher_ids) AS t(staff_id)
    CROSS JOIN (
      SELECT DISTINCT cl.campus_id
        FROM public.classes cl
        JOIN public.schedules sch ON sch.class_id = cl.id
       WHERE cl.org_id = v_org
    ) AS x
  ON CONFLICT DO NOTHING;

  INSERT INTO public.staff_subjects (staff_id, subject_id)
  SELECT DISTINCT t.staff_id, x.subject_id
    FROM unnest(v_teacher_ids) AS t(staff_id)
    CROSS JOIN (
      SELECT DISTINCT co.subject_id
        FROM public.classes cl
        JOIN public.schedules sch ON sch.class_id = cl.id
        JOIN public.courses co ON co.id = cl.course_id
       WHERE cl.org_id = v_org AND co.subject_id IS NOT NULL
    ) AS x
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'seed-demo 套用完成。';
END $$;

-- ============================================================================
-- 回填：把「有成績卻沒綁班」的考試補上關聯
--
-- **這一段在早退守衛之外，所以已經套過 seed-demo 的環境再跑一次這支檔就會被修好。**
--
-- 為什麼需要它：第一版漏寫 `academy_exam_classes`，而上面那個「已套用就跳出」的守衛
-- 會讓修好的版本對已經套過的環境**完全無效** —— 檔案改對了，而受害的那些環境永遠拿不到。
-- **一個只對新環境生效的修法，跟沒修一樣**（本機與 usability-admin 用的就是舊的那份）。
--
-- 判斷「該綁哪一班」不靠順序，靠資料本身：**成績上的那些學生，在哪一班有生效中的報名。**
-- 只有唯一解時才補，避免猜錯 —— 補不了的會被下面的驗收查詢照出來。
-- ============================================================================
INSERT INTO public.academy_exam_classes (exam_id, class_id)
SELECT orphan.exam_id, orphan.class_id
FROM (
  SELECT s.exam_id, e.class_id, count(*) AS n
  FROM public.academy_scores s
  JOIN public.enrollments e
    ON e.student_id = s.student_id AND e.status = 'active'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.academy_exam_classes aec WHERE aec.exam_id = s.exam_id
  )
  GROUP BY s.exam_id, e.class_id
) orphan
-- 一場考試的成績可能橫跨多班（學生同時在數學 A 班與進階班），
-- 那種情況下「唯一解」不成立 —— 取覆蓋最多學生的那一班，平手就都不補。
WHERE orphan.n = (
  SELECT max(o2.n) FROM (
    SELECT e2.class_id, count(*) AS n
    FROM public.academy_scores s2
    JOIN public.enrollments e2 ON e2.student_id = s2.student_id AND e2.status = 'active'
    WHERE s2.exam_id = orphan.exam_id
    GROUP BY e2.class_id
  ) o2
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 驗收查詢（套用前後各跑一次，比差值）
--
-- ⚠️ **不要用 `invoices.status`** —— 那個欄位不存在。逾期要照推導寫：
--    `due_date < current_date` 且沒有足額付款。
--
--   select
--     (select count(*) from public.sessions)                                        as 課堂,
--     (select count(*) from public.sessions where status = 'cancelled')             as 停課,
--     (select count(*) from public.sessions where makeup_for_session_id is not null) as 補課,
--     (select count(*) from public.students)                                        as 學生,
--     (select count(*) from public.academy_exams ae where not exists (
--        select 1 from public.academy_exam_classes aec where aec.exam_id = ae.id))    as 孤兒考試,  -- 必須是 0
--     (select count(*) from public.invoices i
--        where i.due_date < current_date
--          and coalesce((select sum(pr.amount) from public.payment_records pr
--                        where pr.invoice_id = i.id and pr.kind = 'payment'), 0)
--              < coalesce((select sum(ii.amount) from public.invoice_items ii
--                          where ii.invoice_id = i.id), 0))                          as 逾期發票;
-- ============================================================================

-- =============================================================================
-- ===== 以下整段從 `seed.sql` 搬過來（#838）=====
-- =============================================================================
--
-- **為什麼搬**：這一段（#685）指名依賴 `張宇軒` / `范芷寧` / `文山旗艦校` /
-- `國三數學 A 班`，而**那四樣是這個檔案造的，不是 `seed.sql` 造的**
-- （`grep` 在 `seed.sql` 裡只有 SELECT 與 guard，沒有任何 INSERT）。
-- 它原本寫在 `seed.sql` 裡，是因為當時本機已經手動套過這一支 ——
-- 而 `db:reset` 只跑 `seed.sql`（`config.toml` 的 `sql_paths`）。
--
-- 後果：**`db:reset` 一跑就在這個 guard 上 RAISE EXCEPTION，整批 rollback，
-- 本機變成空庫**（2026-09-13，#838）。
--
-- ⚠️ **只把 `seed-demo.sql` 加進 `sql_paths` 是不夠的**：`sql_paths` 是有序的，
-- 而 `seed-demo.sql` 依賴 `seed.sql` 的帳號（檔頭第 18 行），所以 `seed.sql` 必須先跑。
-- 這一段留在 `seed.sql` 裡就仍然跑在本檔之前 —— **搬過來是必要的，不是整理。**
--
-- 歸屬上也對：它做的事逐字是「展示狀態補齊」，而這一支就是展示資料。
-- =============================================================================

-- =============================================================================
-- ===== 展示狀態補齊 —— 讓 UI 地圖的「未驗」驗得到（#685 Phase 1 後續）=====
-- =============================================================================
--
-- 53 頁地圖驗完之後盤點剩下的「未驗」：**只有約三分之一是漏做，其餘是展示資料
-- 只有一種狀態** —— 學生全在籍、家長與人員全 active、分校全啟用、沒有任何多重
-- 角色的帳號。於是「停用列的選單」「啟用帳號」「角色選擇彈窗」這些分支
-- **繫結存在、畫面上摸不到**（那是「未驗」不是「不會發生」）。
--
-- ⚠️ **零 `ba_*` 寫入（c2）。** 這一段**不建任何新帳號** ——
--   `supabase/seed.sql` 對 c2 有 9 筆永久豁免，那個數字是上限不是額度。
--   需要 `user_id` 的東西（家長、人員、角色）**一律掛到既有的 demo 帳號上**，
--   只寫 `user_roles` / `parents` / `staff` 這些業務表。
--
-- ⚠️ **關於「加法優先」的一個修正**：初版堅持「既有資料一列都不動」，
--   但零新帳號之後，「停用家長／停用人員」只能改既有列的 status。
--   **真正的規則不是「不准翻面」，是「不要翻掉某個狀態的最後一個實例」** ——
--   翻 2 位家長（共 16）、2 位人員（共 101）之後，active 那一邊還有 14 與 99 個實例，
--   兩種狀態同時存在；而如果只有一筆資料還把它翻掉，就是用新狀態換掉舊狀態。
--   （這條是 labor-5 擋下「把 >100 筆成績塞給王柏翰」時提出的，那裡翻掉的
--   是那個孩子**唯一**的「正常清單」狀態，所以不行；這裡不是。）
--
-- ⚠️ **刻意不做的兩件**（做了會翻掉最後一個實例，淨損）：
--   1. 讓某個家長收不到公告 —— 全庫只有一則家長公告且是全 org，
--      要做出「目前沒有公告」只能刪掉它，而「有公告」是已驗狀態
--   2. `organizations.attendance_retroactive_days` 0 → N —— 會讓老師課表上
--      所有舊課堂變成「點名已截止」，把「開始點名／修改點名」整批換掉
--
-- 挑中的既有帳號都是**沒有任何課堂的老師**（動它們不影響課表與點名）。

DO $$
DECLARE
  demo_org_id UUID := '11111111-1111-1111-1111-111111111111';
  v_uid TEXT;
  v_parent_id UUID;
  v_student_id UUID;
BEGIN
  -- ── 1. 停用的學生（students 沒有 user_id，可以純新增）──────────────────
  -- admin/students 的「停用列選單」與「・停用 M」錨點；students/:id 的
  -- 「加入班級」在停用學生上會消失
  INSERT INTO public.students (org_id, name, grade, is_active, notes)
  SELECT demo_org_id, '離校示範生', 'J2'::public.grade_level, FALSE, '展示用：停用狀態'
  WHERE NOT EXISTS (SELECT 1 FROM public.students WHERE org_id = demo_org_id AND name = '離校示範生');

  -- ── 2. 非 active 的家長（16 位裡翻 2 位，active 還有 14 位）──────────────
  UPDATE public.parents p SET status = 'inactive', notes = '展示用：停用狀態'
  FROM public.ba_user u
  WHERE u.id = p.user_id AND u.email = 'parent14@demo.clessia.app' AND p.status = 'active';

  UPDATE public.parents p SET status = 'archived', notes = '展示用：封存狀態'
  FROM public.ba_user u
  WHERE u.id = p.user_id AND u.email = 'parent15@demo.clessia.app' AND p.status = 'active';

  -- ── 3. 非 active 的人員（101 位裡翻 2 位，active 還有 99 位）─────────────
  -- 挑的是**沒有帶任何課堂**的老師，停用它們不會讓課表少一個人
  UPDATE public.staff s SET status = 'inactive', notes = '展示用：停用狀態'
  FROM public.ba_user u
  WHERE u.id = s.user_id AND u.email = 'teacher0007@demo.clessia.app' AND s.status = 'active';

  UPDATE public.staff s SET status = 'archived', notes = '展示用：封存狀態'
  FROM public.ba_user u
  WHERE u.id = s.user_id AND u.email = 'teacher0009@demo.clessia.app' AND s.status = 'active';

  -- ── 4. 多重角色 + 只有 view_reports 的管理員（同一個帳號，一石二鳥）─────
  -- 全庫本來 0 個多重角色帳號，於是 /select-role 的角色選擇彈窗
  -- **任何帳號都開不出來**，shell-layout 的角色切換入口同理。
  -- 這裡給一位沒帶課的老師加上 admin 角色，權限只給 view_reports：
  --   * 兩個角色 → 登入後進 /select-role 的彈窗
  --   * 選 admin 進去 → /admin/reports 進得去，
  --     而 fee-templates / meals / payments 被 permissionGuard 導回 /admin
  SELECT id INTO v_uid FROM public.ba_user WHERE email = 'teacher0001@demo.clessia.app';
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role, permissions)
    VALUES (v_uid, 'admin', '["view_reports"]'::jsonb)
    ON CONFLICT (user_id, role) DO UPDATE SET permissions = EXCLUDED.permissions;
  END IF;

  -- ── 5. 單一孩子的家長 / 沒有孩子的家長（parent-child-switcher 兩種形態）──
  -- ⚠️ 全庫本來就有一位只綁 1 個孩子的家長（陳美惠），**但她的帳號沒有 parent
  --    角色**，roleGuard 會把她擋在 /parent/** 外面 —— 照名字挑她會做出一個
  --    看起來合理、實際上驗不到東西的東西。所以這裡另外指定，角色一起給。
  --    `parents.user_id` 沒有唯一約束，所以既有的老師帳號可以同時是家長
  --    （現實上教職員的小孩在自家補習班上課本來就會這樣）。
  --
  -- ⚠️ **已知的取捨：這兩個帳號同時也是「多重角色」帳號。**
  --    要驗「單孩的靜態徽章」或「0 孩不渲染」，得先被 /select-role 的角色選擇
  --    彈窗攔一次、選家長才進得去 —— **一個帳號背兩個測試狀態，其中一個壞掉
  --    會擋住另一個**（labor-5 提出，判斷成立）。
  --
  --    **沒有更好的做法，原因是硬的**：要一個「只有 parent 角色」的帳號就得有
  --    一個沒有其他角色的 `ba_user`，而 seed 造的每一個帳號都已經是
  --    admin / teacher / parent 其中之一；新建帳號會撞 c2 的豁免上限。
  --    其餘替代方案（拔掉既有 parent 的關聯做出「只剩 1 個孩子」、
  --    或拿掉老師的 teacher 角色）都是改既有資料，會產生更難解釋的殘骸
  --    （沒有角色的 staff 列、失去家長的學生）。
  --
  --    所以**留著這個耦合並寫在這裡**，讓驗的人知道那一步不是缺陷。
  SELECT id INTO v_uid FROM public.ba_user WHERE email = 'teacher0005@demo.clessia.app';
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role, permissions)
    VALUES (v_uid, 'parent', '[]'::jsonb) ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.parents (org_id, user_id, name, status, notes)
    SELECT demo_org_id, v_uid, '陳靖雯', 'active', '展示用：只綁 1 個孩子'
    WHERE NOT EXISTS (SELECT 1 FROM public.parents WHERE user_id = v_uid);
    SELECT id INTO v_parent_id FROM public.parents WHERE user_id = v_uid LIMIT 1;

    SELECT id INTO v_student_id FROM public.students
     WHERE org_id = demo_org_id AND name = '范芷寧' LIMIT 1;
    IF v_parent_id IS NOT NULL AND v_student_id IS NOT NULL THEN
      INSERT INTO public.parent_student_relations (parent_id, student_id, relation, is_primary)
      VALUES (v_parent_id, v_student_id, 'parent', FALSE)
      ON CONFLICT (parent_id, student_id) DO NOTHING;
    END IF;
  END IF;

  SELECT id INTO v_uid FROM public.ba_user WHERE email = 'teacher0006@demo.clessia.app';
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role, permissions)
    VALUES (v_uid, 'parent', '[]'::jsonb) ON CONFLICT (user_id, role) DO NOTHING;

    -- **刻意不插 parent_student_relations** —— 這一位就是「0 個孩子」的那個形態
    INSERT INTO public.parents (org_id, user_id, name, status, notes)
    SELECT demo_org_id, v_uid, '楊柏睿', 'active', '展示用：一個孩子都沒綁'
    WHERE NOT EXISTS (SELECT 1 FROM public.parents WHERE user_id = v_uid);
  END IF;
END $$;

DO $$
DECLARE
  demo_org_id UUID := '11111111-1111-1111-1111-111111111111';
  v_campus_id UUID;
  v_course_id UUID;
  v_class_id UUID;
  v_side_student UUID;
BEGIN
  SELECT id INTO v_campus_id FROM public.campuses WHERE org_id = demo_org_id AND name = '文山旗艦校' LIMIT 1;
  SELECT id INTO v_side_student FROM public.students WHERE org_id = demo_org_id AND name = '范芷寧' LIMIT 1;

  -- ── 4. 停用的分校（settings/campuses 的「顯示停用分校」與「啟用分校」）──
  INSERT INTO public.campuses (org_id, name, address, phone, is_active)
  SELECT demo_org_id, '已停辦示範校', '台北市示範區停辦路 1 號', '02-2899-0000', FALSE
  WHERE NOT EXISTS (SELECT 1 FROM public.campuses WHERE org_id = demo_org_id AND name = '已停辦示範校');

  -- ── 5. 停用的價目表（fee-templates 列選單的「啟用」）────────────────────
  INSERT INTO public.fee_templates (org_id, name, billing_mode, amount, is_active)
  SELECT demo_org_id, '舊制月繳（已停用）', 'monthly'::public.billing_mode, 4000, FALSE
  WHERE NOT EXISTS (SELECT 1 FROM public.fee_templates WHERE org_id = demo_org_id AND name = '舊制月繳（已停用）');

  -- ── 6. 學校：0 名學生的（刪得掉）與停用的 ───────────────────────────────
  INSERT INTO public.schools (org_id, name, short_name, is_active)
  SELECT demo_org_id, '示範可刪除國中', '可刪除國中', TRUE
  WHERE NOT EXISTS (SELECT 1 FROM public.schools WHERE org_id = demo_org_id AND name = '示範可刪除國中');
  INSERT INTO public.schools (org_id, name, short_name, is_active)
  SELECT demo_org_id, '示範已停用高中', '已停用高中', FALSE
  WHERE NOT EXISTS (SELECT 1 FROM public.schools WHERE org_id = demo_org_id AND name = '示範已停用高中');

  -- ── 7. 沒被任何課程引用的科目（subject-manager 的 🗑 才按得下去）────────
  INSERT INTO public.subjects (org_id, name, sort_order)
  SELECT demo_org_id, '示範可刪科目', 99
  WHERE NOT EXISTS (SELECT 1 FROM public.subjects WHERE org_id = demo_org_id AND name = '示範可刪科目');

  -- ── 8. 沒有任何課堂的班級（admin/courses 的「刪除班級」才啟用）──────────
  SELECT id INTO v_course_id FROM public.courses WHERE org_id = demo_org_id ORDER BY created_at LIMIT 1;
  IF v_course_id IS NOT NULL AND v_campus_id IS NOT NULL THEN
    INSERT INTO public.classes (org_id, campus_id, course_id, name, max_students, is_active, start_date)
    SELECT demo_org_id, v_campus_id, v_course_id, '示範空班（無課堂）', 10, TRUE, CURRENT_DATE + 30
    WHERE NOT EXISTS (SELECT 1 FROM public.classes WHERE org_id = demo_org_id AND name = '示範空班（無課堂）');
  END IF;

  -- ── 9. 未指派老師的課堂（admin/sessions 列選單的「指派老師」）────────────
  SELECT id INTO v_class_id FROM public.classes WHERE org_id = demo_org_id AND name = '國三數學 A 班' LIMIT 1;
  IF v_class_id IS NOT NULL THEN
    INSERT INTO public.sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status, teacher_id)
    SELECT demo_org_id, v_class_id, CURRENT_DATE + 3, '19:00', '21:00', 'scheduled', 'unassigned'::public.session_assignment_status, NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM public.sessions
      WHERE class_id = v_class_id AND session_date = CURRENT_DATE + 3 AND start_time = '19:00'
    );
  END IF;

  -- ── 10. 進行中的請假（admin/leave 的 active 取消文案；既有只有 past 與 future）──
  IF v_side_student IS NOT NULL THEN
    INSERT INTO public.leave_requests (org_id, student_id, start_date, end_date, reason, submitted_by, submitted_by_role)
    SELECT demo_org_id, v_side_student, CURRENT_DATE - 1, CURRENT_DATE + 2,
           '展示用：跨越今天的請假（進行中）', '22222222-2222-2222-2222-222222222222', 'admin'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.leave_requests
      WHERE student_id = v_side_student AND start_date = CURRENT_DATE - 1 AND end_date = CURRENT_DATE + 2
    );
  END IF;
END $$;

DO $$
DECLARE
  demo_org_id UUID := '11111111-1111-1111-1111-111111111111';
  v_campus_id UUID;
  v_campus2_id UUID;
  v_heavy_student UUID;
  v_side_student UUID;
  v_class_id UUID;
  v_class2_id UUID;
  v_enrollment_id UUID;
  v_enrollment2_id UUID;
  v_event_id UUID;
  v_session_id UUID;
  v_invoice_id UUID;
  v_exam_id UUID;
  v_subject_id UUID;
  v_teacher_id UUID;
  v_i INT;
  v_d DATE;
BEGIN
  SELECT id INTO v_campus_id  FROM public.campuses WHERE org_id = demo_org_id AND name = '文山旗艦校' LIMIT 1;
  SELECT id INTO v_campus2_id FROM public.campuses WHERE org_id = demo_org_id AND name = '示範分校01' LIMIT 1;
  SELECT id INTO v_heavy_student FROM public.students WHERE org_id = demo_org_id AND name = '張宇軒' LIMIT 1;
  SELECT id INTO v_side_student  FROM public.students WHERE org_id = demo_org_id AND name = '范芷寧' LIMIT 1;
  SELECT class_id INTO v_class_id FROM public.enrollments WHERE student_id = v_heavy_student LIMIT 1;

  -- ── 11. 已結算的餐記錄（admin/meals 的 `已結算` 狀態、tooltip 與鎖住）────
  -- 既有 18 筆餐記錄的 invoice_item_id 全是 null，所以「已結算」摸不到。
  -- 這裡補一天，並把它掛到一張真的帳單明細上（月結會做的事，這裡直接做結果）。
  IF v_heavy_student IS NOT NULL THEN
    INSERT INTO public.invoices (org_id, student_id, issued_at, due_date, note)
    SELECT demo_org_id, v_heavy_student, CURRENT_DATE - 20, CURRENT_DATE - 6, '展示用：含已結算餐費'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.invoices WHERE student_id = v_heavy_student AND note = '展示用：含已結算餐費'
    )
    RETURNING id INTO v_invoice_id;

    IF v_invoice_id IS NULL THEN
      SELECT id INTO v_invoice_id FROM public.invoices
      WHERE student_id = v_heavy_student AND note = '展示用：含已結算餐費' LIMIT 1;
    END IF;

    INSERT INTO public.invoice_items (invoice_id, type, amount, note)
    SELECT v_invoice_id, 'meal'::public.invoice_item_type, 390, '展示用：6 天餐費'
    WHERE NOT EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = v_invoice_id);

    FOR v_i IN 0..5 LOOP
      v_d := CURRENT_DATE - 26 + v_i;
      INSERT INTO public.meal_records (org_id, student_id, meal_date, ordered, chargeable, unit_price, invoice_item_id, note, created_by)
      SELECT demo_org_id, v_heavy_student, v_d, TRUE, TRUE, 65,
             (SELECT id FROM public.invoice_items WHERE invoice_id = v_invoice_id LIMIT 1),
             '展示用：已結算', '22222222-2222-2222-2222-222222222222'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.meal_records WHERE student_id = v_heavy_student AND meal_date = v_d
      );
    END LOOP;
  END IF;

  -- ── 12. 跨分校的帳單（admin/reports 的模糊桶 `（跨分校）`）──────────────
  -- 一張帳單的兩筆明細指向**不同分校**的班級 → 後端不做比例拆分，自成一組。
  SELECT id INTO v_class2_id FROM public.classes
   WHERE org_id = demo_org_id AND campus_id = v_campus2_id AND id <> COALESCE(v_class_id, id) LIMIT 1;
  SELECT id INTO v_enrollment_id  FROM public.enrollments WHERE student_id = v_heavy_student LIMIT 1;

  IF v_heavy_student IS NOT NULL AND v_class2_id IS NOT NULL THEN
    -- 讓他在另一個分校的班也有一筆報名（跨分校的前提）
    INSERT INTO public.enrollments (org_id, class_id, student_id, status, effective_from, billing_mode, agreed_amount, notes)
    SELECT demo_org_id, v_class2_id, v_heavy_student, 'active'::public.enrollment_status, CURRENT_DATE - 60,
           'monthly'::public.billing_mode, 3000, '展示用：跨分校帳單的第二個分校'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.enrollments WHERE student_id = v_heavy_student AND class_id = v_class2_id
    );
    SELECT id INTO v_enrollment2_id FROM public.enrollments
     WHERE student_id = v_heavy_student AND class_id = v_class2_id LIMIT 1;

    INSERT INTO public.invoices (org_id, student_id, issued_at, due_date, note)
    SELECT demo_org_id, v_heavy_student, CURRENT_DATE - 5, CURRENT_DATE + 9, '展示用：跨分校帳單'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.invoices WHERE student_id = v_heavy_student AND note = '展示用：跨分校帳單'
    );
    SELECT id INTO v_invoice_id FROM public.invoices
     WHERE student_id = v_heavy_student AND note = '展示用：跨分校帳單' LIMIT 1;

    INSERT INTO public.invoice_items (invoice_id, type, enrollment_id, amount, note)
    SELECT v_invoice_id, 'tuition'::public.invoice_item_type, v_enrollment_id, 4800, '文山旗艦校的班'
    WHERE NOT EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = v_invoice_id AND enrollment_id = v_enrollment_id);
    INSERT INTO public.invoice_items (invoice_id, type, enrollment_id, amount, note)
    SELECT v_invoice_id, 'tuition'::public.invoice_item_type, v_enrollment2_id, 3000, '示範分校01 的班'
    WHERE NOT EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = v_invoice_id AND enrollment_id = v_enrollment2_id);
  END IF;

  -- ── 13. 同一天兩筆出勤 + 掛在停課課堂上的出勤（parent/attendance 兩個未驗）──
  IF v_side_student IS NOT NULL AND v_campus_id IS NOT NULL THEN
    -- 13a. 同一天兩筆 → 驗「一次只能展開一則 / 切換展開」
    FOR v_i IN 1..2 LOOP
      INSERT INTO public.events (org_id, event_type, title, campus_id, event_date, start_time, end_time, attendance_taken_at)
      SELECT demo_org_id, 'session'::public.event_type,
             '展示用：同日第 ' || v_i || ' 堂', v_campus_id, CURRENT_DATE - 4,
             (ARRAY['10:00','14:00'])[v_i]::time, (ARRAY['12:00','16:00'])[v_i]::time, NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM public.events
        WHERE org_id = demo_org_id AND event_date = CURRENT_DATE - 4
          AND title = '展示用：同日第 ' || v_i || ' 堂'
      );
      SELECT id INTO v_event_id FROM public.events
       WHERE org_id = demo_org_id AND event_date = CURRENT_DATE - 4
         AND title = '展示用：同日第 ' || v_i || ' 堂' LIMIT 1;

      INSERT INTO public.attendance_records (org_id, event_id, student_id, status, note, recorded_by, recorded_by_role)
      SELECT demo_org_id, v_event_id, v_side_student,
             (ARRAY['present','on_leave'])[v_i]::public.attendance_status,
             '展示用：同一天的第 ' || v_i || ' 筆', '22222222-2222-2222-2222-222222222222', 'admin'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.attendance_records WHERE event_id = v_event_id AND student_id = v_side_student
      );
    END LOOP;

    -- 13b. 停課課堂上的出勤 → 驗 `停課` chip（chip 只看 sessions.status='cancelled'）
    INSERT INTO public.events (org_id, event_type, title, campus_id, event_date, start_time, end_time)
    SELECT demo_org_id, 'session'::public.event_type, '展示用：停課那一堂', v_campus_id,
           CURRENT_DATE - 7, '10:00', '12:00'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.events WHERE org_id = demo_org_id AND title = '展示用：停課那一堂'
    );
    SELECT id INTO v_event_id FROM public.events
     WHERE org_id = demo_org_id AND title = '展示用：停課那一堂' LIMIT 1;

    SELECT class_id INTO v_class2_id FROM public.enrollments WHERE student_id = v_side_student LIMIT 1;
    -- 這個班原本的老師 —— `sessions_assignment_consistent_chk` 要求
    -- assigned 必須有 teacher_id、unassigned 必須沒有，兩者不能混
    SELECT teacher_id INTO v_teacher_id FROM public.sessions
     WHERE class_id = v_class2_id AND teacher_id IS NOT NULL LIMIT 1;
    IF v_class2_id IS NOT NULL THEN
      INSERT INTO public.sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status, teacher_id, event_id)
      SELECT demo_org_id, v_class2_id, CURRENT_DATE - 7, '10:00', '12:00', 'cancelled',
             CASE WHEN v_teacher_id IS NULL THEN 'unassigned' ELSE 'assigned' END::public.session_assignment_status,
             v_teacher_id, v_event_id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.sessions WHERE event_id = v_event_id
      );
    END IF;

    INSERT INTO public.attendance_records (org_id, event_id, student_id, status, note, recorded_by, recorded_by_role)
    SELECT demo_org_id, v_event_id, v_side_student, 'on_leave'::public.attendance_status,
           '展示用：這一堂停課了', '22222222-2222-2222-2222-222222222222', 'admin'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.attendance_records WHERE event_id = v_event_id AND student_id = v_side_student
    );
  END IF;
END $$;

-- ── 14. 三筆「量」的極端值，集中在**張宇軒**（parent03 的小孩）───────────
-- 刻意不放在 parent01 的三個孩子身上：那三個是「空 / 有資料但正常」的基準，
-- 而 >100 筆成績會讓**截斷警告永遠掛在那個孩子身上**（沒有分頁 UI），
-- 等於用一個新狀態換掉一個已驗狀態。三筆放同一個孩子，驗的時候登 parent03 一次就好。
DO $$
DECLARE
  demo_org_id UUID := '11111111-1111-1111-1111-111111111111';
  v_student UUID;
  v_campus_id UUID;
  v_subject_id UUID;
  v_exam_id UUID;
  v_event_id UUID;
  v_invoice_id UUID;
  v_enrollment_id UUID;
  v_i INT;
  v_d DATE;
BEGIN
  SELECT id INTO v_student   FROM public.students WHERE org_id = demo_org_id AND name = '張宇軒' LIMIT 1;
  SELECT id INTO v_campus_id FROM public.campuses WHERE org_id = demo_org_id AND name = '文山旗艦校' LIMIT 1;
  SELECT id INTO v_subject_id FROM public.subjects WHERE org_id = demo_org_id AND name = '數學' LIMIT 1;
  SELECT id INTO v_enrollment_id FROM public.enrollments WHERE student_id = v_student LIMIT 1;

  IF v_student IS NULL THEN RETURN; END IF;

  -- 14a. 近 30 天 > 50 筆出勤 → parent/attendance 的「載入更多」（pageSize=50）
  FOR v_i IN 1..56 LOOP
    v_d := CURRENT_DATE - (v_i % 28) - 1;
    INSERT INTO public.events (org_id, event_type, title, campus_id, event_date, start_time, end_time, attendance_taken_at)
    SELECT demo_org_id, 'session'::public.event_type, '展示用：量測用課堂 #' || v_i,
           v_campus_id, v_d, '18:00', '20:00', NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.events WHERE org_id = demo_org_id AND title = '展示用：量測用課堂 #' || v_i
    );
    SELECT id INTO v_event_id FROM public.events
     WHERE org_id = demo_org_id AND title = '展示用：量測用課堂 #' || v_i LIMIT 1;

    INSERT INTO public.attendance_records (org_id, event_id, student_id, status, recorded_by, recorded_by_role)
    SELECT demo_org_id, v_event_id, v_student,
           (ARRAY['present','present','present','absent','on_leave'])[(v_i % 5) + 1]::public.attendance_status,
           '22222222-2222-2222-2222-222222222222', 'admin'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.attendance_records WHERE event_id = v_event_id AND student_id = v_student
    );
  END LOOP;

  -- 14b. > 100 筆成績 → parent/grades 的截斷警告（PAGE_SIZE=100，無分頁 UI）
  FOR v_i IN 1..104 LOOP
    INSERT INTO public.academy_exams (org_id, campus_id, name, exam_type, subject_id, exam_date, total_score, status, created_by, pass_score)
    SELECT demo_org_id, v_campus_id, '展示用：小考 #' || v_i, 'quiz'::public.academy_exam_type,
           v_subject_id, CURRENT_DATE - (v_i % 90) - 1, 100, 'closed', '22222222-2222-2222-2222-222222222222', 60
    WHERE NOT EXISTS (
      SELECT 1 FROM public.academy_exams WHERE org_id = demo_org_id AND name = '展示用：小考 #' || v_i
    );
    SELECT id INTO v_exam_id FROM public.academy_exams
     WHERE org_id = demo_org_id AND name = '展示用：小考 #' || v_i LIMIT 1;

    INSERT INTO public.academy_scores (exam_id, student_id, score, status, created_by)
    SELECT v_exam_id, v_student, 40 + (v_i * 7 % 60), 'scored'::public.score_status, '22222222-2222-2222-2222-222222222222'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.academy_scores WHERE exam_id = v_exam_id AND student_id = v_student
    );
  END LOOP;

  -- 14c. > 20 張帳單 → parent/payments 的「載入更多」（pageSize=20）
  FOR v_i IN 1..23 LOOP
    INSERT INTO public.invoices (org_id, student_id, issued_at, due_date, note)
    SELECT demo_org_id, v_student, CURRENT_DATE - (v_i * 7), CURRENT_DATE - (v_i * 7) + 14,
           '展示用：量測用帳單 #' || v_i
    WHERE NOT EXISTS (
      SELECT 1 FROM public.invoices WHERE student_id = v_student AND note = '展示用：量測用帳單 #' || v_i
    );
    SELECT id INTO v_invoice_id FROM public.invoices
     WHERE student_id = v_student AND note = '展示用：量測用帳單 #' || v_i LIMIT 1;

    INSERT INTO public.invoice_items (invoice_id, type, enrollment_id, amount, note)
    SELECT v_invoice_id, 'tuition'::public.invoice_item_type, v_enrollment_id, 3600, '展示用'
    WHERE NOT EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = v_invoice_id);
  END LOOP;
END $$;

-- ── 15. 今天有課、但聯絡簿沒寫完（admin/contact-book 的缺漏名單與「補寫」）──
-- 缺漏名單問的是「今天有課的聯絡簿班級裡，誰還沒有 entry」。
-- 既有 seed 在「今天」把該寫的都寫完了，所以那一頁預設是空的。
-- 這裡**不刪任何已寫的**，改成幫今天的聯絡簿班級加一名新學生 —— 他自然就是缺漏的那一個。
DO $$
DECLARE
  demo_org_id UUID := '11111111-1111-1111-1111-111111111111';
  v_class_id UUID;
  v_student_id UUID;
BEGIN
  SELECT c.id INTO v_class_id
  FROM public.classes c
  JOIN public.sessions s ON s.class_id = c.id AND s.session_date = CURRENT_DATE AND s.status <> 'cancelled'
  WHERE c.org_id = demo_org_id AND c.uses_contact_book = TRUE
  LIMIT 1;

  IF v_class_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.students (org_id, name, grade, is_active, notes)
  SELECT demo_org_id, '聯絡簿缺漏示範生', 'P5'::public.grade_level, TRUE, '展示用：今天有課但沒寫聯絡簿'
  WHERE NOT EXISTS (SELECT 1 FROM public.students WHERE org_id = demo_org_id AND name = '聯絡簿缺漏示範生');
  SELECT id INTO v_student_id FROM public.students
   WHERE org_id = demo_org_id AND name = '聯絡簿缺漏示範生' LIMIT 1;

  INSERT INTO public.enrollments (org_id, class_id, student_id, status, effective_from, billing_mode, agreed_amount, notes)
  SELECT demo_org_id, v_class_id, v_student_id, 'active'::public.enrollment_status, CURRENT_DATE - 30,
         'monthly'::public.billing_mode, 3600, '展示用：製造聯絡簿缺漏'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.enrollments WHERE student_id = v_student_id AND class_id = v_class_id
  );
END $$;

-- ── 保險：這一段靠「名字／email」找既有資料，找不到會**靜默什麼都不做** ──────
-- 那是最糟的失敗模式：seed 跑完 exit 0，而該有的展示狀態一個都沒造出來，
-- 下一個人打開頁面看到的跟以前一模一樣，然後把「未驗」再抄一次。
-- 這裡把它變成大聲的失敗。**塞過陷阱驗它會紅。**
DO $$
DECLARE
  demo_org_id UUID := '11111111-1111-1111-1111-111111111111';
  v_missing TEXT := '';
BEGIN
  -- 依賴的既有資料
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE org_id = demo_org_id AND name = '張宇軒')
    THEN v_missing := v_missing || ' 學生:張宇軒'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE org_id = demo_org_id AND name = '范芷寧')
    THEN v_missing := v_missing || ' 學生:范芷寧'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.campuses WHERE org_id = demo_org_id AND name = '文山旗艦校')
    THEN v_missing := v_missing || ' 分校:文山旗艦校'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.classes WHERE org_id = demo_org_id AND name = '國三數學 A 班')
    THEN v_missing := v_missing || ' 班級:國三數學 A 班'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ba_user WHERE email = 'teacher0001@demo.clessia.app')
    THEN v_missing := v_missing || ' 帳號:teacher0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ba_user WHERE email = 'parent14@demo.clessia.app')
    THEN v_missing := v_missing || ' 帳號:parent14'; END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION '展示狀態補齊段找不到它依賴的既有資料：%。上游 seed 改過名字或帳號，這一段會靜默失效 —— 請更新這裡的指名。', v_missing;
  END IF;

  -- 產出點名：每一種狀態都要真的出現
  IF (SELECT count(*) FROM public.students WHERE org_id = demo_org_id AND is_active = FALSE) = 0
    THEN RAISE EXCEPTION '沒有造出停用學生'; END IF;
  IF (SELECT count(*) FROM public.parents WHERE status <> 'active') < 2
    THEN RAISE EXCEPTION '沒有造出 inactive/archived 家長'; END IF;
  IF (SELECT count(*) FROM public.staff WHERE status <> 'active') < 2
    THEN RAISE EXCEPTION '沒有造出 inactive/archived 人員'; END IF;
  IF (SELECT count(*) FROM (SELECT user_id FROM public.user_roles GROUP BY user_id HAVING count(*) > 1) x) = 0
    THEN RAISE EXCEPTION '沒有造出多重角色帳號 —— /select-role 的彈窗仍然沒有帳號開得出來'; END IF;
  IF (SELECT count(*) FROM public.meal_records WHERE invoice_item_id IS NOT NULL) = 0
    THEN RAISE EXCEPTION '沒有造出已結算的餐記錄'; END IF;
  IF (SELECT count(*) FROM public.campuses WHERE org_id = demo_org_id AND is_active = FALSE) = 0
    THEN RAISE EXCEPTION '沒有造出停用分校'; END IF;
  IF (SELECT count(*) FROM public.sessions WHERE assignment_status = 'unassigned') = 0
    THEN RAISE EXCEPTION '沒有造出未指派老師的課堂'; END IF;
  IF (SELECT count(*) FROM public.leave_requests
       WHERE start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE) = 0
    THEN RAISE EXCEPTION '沒有造出跨越今天的請假'; END IF;

  RAISE NOTICE '展示狀態補齊完成（#685）';
END $$;
