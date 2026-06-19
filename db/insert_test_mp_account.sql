DO $$
DECLARE
  v_field RECORD;
  v_organizer_id uuid;
BEGIN
  -- 1. Buscamos CUALQUIER usuario registrado en la app para asignarle la cuenta (para evitar errores si no hay eventos)
  SELECT user_id INTO v_organizer_id FROM public.operator_profiles LIMIT 1;

  -- 2. Recorremos todas las canchas existentes y les asignamos el Token real
  FOR v_field IN SELECT id FROM public.fields
  LOOP
    INSERT INTO public.field_payment_accounts (
      field_id,
      provider_code,
      organizer_user_id,
      provider_account_ref,
      webhook_secret,
      is_active
    )
    VALUES (
      v_field.id,
      'mercadopago',
      v_organizer_id,
      'APP_USR-8671462273932525-061911-c455eac149d26fd094336832be65d5e3-3485467376', 
      'test_webhook_secret',
      true
    )
    ON CONFLICT (field_id, provider_code, provider_account_ref) DO UPDATE
    SET is_active = true;
  END LOOP;
END;
$$;
