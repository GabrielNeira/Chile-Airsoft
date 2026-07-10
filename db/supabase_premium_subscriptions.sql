-- 1. Añadir columna is_premium a la tabla operator_profiles
ALTER TABLE public.operator_profiles ADD COLUMN IF NOT EXISTS is_premium boolean NOT NULL DEFAULT false;

-- 2. Asegurarnos que el usuario Homura es Premium
UPDATE public.operator_profiles
SET is_premium = true
WHERE user_id = '4acf55e2-8ad8-427f-8adc-be8c94d0718b';

-- 3. Función RPC segura para obtener operadores (solo para Homura o Superadmins)
CREATE OR REPLACE FUNCTION public.get_operators_for_premium_management()
RETURNS TABLE (
  user_id uuid,
  nickname text,
  real_name text,
  is_premium boolean,
  team text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validar si el usuario activo es Homura o Superadmin
  IF NOT (public.is_super_admin() OR auth.uid() = '4acf55e2-8ad8-427f-8adc-be8c94d0718b') THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Permisos insuficientes. Solo Homura o Superadmins pueden gestionar suscripciones Premium.';
  END IF;

  RETURN QUERY
  SELECT p.user_id, p.nickname, p.real_name, p.is_premium, COALESCE(p.team, '')::text
  FROM public.operator_profiles p
  ORDER BY p.nickname ASC;
END;
$$;

-- 4. Función RPC segura para alternar estado premium de un operador
CREATE OR REPLACE FUNCTION public.toggle_operator_premium_status(
  p_operator_user_id uuid,
  p_is_premium boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validar si el usuario activo es Homura o Superadmin
  IF NOT (public.is_super_admin() OR auth.uid() = '4acf55e2-8ad8-427f-8adc-be8c94d0718b') THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Permisos insuficientes. Solo Homura o Superadmins pueden gestionar suscripciones Premium.';
  END IF;

  -- Impedir que Homura se des-suscriba a sí mismo por accidente
  IF p_operator_user_id = '4acf55e2-8ad8-427f-8adc-be8c94d0718b' AND p_is_premium = false THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'No puedes quitarle el estado Premium a Homura.';
  END IF;

  UPDATE public.operator_profiles
  SET is_premium = p_is_premium,
      updated_at = now()
  WHERE user_id = p_operator_user_id;
END;
$$;

-- Otorgar permisos de ejecución a los roles correspondientes
GRANT EXECUTE ON FUNCTION public.get_operators_for_premium_management() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_operators_for_premium_management() TO service_role;

GRANT EXECUTE ON FUNCTION public.toggle_operator_premium_status(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_operator_premium_status(uuid, boolean) TO service_role;
