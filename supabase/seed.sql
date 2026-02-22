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
BEGIN
    -- 1. Insert users into Better Auth ba_user table
    INSERT INTO public.ba_user (id, name, email, "emailVerified", username, "orgId", "createdAt", "updatedAt")
    VALUES
        (root_id::text, 'Super Admin', root_email, true, 'root', NULL, NOW(), NOW()),
        (demo_admin_id::text, 'Demo Admin', demo_admin_email, true, 'demo_admin', NULL, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;

    -- 2. Insert credentials into ba_account (scrypt hash format: salt:key)
    INSERT INTO public.ba_account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
    VALUES
        (gen_random_uuid()::text, root_id::text, 'credential', root_id::text, root_password_hash, NOW(), NOW()),
        (gen_random_uuid()::text, demo_admin_id::text, 'credential', demo_admin_id::text, demo_admin_password_hash, NOW(), NOW())
    ON CONFLICT DO NOTHING;

    -- 3. Insert demo organization
    INSERT INTO public.organizations (id, name, slug)
    VALUES (demo_org_id, 'Demo 補習班', 'demo')
    ON CONFLICT (id) DO NOTHING;

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

    -- 6. Insert into public.user_roles (idempotent)
    INSERT INTO public.user_roles (user_id, role, permissions)
    VALUES
        (root_id, 'admin', '["*"]'::jsonb),
        (root_id, 'teacher', '[]'::jsonb),
        (root_id, 'parent', '[]'::jsonb),
        (demo_admin_id, 'admin', '["*"]'::jsonb)
    ON CONFLICT (user_id, role) DO NOTHING;

    -- 7. Insert demo campuses
    INSERT INTO public.campuses (id, org_id, name, address, phone, is_active)
    VALUES
        ('a2c36d14-0826-4346-a809-0596b512af4e', demo_org_id, '台北信義校', '台北市信義區信義路五段7號', '02-2720-1234', true),
        ('6a9a3987-d180-41cb-a168-882a140a66d6', demo_org_id, '台北大安校', '台北市大安區復興南路一段390號', '02-2700-5678', true),
        ('9084c27e-b55e-4222-8744-c6566272847d', demo_org_id, '新北板橋校', '新北市板橋區中山路一段50號', '02-2960-1234', false)
    ON CONFLICT (id) DO NOTHING;

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
    ON CONFLICT (org_id, name) DO NOTHING;

    -- 9. Insert demo courses (subject_id via subquery)
    INSERT INTO public.courses (id, org_id, campus_id, name, subject_id, description, is_active)
    VALUES
        -- 台北信義校課程
        ('2609f60c-7581-4508-acb0-a925c7beb80c', demo_org_id, 'a2c36d14-0826-4346-a809-0596b512af4e', '國一數學', (SELECT id FROM public.subjects WHERE org_id = demo_org_id AND name = '數學'), '國中一年級數學基礎課程', true),
        ('4d23ecfb-61b2-45f4-bf4b-f732d1cdd824', demo_org_id, 'a2c36d14-0826-4346-a809-0596b512af4e', '國二數學', (SELECT id FROM public.subjects WHERE org_id = demo_org_id AND name = '數學'), '國中二年級數學進階課程', true),
        ('b5432516-2892-4863-9ebd-d2b7bb56a571', demo_org_id, 'a2c36d14-0826-4346-a809-0596b512af4e', '國三數學', (SELECT id FROM public.subjects WHERE org_id = demo_org_id AND name = '數學'), '國中三年級數學總複習', true),
        ('62e3ec9f-45c6-45b7-abdb-3ee72bae2c61', demo_org_id, 'a2c36d14-0826-4346-a809-0596b512af4e', '國一英文', (SELECT id FROM public.subjects WHERE org_id = demo_org_id AND name = '英文'), '國中一年級英文基礎課程', true),
        ('6d9dbf49-5121-4f9b-8942-0b45619fcb0d', demo_org_id, 'a2c36d14-0826-4346-a809-0596b512af4e', '國二英文', (SELECT id FROM public.subjects WHERE org_id = demo_org_id AND name = '英文'), '國中二年級英文進階課程', true),
        -- 台北大安校課程
        ('0f42ad85-a6a5-447c-9701-4dc0fbb86585', demo_org_id, '6a9a3987-d180-41cb-a168-882a140a66d6', '高一數學', (SELECT id FROM public.subjects WHERE org_id = demo_org_id AND name = '數學'), '高中一年級數學課程', true),
        ('6d8333d1-9a41-497a-96b2-f45e2e5b0295', demo_org_id, '6a9a3987-d180-41cb-a168-882a140a66d6', '高二數學', (SELECT id FROM public.subjects WHERE org_id = demo_org_id AND name = '數學'), '高中二年級數學課程', true),
        ('8ad3380e-806f-4239-84a4-8d04f3f4c99b', demo_org_id, '6a9a3987-d180-41cb-a168-882a140a66d6', '高一物理', (SELECT id FROM public.subjects WHERE org_id = demo_org_id AND name = '物理'), '高中一年級物理課程', true),
        ('80d23d2d-701b-493e-a198-79209134f0d5', demo_org_id, '6a9a3987-d180-41cb-a168-882a140a66d6', '高一化學', (SELECT id FROM public.subjects WHERE org_id = demo_org_id AND name = '化學'), '高中一年級化學課程', false)
    ON CONFLICT (id) DO NOTHING;

END $$;
