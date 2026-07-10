-- ====================================================================
-- SCRIPT DE SOPORTE: RESTABLECER CONTRASEÑA DE USUARIO EN SUPABASE
-- ====================================================================
-- Instrucciones:
-- 1. Copia este script en la sección "SQL Editor" de tu panel de Supabase.
-- 2. Modifica los parámetros 'CORREO_DEL_USUARIO' y 'NUEVA_CONTRASEÑA_AQUÍ'
--    con los valores reales correspondientes.
-- 3. Ejecuta el script (botón "Run").

UPDATE auth.users
SET 
  encrypted_password = crypt('NUEVA_CONTRASEÑA_AQUÍ', gen_salt('bf')),
  email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
  updated_at = NOW()
WHERE email = 'CORREO_DEL_USUARIO';

-- Nota: Si prefieres buscar al usuario por su ID en lugar de su correo,
-- puedes cambiar la cláusula WHERE por:
-- WHERE id = 'ID_DEL_USUARIO';
