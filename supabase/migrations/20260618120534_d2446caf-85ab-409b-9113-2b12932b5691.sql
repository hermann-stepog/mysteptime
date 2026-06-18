
DO $$
DECLARE
  v_email text := 'hermann.siqueira@step-og.com';
  v_password text := 'StepAdmin@2026';
  v_full_name text := 'Hermann Siqueira';
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(v_email);

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_email, crypt(v_password, gen_salt('bf')),
      now(),
      jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_full_name),
      now(), now(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_user_id, v_user_id::text,
            jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());
  ELSE
    UPDATE auth.users
      SET encrypted_password = crypt(v_password, gen_salt('bf')),
          email_confirmed_at = COALESCE(email_confirmed_at, now()),
          updated_at = now()
      WHERE id = v_user_id;
  END IF;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (v_user_id, v_email, v_full_name)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);

  DELETE FROM public.user_roles WHERE user_id = v_user_id AND role <> 'logistics_operator';
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'logistics_operator')
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;
