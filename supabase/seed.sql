DO $$
DECLARE
    root_id UUID := '00000000-0000-0000-0000-000000000000';
    root_email TEXT := 'root@clessia.com';
    root_password TEXT := 'Test123';
    demo_org_id UUID := '11111111-1111-1111-1111-111111111111';
BEGIN
    -- 1. Insert user into auth.users (if not exists)
    INSERT INTO auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        recovery_sent_at,
        last_sign_in_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token,
        email_change,
        email_change_token_new,
        recovery_token
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', -- Fixed instance_id for local dev
        root_id,
        'authenticated',
        'authenticated',
        root_email,
        crypt(root_password, gen_salt('bf')),
        NOW(),
        NOW(),
        NOW(),
        '{"provider":"email","providers":["email"]}',
        '{"display_name":"Super Admin"}',
        NOW(),
        NOW(),
        '',
        '',
        '',
        ''
    ) ON CONFLICT (id) DO NOTHING;

    -- 2. Insert demo organization
    INSERT INTO public.organizations (id, name, slug)
    VALUES (demo_org_id, 'Demo 補習班', 'demo')
    ON CONFLICT (id) DO NOTHING;

    -- 3. Insert into public.user_roles (idempotent)
    INSERT INTO public.user_roles (user_id, role, permissions)
    VALUES
        (root_id, 'admin', '["*"]'::jsonb),
        (root_id, 'teacher', '[]'::jsonb),
        (root_id, 'parent', '[]'::jsonb)
    ON CONFLICT (user_id, role) DO NOTHING;

    -- 4. Ensure profile exists with org_id
    INSERT INTO public.profiles (id, display_name, org_id)
    VALUES (root_id, 'root', demo_org_id)
    ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        org_id = EXCLUDED.org_id;

END $$;

