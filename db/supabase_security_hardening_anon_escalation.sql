-- =====================================================================
-- Hotfix de seguridad: escalada de privilegios y fuga de PII via anon
-- Aplicado en ChileAirsoft_QA el 2026-08-28.
--
-- CAUSA RAIZ
-- ----------
-- En una funcion SECURITY DEFINER, `current_user` es el OWNER de la
-- funcion (postgres), no quien la llama. La guarda que usaban
-- can_manage_roles() y can_manage_field_admins_by_email():
--
--     if v_uid is null then
--       return current_user in ('postgres','supabase_admin','service_role');
--     end if;
--
-- pretendia decir "sin sesion, solo procesos internos", pero evaluaba
-- 'postgres' in (...) => TRUE para CUALQUIER llamada sin sesion,
-- incluida la de un anonimo con la anon key publica.
--
-- IMPACTO VERIFICADO (antes del fix)
-- ----------------------------------
--   * can_manage_roles() devolvia true a un anonimo.
--   * grant_role() solo se protege con can_manage_roles() => cualquiera
--     podia otorgarse super_admin.
--   * god_delete_user_totally() idem => cualquiera podia borrar usuarios.
--   * god_user_maintainer_report() devolvia correos y nombres reales.
--   * La vista v_operator_id_metrics (SECURITY DEFINER) exponia nombre
--     real y grupo sanguineo de 6 personas reales a cualquier anonimo.
--   * payment_providers y payment_provider_status_map no tenian RLS:
--     se verifico un INSERT (201) y un DELETE (200) como anonimo.
--
-- Nada de esto requeria credenciales privilegiadas: la anon key viaja en
-- el frontend y ademas esta commiteada en frontend/app/.env.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Causa raiz: usar el rol REAL del llamador
--    auth.role()   -> lee el rol del JWT ('anon' / 'authenticated' /
--                     'service_role')
--    session_user  -> rol real de la conexion; SECURITY DEFINER NO lo
--                     altera. Via PostgREST es 'authenticator', nunca
--                     'postgres'.
-- ---------------------------------------------------------------------

create or replace function public.can_manage_roles()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_uid uuid := auth.uid();
  v_is_homura_by_email boolean := false;
begin
  if v_uid is null then
    return coalesce(auth.role(), '') = 'service_role'
        or session_user in ('postgres', 'supabase_admin');
  end if;

  select exists (
    select 1
    from auth.users u
    where u.id = v_uid
      and lower(coalesce(u.email, '')) = 'gabrielneiraillanes@gmail.com'
  )
  into v_is_homura_by_email;

  return public.is_super_admin() or v_is_homura_by_email;
end;
$function$;

create or replace function public.can_manage_field_admins_by_email()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_uid uuid := auth.uid();
  v_is_homura_by_email boolean := false;
begin
  if v_uid is null then
    return coalesce(auth.role(), '') = 'service_role'
        or session_user in ('postgres', 'supabase_admin');
  end if;

  select exists (
    select 1
    from auth.users u
    where u.id = v_uid
      and lower(coalesce(u.email, '')) = 'gabrielneiraillanes@gmail.com'
  )
  into v_is_homura_by_email;

  return public.is_super_admin() or v_is_homura_by_email;
end;
$function$;


-- ---------------------------------------------------------------------
-- 2. Vistas que puenteaban el RLS de sus tablas base.
--    Las politicas de las tablas ya eran correctas
--    (auth.uid() = user_id OR is_super_admin()); el problema era que la
--    vista, al ser SECURITY DEFINER, no las aplicaba.
-- ---------------------------------------------------------------------

alter view public.v_operator_id_metrics set (security_invoker = on);
alter view public.payment_audit_view    set (security_invoker = on);

revoke all on public.v_operator_id_metrics from anon;
revoke all on public.payment_audit_view    from anon;


-- ---------------------------------------------------------------------
-- 3. Catalogos de pago sin RLS. Son de solo lectura para la aplicacion;
--    la escritura queda unicamente para service_role, que no pasa por
--    RLS. No se define politica de INSERT/UPDATE/DELETE a proposito.
-- ---------------------------------------------------------------------

alter table public.payment_providers           enable row level security;
alter table public.payment_provider_status_map enable row level security;

drop policy if exists payment_providers_read on public.payment_providers;
create policy payment_providers_read
  on public.payment_providers
  for select
  to authenticated
  using (true);

drop policy if exists payment_provider_status_map_read on public.payment_provider_status_map;
create policy payment_provider_status_map_read
  on public.payment_provider_status_map
  for select
  to authenticated
  using (true);


-- ---------------------------------------------------------------------
-- 4. Defensa en profundidad sobre las funciones de accion administrativa.
--
--    OJO: `revoke ... from anon` por si solo NO basta. Postgres otorga
--    EXECUTE a PUBLIC por defecto en toda funcion nueva, y anon hereda
--    de PUBLIC. Hay que revocar de PUBLIC y volver a otorgar explicito.
--
--    Las funciones helper (is_super_admin, can_manage_roles, has_*,
--    is_field_admin) conservan EXECUTE amplio a proposito: las politicas
--    RLS las evaluan en nombre del usuario y romperlas romperia el RLS.
-- ---------------------------------------------------------------------

do $$
declare
  v_firma text;
  v_funciones text[] := array[
    'public.grant_role(text, text, text)',
    'public.revoke_role(text, text, text)',
    'public.god_delete_user_totally(uuid, text)',
    'public.god_delete_event_permanent(uuid, text)',
    'public.god_close_event(uuid, boolean, boolean, text)',
    'public.god_user_maintainer_report(text, integer, integer)',
    'public.god_events_maintainer_report(text, uuid, text, date, date, date, date, integer, integer)',
    'public.set_field_admin_by_email(uuid, text, boolean)',
    'public.admin_review_operator_identity(uuid, text, text)',
    'public.list_field_admins_for_field(uuid)'
  ];
begin
  foreach v_firma in array v_funciones loop
    execute format('revoke execute on function %s from public', v_firma);
    execute format('revoke execute on function %s from anon', v_firma);
    execute format('grant  execute on function %s to authenticated', v_firma);
    execute format('grant  execute on function %s to service_role', v_firma);
  end loop;
end $$;


-- =====================================================================
-- VERIFICACION POSTERIOR (ejecutada contra la API real con la anon key)
--
--   can_manage_roles()          true  -> false
--   v_operator_id_metrics       6 personas -> permission denied
--   payment_audit_view          accesible  -> permission denied
--   god_user_maintainer_report  correos reales -> permission denied
--   grant_role                  invocable  -> no visible para anon
--   payment_providers (select)  4 filas    -> []
--
-- Y que NO se rompio nada para los usuarios legitimos:
--   usuario normal autenticado  -> ve solo su propia ficha (1 fila)
--   Gabriel (super_admin)       -> ve las 6, panel god operativo
--
-- Los 4 advisors de nivel ERROR de Supabase quedaron en 0.
-- =====================================================================
