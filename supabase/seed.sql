DO $$
DECLARE
    root_id UUID := '00000000-0000-0000-0000-000000000000';
    root_email TEXT := 'root@clessia.com';
    -- scrypt hash of 'Test123' (salt:key format for Better Auth using @noble/hashes/scrypt)
    root_password_hash TEXT := 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6:6ad04372a2a78a5adde77793f33e0a316de3077333eb0704947f8213c2adac9fdf3713001d762b95d0c259fa048006a2b79b994c79c7de0d380668f31695ce75';
    demo_org_id UUID := '11111111-1111-1111-1111-111111111111';
    demo_admin_id UUID := '22222222-2222-2222-2222-222222222222';
    demo_admin_email TEXT := 'admin@demo.clessia.app';
    -- scrypt hash of 'password123'
    demo_admin_password_hash TEXT := 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7:1958d54718458252105100e0037ab899afecffc67710757a65e65056229dfdc74c3bac47993e2f02013da09680be2dff8e141a043f2049f6bb17aacd006154ca';
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
    v_teacher_display_name TEXT;
    admin_user_id TEXT;
    admin_user_uuid UUID;
    v_admin_staff_id UUID;
    teacher_user_id TEXT;
    teacher_user_uuid UUID;
    v_teacher_staff_id UUID;
BEGIN
    -- 1. Insert users into Better Auth ba_user table
    INSERT INTO public.ba_user (id, name, email, "emailVerified", username, "orgId", "createdAt", "updatedAt")
    VALUES
        (root_id::text, 'Super Admin', root_email, true, 'root', NULL, NOW(), NOW()),
        (demo_admin_id::text, 'Demo Admin', demo_admin_email, true, 'demo_admin', NULL, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        "emailVerified" = EXCLUDED."emailVerified",
        username = EXCLUDED.username,
        "updatedAt" = NOW();

    -- 2. Insert credentials into ba_account (scrypt hash format: salt:key)
    INSERT INTO public.ba_account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
    VALUES
        ('credential-' || root_id::text, root_id::text, 'credential', root_id::text, root_password_hash, NOW(), NOW()),
        ('credential-' || demo_admin_id::text, demo_admin_id::text, 'credential', demo_admin_id::text, demo_admin_password_hash, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
        password = EXCLUDED.password,
        "updatedAt" = NOW();

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
    WHERE id IN (root_id::text, demo_admin_id::text);

    -- 5. Ensure profiles exist with org_id (must be before user_roles due to FK)
    INSERT INTO public.profiles (id, display_name, org_id)
    VALUES
        (root_id, 'root', demo_org_id),
        (demo_admin_id, 'Demo Admin', demo_org_id)
    ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        org_id = EXCLUDED.org_id;

    -- 6. Insert root/demo user_roles
    INSERT INTO public.user_roles (user_id, role, permissions)
    VALUES
        (root_id::text, 'admin', '["*"]'::jsonb),
        (root_id::text, 'teacher', '[]'::jsonb),
        (root_id::text, 'parent', '[]'::jsonb),
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
            format('02-28%02s-%04s', campus_index, 1000 + campus_index),
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

            INSERT INTO public.courses (org_id, campus_id, name, subject_id, description, is_active)
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
                true
            )
            ON CONFLICT (campus_id, name) DO UPDATE SET
                subject_id = EXCLUDED.subject_id,
                description = EXCLUDED.description,
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
            format('admin%02s@demo.clessia.app', staff_index),
            true,
            format('demo_admin_%02s', staff_index),
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

        INSERT INTO public.ba_account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
        VALUES (
            'credential-' || admin_user_id,
            admin_user_id,
            'credential',
            admin_user_id,
            demo_admin_password_hash,
            NOW(),
            NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
            password = EXCLUDED.password,
            "updatedAt" = NOW();

        INSERT INTO public.profiles (id, display_name, org_id)
        VALUES (admin_user_uuid, format('管理員%s', lpad(staff_index::text, 2, '0')), demo_org_id)
        ON CONFLICT (id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            org_id = EXCLUDED.org_id;

        INSERT INTO public.user_roles (user_id, role, permissions)
        VALUES (admin_user_id, 'admin', '["*"]'::jsonb)
        ON CONFLICT (user_id, role) DO UPDATE SET
            permissions = EXCLUDED.permissions;

        INSERT INTO public.staff (user_id, org_id, display_name, phone, email, is_active)
        VALUES (
            admin_user_id,
            demo_org_id,
            format('管理員%s', lpad(staff_index::text, 2, '0')),
            format('0911%06s', lpad(staff_index::text, 6, '0')),
            format('admin%02s@demo.clessia.app', staff_index),
            true
        )
        ON CONFLICT (user_id, org_id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            phone = EXCLUDED.phone,
            email = EXCLUDED.email,
            is_active = EXCLUDED.is_active,
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

            INSERT INTO public.ba_account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
            VALUES (
                'credential-' || teacher_user_id,
                teacher_user_id,
                'credential',
                teacher_user_id,
                demo_admin_password_hash,
                NOW(),
                NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
                password = EXCLUDED.password,
                "updatedAt" = NOW();

            INSERT INTO public.profiles (id, display_name, org_id)
            VALUES (teacher_user_uuid, v_teacher_display_name, demo_org_id)
            ON CONFLICT (id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                org_id = EXCLUDED.org_id;

            INSERT INTO public.user_roles (user_id, role, permissions)
            VALUES (teacher_user_id, 'teacher', '[]'::jsonb)
            ON CONFLICT (user_id, role) DO UPDATE SET
                permissions = EXCLUDED.permissions;

            INSERT INTO public.staff (user_id, org_id, display_name, phone, email, is_active)
            VALUES (
                teacher_user_id,
                demo_org_id,
                v_teacher_display_name,
                '0922' || lpad(teacher_index::text, 6, '0'),
                format('teacher%s@demo.clessia.app', lpad(teacher_index::text, 4, '0')),
                true
            )
            ON CONFLICT (user_id, org_id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                phone = EXCLUDED.phone,
                email = EXCLUDED.email,
                is_active = EXCLUDED.is_active,
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
