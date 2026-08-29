DO $$
DECLARE
    demo_org_id UUID := '11111111-1111-1111-1111-111111111111';
    demo_admin_id UUID := '22222222-2222-2222-2222-222222222222';
    demo_admin_email TEXT := 'admin@demo.clessia.app';
    subject_names TEXT[] := ARRAY['國文', '英文', '數學', '自然', '社會', '其他', '物理', '化學'];
    teacher_last_names TEXT[] := ARRAY['王', '李', '張', '劉', '陳', '楊', '黃', '吳', '林', '蔡', '許', '鄭', '謝', '郭', '洪', '邱', '曾', '廖', '賴', '徐', '周', '葉'];
    teacher_given_names TEXT[] := ARRAY['宥廷', '語涵', '品妍', '承恩', '靖雯', '柏睿', '佳穎', '哲宇', '鈺婷', '冠廷', '怡君', '昱辰', '詠晴', '家豪', '沛蓉', '博鈞', '心妤', '睿恩', '雅筑', '泓安', '子恩', '彥廷', '欣妍', '宇翔'];
    course_themes TEXT[] := ARRAY[
        '七年級基礎先修班',
        '八年級重點進階班',
        '九年級會考總複習班',
        '高一銜接先修班',
        '高二重點強化班',
        '高三學測衝刺班',
        '段考高分實戰班',
        '閱讀素養培訓班',
        '作文表達精修班',
        '小班題型破解班',
        '寒暑期密集特訓班'
    ];
    campus_index INTEGER;
    course_index INTEGER;
    subject_index INTEGER;
    staff_index INTEGER;
    teacher_index INTEGER := 0;
    v_campus_id UUID;
    v_campus_name TEXT;
    v_course_name TEXT;
    v_subject_name TEXT;
    v_grade_levels TEXT[];
    v_teacher_display_name TEXT;
    admin_user_id TEXT;
    admin_user_uuid UUID;
    v_admin_staff_id UUID;
    teacher_user_id TEXT;
    teacher_user_uuid UUID;
    v_teacher_staff_id UUID;
BEGIN
    -- 1. Insert users into Better Auth ba_user table
    -- 曾經有一個 `root` 超級帳號。**已移除**（2026-08-28）：
    --   * 它沒有密碼（密碼登入整條路已刪）
    --   * email 是 NULL，所以 `npm run login-link`（用 email 查人）對它無效
    --   * `bootstrap-org.ts` 從來不建它 —— 正式站根本沒有這一列
    -- 「超級帳號」這個概念因此**沒有任何實例**。破窗改由 login-link 提供，
    -- 而且那個設計更好：客戶換掉 DATABASE_URL 就能撤銷供應商的存取（c12）。
    INSERT INTO public.ba_user (id, name, email, "emailVerified", username, "orgId", "createdAt", "updatedAt")
    VALUES
        (demo_admin_id::text, 'Demo Admin', demo_admin_email, true, 'demo_admin', NULL, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        "emailVerified" = EXCLUDED."emailVerified",
        username = EXCLUDED.username,
        "updatedAt" = NOW();

    -- 2. 這裡原本插入 ba_account 的密碼憑證（scrypt hash）。已全部移除：
    --
    --    a) **這個系統沒有密碼登入了** —— scrypt 超過 Cloudflare Workers 的 10ms CPU
    --       上限，見 kb/wiki/architecture/line-oauth-login.md
    --    b) 更嚴重的是那兩個 hash 是**寫死在版控裡的**。每個從這支 seed 開的站，
    --       root 密碼都一樣 —— 一間補習班的資料庫外洩，等於所有客戶的最高權限
    --       一起外洩
    --
    -- 本機開發要登入：`LOGIN_EMAIL=admin@demo.clessia.app npm run login-link` 產生一次性連結。
    -- 跟正式環境同一條路，不必為本機另外維護一套。

    -- 3. Insert demo organization
    INSERT INTO public.organizations (id, name, slug)
    VALUES (demo_org_id, 'Demo 補習班', 'demo')
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug,
        updated_at = NOW();

    -- 4. Update Better Auth users orgId after organization is created
    UPDATE public.ba_user
    SET "orgId" = demo_org_id
    WHERE id = demo_admin_id::text;

    -- 5. Ensure profiles exist with org_id (must be before user_roles due to FK)
    INSERT INTO public.profiles (id, display_name, org_id)
    VALUES
        (demo_admin_id, 'Demo Admin', demo_org_id)
    ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        org_id = EXCLUDED.org_id;

    -- 6. Insert demo user_roles
    INSERT INTO public.user_roles (user_id, role, permissions)
    VALUES
        (demo_admin_id::text, 'admin', '["*"]'::jsonb)
    ON CONFLICT (user_id, role) DO UPDATE SET
        permissions = EXCLUDED.permissions;

    -- 7. Cleanup previous generated demo data (so rerun keeps exact counts)
    DELETE FROM public.staff_subjects
    WHERE staff_id IN (
        SELECT id FROM public.staff WHERE org_id = demo_org_id AND (user_id LIKE '30000000-0000-0000-0000-%' OR user_id LIKE '40000000-0000-0000-0000-%')
    );

    DELETE FROM public.staff_campuses
    WHERE staff_id IN (
        SELECT id FROM public.staff WHERE org_id = demo_org_id AND (user_id LIKE '30000000-0000-0000-0000-%' OR user_id LIKE '40000000-0000-0000-0000-%')
    );

    DELETE FROM public.staff
    WHERE org_id = demo_org_id AND (user_id LIKE '30000000-0000-0000-0000-%' OR user_id LIKE '40000000-0000-0000-0000-%');

    DELETE FROM public.user_roles
    WHERE user_id LIKE '30000000-0000-0000-0000-%' OR user_id LIKE '40000000-0000-0000-0000-%';

    DELETE FROM public.profiles
    WHERE id::text LIKE '30000000-0000-0000-0000-%' OR id::text LIKE '40000000-0000-0000-0000-%';

    DELETE FROM public.ba_user
    WHERE id LIKE '30000000-0000-0000-0000-%' OR id LIKE '40000000-0000-0000-0000-%';

    DELETE FROM public.courses
    WHERE org_id = demo_org_id;

    DELETE FROM public.campuses
    WHERE org_id = demo_org_id;

    -- 8. Insert all subjects for demo org (defaults + extras)
    INSERT INTO public.subjects (org_id, name, sort_order)
    VALUES
        (demo_org_id, '國文', 0),
        (demo_org_id, '英文', 1),
        (demo_org_id, '數學', 2),
        (demo_org_id, '自然', 3),
        (demo_org_id, '社會', 4),
        (demo_org_id, '其他', 5),
        (demo_org_id, '物理', 6),
        (demo_org_id, '化學', 7)
    ON CONFLICT (org_id, name) DO UPDATE SET
        sort_order = EXCLUDED.sort_order;

    -- 9. Generate 11 campuses and 11 courses per campus (total 121 courses)
    FOR campus_index IN 1..11 LOOP
        v_campus_name := format('示範分校%s', lpad(campus_index::text, 2, '0'));

        INSERT INTO public.campuses (org_id, name, address, phone, is_active)
        VALUES (
            demo_org_id,
            v_campus_name,
            format('台北市示範區校園路%s號', campus_index),
            '02-28' || lpad(campus_index::text, 2, '0') || '-' || (1000 + campus_index)::text,
            true
        )
        ON CONFLICT (org_id, name) DO UPDATE SET
            address = EXCLUDED.address,
            phone = EXCLUDED.phone,
            is_active = EXCLUDED.is_active,
            updated_at = NOW()
        RETURNING id INTO v_campus_id;

        FOR course_index IN 1..11 LOOP
            v_subject_name := subject_names[((course_index - 1) % array_length(subject_names, 1)) + 1];
            v_course_name := format('%s %s', v_subject_name, course_themes[course_index]);
            v_grade_levels := CASE course_index
                WHEN 1 THEN ARRAY['J1']
                WHEN 2 THEN ARRAY['J2']
                WHEN 3 THEN ARRAY['J3']
                WHEN 4 THEN ARRAY['S1']
                WHEN 5 THEN ARRAY['S2']
                WHEN 6 THEN ARRAY['S3']
                WHEN 7 THEN ARRAY['J2', 'J3']
                WHEN 8 THEN ARRAY['P5', 'P6']
                WHEN 9 THEN ARRAY['J1', 'J2']
                WHEN 10 THEN ARRAY['J2', 'J3']
                ELSE ARRAY['S1', 'S2']
            END;

            INSERT INTO public.courses (org_id, campus_id, name, subject_id, description, is_active, grade_levels)
            VALUES (
                demo_org_id,
                v_campus_id,
                v_course_name,
                (
                    SELECT id FROM public.subjects
                    WHERE org_id = demo_org_id AND name = v_subject_name
                    LIMIT 1
                ),
                format('%s｜%s｜示範課程', v_campus_name, v_course_name),
                true,
                v_grade_levels
            )
            ON CONFLICT (campus_id, name) DO UPDATE SET
                subject_id = EXCLUDED.subject_id,
                description = EXCLUDED.description,
                grade_levels = EXCLUDED.grade_levels,
                is_active = EXCLUDED.is_active,
                updated_at = NOW();
        END LOOP;
    END LOOP;

    -- 10. Generate 11 admins
    FOR staff_index IN 1..11 LOOP
        v_campus_name := format('示範分校%s', lpad(staff_index::text, 2, '0'));
        SELECT id INTO v_campus_id
        FROM public.campuses
        WHERE org_id = demo_org_id AND name = v_campus_name
        LIMIT 1;

        v_subject_name := subject_names[((staff_index - 1) % array_length(subject_names, 1)) + 1];

        -- Admin user + profile + role + staff
        admin_user_id := format('30000000-0000-0000-0000-%s', lpad(staff_index::text, 12, '0'));
        admin_user_uuid := admin_user_id::uuid;

        INSERT INTO public.ba_user (id, name, email, "emailVerified", username, "orgId", "createdAt", "updatedAt")
        VALUES (
            admin_user_id,
            format('管理員%s', lpad(staff_index::text, 2, '0')),
            'admin' || lpad(staff_index::text, 2, '0') || '@demo.clessia.app',
            true,
            'demo_admin_' || lpad(staff_index::text, 2, '0'),
            demo_org_id,
            NOW(),
            NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            email = EXCLUDED.email,
            username = EXCLUDED.username,
            "orgId" = EXCLUDED."orgId",
            "updatedAt" = NOW();

        -- 不再插入密碼憑證（見檔案上方說明）。要登入就用 npm run login-link。

        INSERT INTO public.profiles (id, display_name, org_id)
        VALUES (admin_user_uuid, format('管理員%s', lpad(staff_index::text, 2, '0')), demo_org_id)
        ON CONFLICT (id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            org_id = EXCLUDED.org_id;

        INSERT INTO public.user_roles (user_id, role, permissions)
        VALUES (admin_user_id, 'admin', '["*"]'::jsonb)
        ON CONFLICT (user_id, role) DO UPDATE SET
            permissions = EXCLUDED.permissions;

        INSERT INTO public.staff (user_id, org_id, display_name, status)
        VALUES (
            admin_user_id,
            demo_org_id,
            format('管理員%s', lpad(staff_index::text, 2, '0')),
            'active'
        )
        ON CONFLICT (user_id, org_id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            status = EXCLUDED.status,
            updated_at = NOW()
        RETURNING id INTO v_admin_staff_id;

        INSERT INTO public.staff_campuses (staff_id, campus_id)
        VALUES (v_admin_staff_id, v_campus_id)
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- 11. Generate teachers by campus x subject
    FOR campus_index IN 1..11 LOOP
        v_campus_name := format('示範分校%s', lpad(campus_index::text, 2, '0'));
        SELECT id INTO v_campus_id
        FROM public.campuses
        WHERE org_id = demo_org_id AND name = v_campus_name
        LIMIT 1;

        FOR subject_index IN 1..array_length(subject_names, 1) LOOP
            teacher_index := teacher_index + 1;
            v_subject_name := subject_names[subject_index];

            -- Teacher user + profile + role + staff + subject link
            teacher_user_id := format('40000000-0000-0000-0000-%s', lpad(teacher_index::text, 12, '0'));
            teacher_user_uuid := teacher_user_id::uuid;

            v_teacher_display_name := format(
                '%s%s',
                teacher_last_names[((teacher_index - 1) % array_length(teacher_last_names, 1)) + 1],
                teacher_given_names[((teacher_index - 1) % array_length(teacher_given_names, 1)) + 1]
            );

            INSERT INTO public.ba_user (id, name, email, "emailVerified", username, "orgId", "createdAt", "updatedAt")
            VALUES (
                teacher_user_id,
                v_teacher_display_name,
                format('teacher%s@demo.clessia.app', lpad(teacher_index::text, 4, '0')),
                true,
                format('demo_teacher_%s', lpad(teacher_index::text, 4, '0')),
                demo_org_id,
                NOW(),
                NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                email = EXCLUDED.email,
                username = EXCLUDED.username,
                "orgId" = EXCLUDED."orgId",
                "updatedAt" = NOW();

            -- 不再插入密碼憑證（見檔案上方說明）。要登入就用 npm run login-link。

            INSERT INTO public.profiles (id, display_name, org_id)
            VALUES (teacher_user_uuid, v_teacher_display_name, demo_org_id)
            ON CONFLICT (id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                org_id = EXCLUDED.org_id;

            INSERT INTO public.user_roles (user_id, role, permissions)
            VALUES (teacher_user_id, 'teacher', '[]'::jsonb)
            ON CONFLICT (user_id, role) DO UPDATE SET
                permissions = EXCLUDED.permissions;

            INSERT INTO public.staff (user_id, org_id, display_name, status)
            VALUES (
                teacher_user_id,
                demo_org_id,
                v_teacher_display_name,
                'active'
            )
            ON CONFLICT (user_id, org_id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                status = EXCLUDED.status,
                updated_at = NOW()
            RETURNING id INTO v_teacher_staff_id;

            INSERT INTO public.staff_campuses (staff_id, campus_id)
            VALUES (v_teacher_staff_id, v_campus_id)
            ON CONFLICT DO NOTHING;

            INSERT INTO public.staff_subjects (staff_id, subject_id)
            VALUES (
                v_teacher_staff_id,
                (
                    SELECT id FROM public.subjects
                    WHERE org_id = demo_org_id AND name = v_subject_name
                    LIMIT 1
                )
            )
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;


-- ===== Students & Parents seed =====
DO $$
DECLARE
  demo_org_id UUID := '11111111-1111-1111-1111-111111111111';
  student_names TEXT[] := ARRAY[
    '林子璿', '陳宇翔', '張品妍', '王柏睿', '李語涵',
    '黃承恩', '劉靖雯', '吳宥廷', '鄭詠晴', '謝家豪',
    '楊欣妍', '蔡昱辰', '許怡君', '邱冠廷', '曾沛蓉'
  ];
  student_grades TEXT[] := ARRAY['J1','J2','J3','J1','P6','J3','S1','J2','P5','S2','J1','J3','P6','J2','S1'];
  student_schools TEXT[] := ARRAY[
    '台北市立文山國中', '新北市立景美國中', '台北市立木柵國中',
    '台北市立信義國中', '台北市立大安國小', '新北市立永和國中',
    '台北市立中正高中', '台北市立萬芳國中', '台北市立興隆國小',
    '台北市立南港高中', '台北市立內湖國中', '新北市立土城國中',
    '台北市立大直國小', '台北市立松山國中', '台北市立南港高中'
  ];
  parent_last_names TEXT[] := ARRAY['林', '陳', '張', '王', '李', '黃', '劉', '吳'];
  parent_given_names TEXT[] := ARRAY['志明', '淑芬', '建國', '美玲', '宗翰', '雅雯', '俊賢', '秀蘭'];
  v_student_id UUID;
  v_parent_id UUID;
  v_parent_user_id TEXT;
  student_index INTEGER;
BEGIN
  -- Cleanup（確保冪等）——順序很重要
  DELETE FROM public.parent_student_relations
    WHERE student_id IN (SELECT id FROM public.students WHERE org_id = demo_org_id);
  DELETE FROM public.parents WHERE org_id = demo_org_id;
  -- 清理對應的 ba_user（UUID 前綴 50000000-...）
  DELETE FROM public.ba_account
    WHERE "userId" LIKE '50000000-0000-0000-%';
  DELETE FROM public.ba_user
    WHERE id LIKE '50000000-0000-0000-%';
  DELETE FROM public.students WHERE org_id = demo_org_id;

  -- 先 seed 這批學生會用到的 schools（去重，冪等）
  INSERT INTO public.schools (org_id, name)
  SELECT DISTINCT demo_org_id, school_name
  FROM UNNEST(student_schools) AS school_name
  ON CONFLICT (org_id, name) DO NOTHING;

  -- 插入 students & parents
  FOR student_index IN 1..array_length(student_names, 1) LOOP
    -- 建立學生
    INSERT INTO public.students (org_id, name, grade, school_id, is_active)
    VALUES (
      demo_org_id,
      student_names[student_index],
      student_grades[student_index]::public.grade_level,
      (SELECT id FROM public.schools
        WHERE org_id = demo_org_id
          AND name = student_schools[student_index]
        LIMIT 1),
      TRUE
    )
    RETURNING id INTO v_student_id;

    -- 建立家長 ba_user（固定 UUID 前綴）
    v_parent_user_id := format('50000000-0000-0000-%s-%s',
      lpad(student_index::text, 4, '0'),
      lpad(student_index::text, 12, '0')
    );

    INSERT INTO public.ba_user (id, name, email, "emailVerified", username, "orgId", "createdAt", "updatedAt")
    VALUES (
      v_parent_user_id,
      parent_last_names[((student_index - 1) % 8) + 1] || parent_given_names[((student_index - 1) % 8) + 1],
      'parent' || lpad(student_index::text, 2, '0') || '@demo.clessia.app',
      true,
      '09' || LPAD((student_index * 12345678 % 100000000)::TEXT, 8, '0'),
      demo_org_id,
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      email = EXCLUDED.email,
      "orgId" = EXCLUDED."orgId",
      "updatedAt" = NOW();

    -- 不再插入密碼憑證（見檔案上方說明）。要登入就用 npm run login-link。

    -- 建立家長資料
    INSERT INTO public.parents (org_id, user_id, name, status)
    VALUES (
      demo_org_id,
      v_parent_user_id,
      parent_last_names[((student_index - 1) % 8) + 1] || parent_given_names[((student_index - 1) % 8) + 1],
      'active'
    )
    RETURNING id INTO v_parent_id;

    INSERT INTO public.parent_student_relations (parent_id, student_id, relation, is_primary)
    VALUES (v_parent_id, v_student_id, 'parent', TRUE);
  END LOOP;
END $$;

-- ===== Attendance test seed =====
DO $$
DECLARE
  demo_org_id UUID := '11111111-1111-1111-1111-111111111111';
  demo_campus_name TEXT := '示範分校01';
  demo_campus_id UUID;
  math_teacher_user_id TEXT := '40000000-0000-0000-0000-000000000003';
  english_teacher_user_id TEXT := '40000000-0000-0000-0000-000000000002';
  science_teacher_user_id TEXT := '40000000-0000-0000-0000-000000000004';
  math_teacher_id UUID;
  english_teacher_id UUID;
  science_teacher_id UUID;
  math_course_id UUID;
  english_course_id UUID;
  science_course_id UUID;
  math_class_id UUID := '62000000-0000-0000-0000-000000000001';
  english_class_id UUID := '62000000-0000-0000-0000-000000000002';
  science_class_id UUID := '62000000-0000-0000-0000-000000000003';
  student_names TEXT[] := ARRAY[
    '出勤測試學生01', '出勤測試學生02', '出勤測試學生03', '出勤測試學生04',
    '出勤測試學生05', '出勤測試學生06', '出勤測試學生07', '出勤測試學生08',
    '出勤測試學生09', '出勤測試學生10', '出勤測試學生11', '出勤測試學生12'
  ];
  student_grades TEXT[] := ARRAY['J1', 'J1', 'J2', 'J2', 'J3', 'J3', 'S1', 'S1', 'J1', 'J2', 'S2', 'S3'];
  student_schools TEXT[] := ARRAY[
    '台北市立測試國中', '台北市立測試國中', '新北市立測試國中', '新北市立測試國中',
    '桃園市立測試國中', '桃園市立測試國中', '台中市立測試高中', '台中市立測試高中',
    '新竹市立測試國中', '新竹市立測試國中', '台南市立測試高中', '高雄市立測試高中'
  ];
  student_index INTEGER;
  student_id UUID;
BEGIN
  SELECT id
  INTO demo_campus_id
  FROM public.campuses
  WHERE org_id = demo_org_id
    AND name = demo_campus_name
  LIMIT 1;

  IF demo_campus_id IS NULL THEN
    RAISE EXCEPTION 'Attendance seed campus not found: %', demo_campus_name;
  END IF;

  SELECT id INTO math_teacher_id FROM public.staff
    WHERE org_id = demo_org_id AND user_id = math_teacher_user_id LIMIT 1;
  SELECT id INTO english_teacher_id FROM public.staff
    WHERE org_id = demo_org_id AND user_id = english_teacher_user_id LIMIT 1;
  SELECT id INTO science_teacher_id FROM public.staff
    WHERE org_id = demo_org_id AND user_id = science_teacher_user_id LIMIT 1;

  SELECT id
  INTO math_course_id
  FROM public.courses
  WHERE org_id = demo_org_id
    AND campus_id = demo_campus_id
    AND name = '數學 九年級會考總複習班'
  LIMIT 1;

  SELECT id
  INTO english_course_id
  FROM public.courses
  WHERE org_id = demo_org_id
    AND campus_id = demo_campus_id
    AND name = '英文 八年級重點進階班'
  LIMIT 1;

  SELECT id
  INTO science_course_id
  FROM public.courses
  WHERE org_id = demo_org_id
    AND campus_id = demo_campus_id
    AND name = '自然 高一銜接先修班'
  LIMIT 1;

  IF math_course_id IS NULL OR english_course_id IS NULL OR science_course_id IS NULL THEN
    RAISE EXCEPTION 'Attendance seed courses not found for campus %', demo_campus_name;
  END IF;

  -- 先 seed 這批出勤測試學生會用到的 schools（去重，冪等）
  INSERT INTO public.schools (org_id, name)
  SELECT DISTINCT demo_org_id, school_name
  FROM UNNEST(student_schools) AS school_name
  ON CONFLICT (org_id, name) DO NOTHING;

  FOR student_index IN 1..12 LOOP
    student_id := format('61000000-0000-0000-0000-%s', lpad(student_index::text, 12, '0'))::uuid;

    INSERT INTO public.students (id, org_id, name, grade, school_id, email, is_active)
    VALUES (
      student_id,
      demo_org_id,
      student_names[student_index],
      student_grades[student_index]::public.grade_level,
      (SELECT id FROM public.schools
        WHERE org_id = demo_org_id
          AND name = student_schools[student_index]
        LIMIT 1),
      format('attendance-student-%s@demo.clessia.app', lpad(student_index::text, 2, '0')),
      TRUE
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  INSERT INTO public.classes (
    id,
    org_id,
    campus_id,
    course_id,
    name,
    max_students,
    grade_levels,
    is_active,
    start_date,
    updated_by
  )
  VALUES
    (
      math_class_id,
      demo_org_id,
      demo_campus_id,
      math_course_id,
      '數學班 A',
      20,
      ARRAY['J1', 'J2', 'J3'],
      TRUE,
      CURRENT_DATE - 30,
      math_teacher_user_id
    ),
    (
      english_class_id,
      demo_org_id,
      demo_campus_id,
      english_course_id,
      '英文班 B',
      20,
      ARRAY['J2', 'J3', 'S1'],
      TRUE,
      CURRENT_DATE - 30,
      english_teacher_user_id
    ),
    (
      science_class_id,
      demo_org_id,
      demo_campus_id,
      science_course_id,
      '自然班 C',
      20,
      ARRAY['J1', 'J2', 'S1', 'S2'],
      TRUE,
      CURRENT_DATE - 30,
      science_teacher_user_id
    )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.enrollments (
    org_id,
    class_id,
    student_id,
    status,
    effective_from,
    created_by
  )
  SELECT
    demo_org_id,
    math_class_id,
    format('61000000-0000-0000-0000-%s', lpad(student_no::text, 12, '0'))::uuid,
    'active'::public.enrollment_status,
    CURRENT_DATE - 30,
    math_teacher_user_id
  FROM generate_series(1, 8) AS student_no
  ON CONFLICT DO NOTHING;

  INSERT INTO public.enrollments (
    org_id,
    class_id,
    student_id,
    status,
    effective_from,
    created_by
  )
  SELECT
    demo_org_id,
    english_class_id,
    format('61000000-0000-0000-0000-%s', lpad(student_no::text, 12, '0'))::uuid,
    'active'::public.enrollment_status,
    CURRENT_DATE - 30,
    english_teacher_user_id
  FROM generate_series(5, 12) AS student_no
  ON CONFLICT DO NOTHING;

  INSERT INTO public.enrollments (
    org_id,
    class_id,
    student_id,
    status,
    effective_from,
    created_by
  )
  SELECT
    demo_org_id,
    science_class_id,
    science_students.s_id,
    'active'::public.enrollment_status,
    CURRENT_DATE - 30,
    science_teacher_user_id
  FROM (
    SELECT format('61000000-0000-0000-0000-%s', lpad(student_no::text, 12, '0'))::uuid AS s_id
    FROM generate_series(1, 4) AS student_no
    UNION ALL
    SELECT format('61000000-0000-0000-0000-%s', lpad(student_no::text, 12, '0'))::uuid AS s_id
    FROM generate_series(9, 12) AS student_no
  ) AS science_students
  ON CONFLICT DO NOTHING;

  -- ===== 計費地基（P1）=====
  -- 「期」是機構自建的具名日期區間，不是 enum —— 見 kb/wiki/rules/billing-rules.md
  INSERT INTO public.billing_periods (org_id, name, start_date, end_date)
  VALUES
    (demo_org_id, '2026 上學期 + 暑假', DATE '2026-02-01', DATE '2026-08-31'),
    (demo_org_id, '2026 下學期 + 寒假', DATE '2026-09-01', DATE '2027-01-31')
  ON CONFLICT (org_id, name) DO NOTHING;

  -- 價目表只給定價。實際談定的金額在 enrollments.agreed_amount（議價是常態）
  INSERT INTO public.fee_templates (org_id, name, billing_mode, amount)
  VALUES
    (demo_org_id, '國中主科月繳', 'monthly'::public.billing_mode, 4500),
    (demo_org_id, '國中主科期繳', 'period'::public.billing_mode, 24000),
    (demo_org_id, '才藝班 10 堂', 'session_pack'::public.billing_mode, 6000)
  ON CONFLICT (org_id, name) DO NOTHING;

  -- 讓 demo 報名帶上計費資料：數學班月繳、英文班期繳（同一批學生兩種模式並存，
  -- 正是「計費模式掛在報名上而不是班級上」要示範的情境）。自然班刻意留白 ——
  -- 「還沒決定計費方式」是真實狀態，nullable 不是偷懶。
  UPDATE public.enrollments e
     SET billing_mode = 'monthly'::public.billing_mode,
         fee_template_id = (SELECT id FROM public.fee_templates
                             WHERE org_id = demo_org_id AND name = '國中主科月繳'),
         agreed_amount = 4500
   WHERE e.class_id = math_class_id AND e.billing_mode IS NULL;

  UPDATE public.enrollments e
     SET billing_mode = 'period'::public.billing_mode,
         fee_template_id = (SELECT id FROM public.fee_templates
                             WHERE org_id = demo_org_id AND name = '國中主科期繳'),
         -- 議價示範：定價 24000，這班談成 22000
         agreed_amount = 22000,
         adjustment_note = '舊生續讀，老闆同意折 2000'
   WHERE e.class_id = english_class_id AND e.billing_mode IS NULL;

  INSERT INTO public.schedules (
    class_id,
    weekday,
    start_time,
    end_time,
    teacher_id,
    effective_to
  )
  VALUES
    (math_class_id, 1, '10:00'::time, '12:00'::time, math_teacher_id, NULL),
    (math_class_id, 3, '10:00'::time, '12:00'::time, math_teacher_id, NULL),
    (math_class_id, 5, '10:00'::time, '12:00'::time, math_teacher_id, NULL),
    (english_class_id, 2, '14:00'::time, '16:00'::time, english_teacher_id, NULL),
    (english_class_id, 4, '14:00'::time, '16:00'::time, english_teacher_id, NULL),
    (science_class_id, 6, '09:00'::time, '11:00'::time, science_teacher_id, NULL)
  ON CONFLICT (class_id, weekday, start_time) DO UPDATE SET
    end_time = EXCLUDED.end_time,
    teacher_id = EXCLUDED.teacher_id,
    effective_to = EXCLUDED.effective_to,
    updated_at = NOW();

  INSERT INTO public.events (
    id,
    org_id,
    event_type,
    title,
    campus_id,
    event_date,
    start_time,
    end_time
  )
  SELECT
    (
      substr(event_hash, 1, 8) || '-' ||
      substr(event_hash, 9, 4) || '-' ||
      substr(event_hash, 13, 4) || '-' ||
      substr(event_hash, 17, 4) || '-' ||
      substr(event_hash, 21, 12)
    )::uuid,
    demo_org_id,
    'session'::public.event_type,
    '數學班 A',
    demo_campus_id,
    event_date,
    '10:00'::time,
    '12:00'::time
  FROM (
    SELECT session_day::date AS event_date, md5('attendance-math-' || session_day::date::text) AS event_hash
    FROM generate_series(CURRENT_DATE - 14, CURRENT_DATE + 7, '1 day'::interval) AS session_day
    WHERE EXTRACT(DOW FROM session_day) IN (1, 3, 5)
  ) AS math_events
  ON CONFLICT DO NOTHING;

  INSERT INTO public.events (
    id,
    org_id,
    event_type,
    title,
    campus_id,
    event_date,
    start_time,
    end_time
  )
  SELECT
    (
      substr(event_hash, 1, 8) || '-' ||
      substr(event_hash, 9, 4) || '-' ||
      substr(event_hash, 13, 4) || '-' ||
      substr(event_hash, 17, 4) || '-' ||
      substr(event_hash, 21, 12)
    )::uuid,
    demo_org_id,
    'session'::public.event_type,
    '英文班 B',
    demo_campus_id,
    event_date,
    '14:00'::time,
    '16:00'::time
  FROM (
    SELECT session_day::date AS event_date, md5('attendance-english-' || session_day::date::text) AS event_hash
    FROM generate_series(CURRENT_DATE - 14, CURRENT_DATE + 7, '1 day'::interval) AS session_day
    WHERE EXTRACT(DOW FROM session_day) IN (2, 4)
  ) AS english_events
  ON CONFLICT DO NOTHING;

  INSERT INTO public.events (
    id,
    org_id,
    event_type,
    title,
    campus_id,
    event_date,
    start_time,
    end_time
  )
  SELECT
    (
      substr(event_hash, 1, 8) || '-' ||
      substr(event_hash, 9, 4) || '-' ||
      substr(event_hash, 13, 4) || '-' ||
      substr(event_hash, 17, 4) || '-' ||
      substr(event_hash, 21, 12)
    )::uuid,
    demo_org_id,
    'session'::public.event_type,
    '自然班 C',
    demo_campus_id,
    event_date,
    '09:00'::time,
    '11:00'::time
  FROM (
    SELECT session_day::date AS event_date, md5('attendance-science-' || session_day::date::text) AS event_hash
    FROM generate_series(CURRENT_DATE - 14, CURRENT_DATE + 7, '1 day'::interval) AS session_day
    WHERE EXTRACT(DOW FROM session_day) = 6
  ) AS science_events
  ON CONFLICT DO NOTHING;

  -- sessions rows（讓 events JOIN sessions 能取得 class_id）
  INSERT INTO public.sessions (
    org_id, class_id, schedule_id, session_date, start_time, end_time, teacher_id, assignment_status, event_id
  )
  SELECT
    demo_org_id,
    math_class_id,
    (
      SELECT sch.id
      FROM public.schedules sch
      WHERE sch.class_id = math_class_id
        AND sch.weekday = EXTRACT(ISODOW FROM event_date)::smallint
        AND sch.start_time = '10:00'::time
      LIMIT 1
    ),
    event_date,
    '10:00'::time,
    '12:00'::time,
    math_teacher_id::uuid,
    'assigned'::public.session_assignment_status,
    (
      substr(event_hash, 1, 8) || '-' ||
      substr(event_hash, 9, 4) || '-' ||
      substr(event_hash, 13, 4) || '-' ||
      substr(event_hash, 17, 4) || '-' ||
      substr(event_hash, 21, 12)
    )::uuid
  FROM (
    SELECT session_day::date AS event_date, md5('attendance-math-' || session_day::date::text) AS event_hash
    FROM generate_series(CURRENT_DATE - 14, CURRENT_DATE + 7, '1 day'::interval) AS session_day
    WHERE EXTRACT(DOW FROM session_day) IN (1, 3, 5)
  ) AS math_ev
  ON CONFLICT (class_id, session_date, start_time) DO NOTHING;

  INSERT INTO public.sessions (
    org_id, class_id, schedule_id, session_date, start_time, end_time, teacher_id, assignment_status, event_id
  )
  SELECT
    demo_org_id,
    english_class_id,
    (
      SELECT sch.id
      FROM public.schedules sch
      WHERE sch.class_id = english_class_id
        AND sch.weekday = EXTRACT(ISODOW FROM event_date)::smallint
        AND sch.start_time = '14:00'::time
      LIMIT 1
    ),
    event_date,
    '14:00'::time,
    '16:00'::time,
    english_teacher_id::uuid,
    'assigned'::public.session_assignment_status,
    (
      substr(event_hash, 1, 8) || '-' ||
      substr(event_hash, 9, 4) || '-' ||
      substr(event_hash, 13, 4) || '-' ||
      substr(event_hash, 17, 4) || '-' ||
      substr(event_hash, 21, 12)
    )::uuid
  FROM (
    SELECT session_day::date AS event_date, md5('attendance-english-' || session_day::date::text) AS event_hash
    FROM generate_series(CURRENT_DATE - 14, CURRENT_DATE + 7, '1 day'::interval) AS session_day
    WHERE EXTRACT(DOW FROM session_day) IN (2, 4)
  ) AS english_ev
  ON CONFLICT (class_id, session_date, start_time) DO NOTHING;

  INSERT INTO public.sessions (
    org_id, class_id, schedule_id, session_date, start_time, end_time, teacher_id, assignment_status, event_id
  )
  SELECT
    demo_org_id,
    science_class_id,
    (
      SELECT sch.id
      FROM public.schedules sch
      WHERE sch.class_id = science_class_id
        AND sch.weekday = EXTRACT(ISODOW FROM event_date)::smallint
        AND sch.start_time = '09:00'::time
      LIMIT 1
    ),
    event_date,
    '09:00'::time,
    '11:00'::time,
    science_teacher_id::uuid,
    'assigned'::public.session_assignment_status,
    (
      substr(event_hash, 1, 8) || '-' ||
      substr(event_hash, 9, 4) || '-' ||
      substr(event_hash, 13, 4) || '-' ||
      substr(event_hash, 17, 4) || '-' ||
      substr(event_hash, 21, 12)
    )::uuid
  FROM (
    SELECT session_day::date AS event_date, md5('attendance-science-' || session_day::date::text) AS event_hash
    FROM generate_series(CURRENT_DATE - 14, CURRENT_DATE + 7, '1 day'::interval) AS session_day
    WHERE EXTRACT(DOW FROM session_day) = 6
  ) AS science_ev
  ON CONFLICT (class_id, session_date, start_time) DO NOTHING;

  INSERT INTO public.attendance_records (
    org_id,
    event_id,
    student_id,
    status,
    note,
    recorded_by,
    recorded_by_role
  )
  WITH past_events AS (
    SELECT
      e.id,
      e.org_id,
      e.title,
      row_number() OVER (PARTITION BY e.title ORDER BY e.event_date, e.start_time, e.id) AS event_rank
    FROM public.events e
    WHERE e.org_id = demo_org_id
      AND e.title IN ('數學班 A', '英文班 B', '自然班 C')
      AND (e.event_date + e.start_time) < NOW()
  ),
  active_enrollments AS (
    SELECT enr.class_id, enr.student_id
    FROM public.enrollments enr
    WHERE enr.org_id = demo_org_id
      AND class_id IN (math_class_id, english_class_id, science_class_id)
      AND status = 'active'
      AND effective_from <= CURRENT_DATE
      AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
  )
  SELECT
    demo_org_id,
    past_events.id,
    active_enrollments.student_id,
    CASE
      WHEN past_events.title = '數學班 A'
        AND past_events.event_rank = 1
        AND active_enrollments.student_id = '61000000-0000-0000-0000-000000000001'::uuid
        THEN 'absent'::public.attendance_status
      WHEN past_events.title = '英文班 B'
        AND past_events.event_rank = 1
        AND active_enrollments.student_id = '61000000-0000-0000-0000-000000000005'::uuid
        THEN 'absent'::public.attendance_status
      WHEN past_events.title = '自然班 C'
        AND past_events.event_rank = 1
        AND active_enrollments.student_id = '61000000-0000-0000-0000-000000000009'::uuid
        THEN 'absent'::public.attendance_status
      ELSE 'present'::public.attendance_status
    END,
    CASE
      WHEN past_events.title = '數學班 A'
        AND past_events.event_rank = 1
        AND active_enrollments.student_id = '61000000-0000-0000-0000-000000000001'::uuid
        THEN '固定測試缺席'
      WHEN past_events.title = '英文班 B'
        AND past_events.event_rank = 1
        AND active_enrollments.student_id = '61000000-0000-0000-0000-000000000005'::uuid
        THEN '固定測試缺席'
      WHEN past_events.title = '自然班 C'
        AND past_events.event_rank = 1
        AND active_enrollments.student_id = '61000000-0000-0000-0000-000000000009'::uuid
        THEN '固定測試缺席'
      ELSE NULL
    END,
    CASE past_events.title
      WHEN '數學班 A' THEN math_teacher_user_id
      WHEN '英文班 B' THEN english_teacher_user_id
      ELSE science_teacher_user_id
    END,
    'teacher'
  FROM past_events
  JOIN active_enrollments
    ON active_enrollments.class_id = CASE past_events.title
      WHEN '數學班 A' THEN math_class_id
      WHEN '英文班 B' THEN english_class_id
      ELSE science_class_id
    END
  ON CONFLICT DO NOTHING;

  UPDATE public.events
  SET attendance_taken_at = NOW()
  WHERE org_id = demo_org_id
    AND title = '數學班 A'
    AND event_date = CURRENT_DATE;
END $$;

-- ============================================================
-- EXAM & SCORE SEED DATA
-- ============================================================
DO $$
DECLARE
  demo_org_id UUID := '11111111-1111-1111-1111-111111111111';
  demo_campus_id UUID;
  demo_admin_id TEXT := '22222222-2222-2222-2222-222222222222';
  -- class ids (from attendance seed)
  math_class_id UUID := '62000000-0000-0000-0000-000000000001';
  english_class_id UUID := '62000000-0000-0000-0000-000000000002';
  science_class_id UUID := '62000000-0000-0000-0000-000000000003';
  -- subject ids (looked up)
  math_subject_id UUID;
  english_subject_id UUID;
  science_subject_id UUID;
  chinese_subject_id UUID;
  social_subject_id UUID;
  -- academy exam ids
  ae_math_quiz_1 UUID := '70000000-0000-0000-0000-000000000001';
  ae_math_quiz_2 UUID := '70000000-0000-0000-0000-000000000002';
  ae_english_mock UUID := '70000000-0000-0000-0000-000000000003';
  ae_science_quiz UUID := '70000000-0000-0000-0000-000000000004';
  ae_math_placement UUID := '70000000-0000-0000-0000-000000000005';
  ae_closed_exam UUID := '70000000-0000-0000-0000-000000000006';
  -- term exam ids
  te_114_1_mid UUID := '71000000-0000-0000-0000-000000000001';
  te_114_1_fin UUID := '71000000-0000-0000-0000-000000000002';
  te_113_2_fin UUID := '71000000-0000-0000-0000-000000000003';
  -- student base
  s_id UUID;
  i INTEGER;
  v_score NUMERIC(6,2);
BEGIN
  -- Look up campus
  SELECT id INTO demo_campus_id
  FROM public.campuses
  WHERE org_id = demo_org_id AND name = '示範分校01'
  LIMIT 1;

  -- Look up subjects
  SELECT id INTO math_subject_id FROM public.subjects WHERE org_id = demo_org_id AND name = '數學';
  SELECT id INTO english_subject_id FROM public.subjects WHERE org_id = demo_org_id AND name = '英文';
  SELECT id INTO science_subject_id FROM public.subjects WHERE org_id = demo_org_id AND name = '自然';
  SELECT id INTO chinese_subject_id FROM public.subjects WHERE org_id = demo_org_id AND name = '國文';
  SELECT id INTO social_subject_id FROM public.subjects WHERE org_id = demo_org_id AND name = '社會';

  -- Cleanup previous exam seed data
  DELETE FROM public.academy_scores WHERE exam_id IN (
    ae_math_quiz_1, ae_math_quiz_2, ae_english_mock, ae_science_quiz, ae_math_placement, ae_closed_exam
  );
  DELETE FROM public.academy_exam_classes WHERE exam_id IN (
    ae_math_quiz_1, ae_math_quiz_2, ae_english_mock, ae_science_quiz, ae_math_placement, ae_closed_exam
  );
  DELETE FROM public.academy_exams WHERE id IN (
    ae_math_quiz_1, ae_math_quiz_2, ae_english_mock, ae_science_quiz, ae_math_placement, ae_closed_exam
  );
  DELETE FROM public.school_scores WHERE school_exam_id IN (te_114_1_mid, te_114_1_fin, te_113_2_fin);
  DELETE FROM public.school_exams WHERE id IN (te_114_1_mid, te_114_1_fin, te_113_2_fin);

  -- ========================================
  -- ACADEMY EXAMS (6 exams)
  -- ========================================

  -- 1. 數學小考 第1回 (active, has scores)
  INSERT INTO public.academy_exams (id, org_id, campus_id, name, exam_type, subject_id, exam_date, total_score, scope_note, status, created_by)
  VALUES (ae_math_quiz_1, demo_org_id, demo_campus_id, '數學小考 第1回', 'quiz', math_subject_id, CURRENT_DATE - INTERVAL '14 days', 100, '第一章 整數與分數', 'active', demo_admin_id);

  INSERT INTO public.academy_exam_classes (exam_id, class_id) VALUES
    (ae_math_quiz_1, math_class_id);

  -- 2. 數學小考 第2回 (active, no scores yet)
  INSERT INTO public.academy_exams (id, org_id, campus_id, name, exam_type, subject_id, exam_date, total_score, scope_note, status, created_by)
  VALUES (ae_math_quiz_2, demo_org_id, demo_campus_id, '數學小考 第2回', 'quiz', math_subject_id, CURRENT_DATE - INTERVAL '3 days', 100, '第二章 一元一次方程式', 'active', demo_admin_id);

  INSERT INTO public.academy_exam_classes (exam_id, class_id) VALUES
    (ae_math_quiz_2, math_class_id);

  -- 3. 英文模擬考 (active, has scores)
  INSERT INTO public.academy_exams (id, org_id, campus_id, name, exam_type, subject_id, exam_date, total_score, scope_note, status, created_by)
  VALUES (ae_english_mock, demo_org_id, demo_campus_id, '英文模擬考 April', 'mock_exam', english_subject_id, CURRENT_DATE - INTERVAL '7 days', 100, 'Units 1-4', 'active', demo_admin_id);

  INSERT INTO public.academy_exam_classes (exam_id, class_id) VALUES
    (ae_english_mock, english_class_id);

  -- 4. 自然隨堂測驗 (active, has scores)
  INSERT INTO public.academy_exams (id, org_id, campus_id, name, exam_type, subject_id, exam_date, total_score, scope_note, status, created_by)
  VALUES (ae_science_quiz, demo_org_id, demo_campus_id, '自然隨堂測驗', 'quiz', science_subject_id, CURRENT_DATE - INTERVAL '5 days', 50, '力學與運動', 'active', demo_admin_id);

  INSERT INTO public.academy_exam_classes (exam_id, class_id) VALUES
    (ae_science_quiz, science_class_id);

  -- 5. 數學分級測驗 (active, multi-class, has scores)
  INSERT INTO public.academy_exams (id, org_id, campus_id, name, exam_type, subject_id, exam_date, total_score, scope_note, status, created_by)
  VALUES (ae_math_placement, demo_org_id, demo_campus_id, '數學分級測驗', 'placement_test', math_subject_id, CURRENT_DATE - INTERVAL '21 days', 100, '國中數學綜合評量', 'active', demo_admin_id);

  INSERT INTO public.academy_exam_classes (exam_id, class_id) VALUES
    (ae_math_placement, math_class_id),
    (ae_math_placement, science_class_id);

  -- 6. 已結案的考試 (closed)
  INSERT INTO public.academy_exams (id, org_id, campus_id, name, exam_type, subject_id, exam_date, total_score, scope_note, status, created_by)
  VALUES (ae_closed_exam, demo_org_id, demo_campus_id, '英文期末總複習考', 'mock_exam', english_subject_id, CURRENT_DATE - INTERVAL '60 days', 100, 'Final review', 'closed', demo_admin_id);

  INSERT INTO public.academy_exam_classes (exam_id, class_id) VALUES
    (ae_closed_exam, english_class_id);

  -- ========================================
  -- ACADEMY SCORES
  -- ========================================

  -- Exam 1: 數學小考 第1回 — 12 students from math_class (students 1-8 enrolled)
  FOR i IN 1..8 LOOP
    s_id := format('61000000-0000-0000-0000-%s', lpad(i::text, 12, '0'))::uuid;
    v_score := CASE
      WHEN i = 3 THEN NULL  -- student 3 is absent
      ELSE (55 + random() * 45)::numeric(6,2)
    END;
    INSERT INTO public.academy_scores (exam_id, student_id, score, status, notes, created_by)
    VALUES (
      ae_math_quiz_1,
      s_id,
      v_score,
      CASE WHEN i = 3 THEN 'absent'::public.score_status ELSE 'scored'::public.score_status END,
      CASE WHEN i = 3 THEN '當天請病假' ELSE NULL END,
      demo_admin_id
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Exam 3: 英文模擬考 — students 1-8 (english_class)
  FOR i IN 1..8 LOOP
    s_id := format('61000000-0000-0000-0000-%s', lpad(i::text, 12, '0'))::uuid;
    v_score := CASE
      WHEN i = 5 THEN NULL  -- student 5 absent
      WHEN i = 7 THEN NULL  -- student 7 makeup pending
      ELSE (40 + random() * 60)::numeric(6,2)
    END;
    INSERT INTO public.academy_scores (exam_id, student_id, score, status, notes, created_by)
    VALUES (
      ae_english_mock,
      s_id,
      v_score,
      CASE
        WHEN i = 5 THEN 'absent'::public.score_status
        WHEN i = 7 THEN 'makeup'::public.score_status
        ELSE 'scored'::public.score_status
      END,
      CASE
        WHEN i = 5 THEN '出國'
        WHEN i = 7 THEN '等待補考'
        ELSE NULL
      END,
      demo_admin_id
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  -- Exam 4: 自然隨堂測驗 — students 5-12 (science_class, total=50)
  FOR i IN 5..12 LOOP
    s_id := format('61000000-0000-0000-0000-%s', lpad(i::text, 12, '0'))::uuid;
    v_score := (20 + random() * 30)::numeric(6,2);
    INSERT INTO public.academy_scores (exam_id, student_id, score, status, notes, created_by)
    VALUES (ae_science_quiz, s_id, v_score, 'scored'::public.score_status, NULL, demo_admin_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Exam 5: 數學分級測驗 — students 1-12 (multi-class)
  FOR i IN 1..12 LOOP
    s_id := format('61000000-0000-0000-0000-%s', lpad(i::text, 12, '0'))::uuid;
    v_score := (30 + random() * 70)::numeric(6,2);
    INSERT INTO public.academy_scores (exam_id, student_id, score, status, notes, created_by)
    VALUES (ae_math_placement, s_id, v_score, 'scored'::public.score_status, NULL, demo_admin_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Exam 6: 已結案英文考 — students 1-8
  FOR i IN 1..8 LOOP
    s_id := format('61000000-0000-0000-0000-%s', lpad(i::text, 12, '0'))::uuid;
    v_score := (50 + random() * 50)::numeric(6,2);
    INSERT INTO public.academy_scores (exam_id, student_id, score, status, notes, created_by)
    VALUES (ae_closed_exam, s_id, v_score, 'scored'::public.score_status, NULL, demo_admin_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- ========================================
  -- TERM EXAMS (3 exams — 綁到第一所 demo school)
  -- ========================================

  DECLARE
    demo_school_id uuid;
  BEGIN
    SELECT id INTO demo_school_id
      FROM public.schools
      WHERE org_id = demo_org_id
      ORDER BY name
      LIMIT 1;

    IF demo_school_id IS NULL THEN
      RAISE EXCEPTION 'No school found for demo_org; cannot seed school_exams';
    END IF;

    -- 1. 114學年 第1學期 段考
    INSERT INTO public.school_exams (id, org_id, school_id, academic_year, semester, exam_type, subject_id, name, label, exam_date, status)
    VALUES (te_114_1_mid, demo_org_id, demo_school_id, 114, 1, 'term_exam', NULL, NULL, '114-1 段考', CURRENT_DATE - INTERVAL '30 days', 'active');

    -- 2. 114學年 第1學期 段考（第二次）
    INSERT INTO public.school_exams (id, org_id, school_id, academic_year, semester, exam_type, subject_id, name, label, exam_date, status)
    VALUES (te_114_1_fin, demo_org_id, demo_school_id, 114, 1, 'term_exam', NULL, '第二次', '114-1 段考 · 第二次', CURRENT_DATE - INTERVAL '7 days', 'active');

    -- 3. 113學年 第2學期 段考 (closed)
    INSERT INTO public.school_exams (id, org_id, school_id, academic_year, semester, exam_type, subject_id, name, label, exam_date, status)
    VALUES (te_113_2_fin, demo_org_id, demo_school_id, 113, 2, 'term_exam', NULL, NULL, '113-2 段考', CURRENT_DATE - INTERVAL '180 days', 'closed');
  END;

  -- ========================================
  -- TERM SCORES
  -- ========================================

  -- 114-1 段考: 學生 1-8, 各 5 科 (國英數自社)
  FOR i IN 1..8 LOOP
    s_id := format('61000000-0000-0000-0000-%s', lpad(i::text, 12, '0'))::uuid;

    INSERT INTO public.school_scores (school_exam_id, student_id, subject_id, score, status, notes, created_by)
    VALUES
      (te_114_1_mid, s_id, chinese_subject_id, (50 + random() * 50)::numeric(6,2), 'scored'::public.score_status, NULL, demo_admin_id),
      (te_114_1_mid, s_id, english_subject_id, (40 + random() * 60)::numeric(6,2), 'scored'::public.score_status, NULL, demo_admin_id),
      (te_114_1_mid, s_id, math_subject_id,    (35 + random() * 65)::numeric(6,2), 'scored'::public.score_status, NULL, demo_admin_id),
      (te_114_1_mid, s_id, science_subject_id,  (45 + random() * 55)::numeric(6,2), 'scored'::public.score_status, NULL, demo_admin_id),
      (te_114_1_mid, s_id, social_subject_id,   (55 + random() * 45)::numeric(6,2), 'scored'::public.score_status, NULL, demo_admin_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- 114-1 段考（第二次）: 學生 1-6 已登錄, 7-8 尚未登錄（模擬部分登錄狀態）
  FOR i IN 1..6 LOOP
    s_id := format('61000000-0000-0000-0000-%s', lpad(i::text, 12, '0'))::uuid;

    INSERT INTO public.school_scores (school_exam_id, student_id, subject_id, score, status, notes, created_by)
    VALUES
      (te_114_1_fin, s_id, chinese_subject_id, (50 + random() * 50)::numeric(6,2), 'scored'::public.score_status, NULL, demo_admin_id),
      (te_114_1_fin, s_id, english_subject_id, (45 + random() * 55)::numeric(6,2), 'scored'::public.score_status, NULL, demo_admin_id),
      (te_114_1_fin, s_id, math_subject_id,    (30 + random() * 70)::numeric(6,2), 'scored'::public.score_status, NULL, demo_admin_id),
      (te_114_1_fin, s_id, science_subject_id,  (40 + random() * 60)::numeric(6,2), 'scored'::public.score_status, NULL, demo_admin_id),
      (te_114_1_fin, s_id, social_subject_id,   (50 + random() * 50)::numeric(6,2), 'scored'::public.score_status, NULL, demo_admin_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- 113-2 段考 (closed): 學生 1-12 全部登錄
  FOR i IN 1..12 LOOP
    s_id := format('61000000-0000-0000-0000-%s', lpad(i::text, 12, '0'))::uuid;

    INSERT INTO public.school_scores (school_exam_id, student_id, subject_id, score, status, notes, created_by)
    VALUES
      (te_113_2_fin, s_id, chinese_subject_id, (45 + random() * 55)::numeric(6,2), 'scored'::public.score_status, NULL, demo_admin_id),
      (te_113_2_fin, s_id, english_subject_id, (40 + random() * 60)::numeric(6,2), 'scored'::public.score_status, NULL, demo_admin_id),
      (te_113_2_fin, s_id, math_subject_id,    (30 + random() * 70)::numeric(6,2), 'scored'::public.score_status, NULL, demo_admin_id),
      (te_113_2_fin, s_id, science_subject_id,  (35 + random() * 65)::numeric(6,2), 'scored'::public.score_status, NULL, demo_admin_id),
      (te_113_2_fin, s_id, social_subject_id,   (50 + random() * 50)::numeric(6,2), 'scored'::public.score_status, NULL, demo_admin_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Exam seed data inserted successfully';
END $$;
