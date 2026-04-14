-- Hotfix: habilitar Admin GOD (Homura) para administrar roles de usuario.
-- Soluciona el error: "Only super_admin can manage roles" al usar grant_role/revoke_role.

create or replace function public.can_manage_roles()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_is_homura_by_email boolean := false;
begin
  -- SQL editor / sesiones privilegiadas sin JWT.
  if v_uid is null then
    return current_user in ('postgres', 'supabase_admin', 'service_role');
  end if;

  select exists (
    select 1
    from auth.users u
    where u.id = v_uid
      and lower(coalesce(u.email, '')) = 'gabrielneiraillanes@gmail.com'
  )
  into v_is_homura_by_email;

  return public.is_super_admin()
    or public.can_manage_field_admins_by_email()
    or v_is_homura_by_email;
end;
$$;

-- Permisos de ejecucion para clientes autenticados y service_role.
grant execute on function public.can_manage_roles() to authenticated;
grant execute on function public.can_manage_roles() to service_role;

-- Opcional: permitir que Admin GOD lea auditoria de grant/revoke.
drop policy if exists role_admin_audit_read on public.role_admin_audit;
create policy role_admin_audit_read
on public.role_admin_audit
for select
using (public.can_manage_roles());

-- Verificacion sugerida:
-- select public.can_manage_roles();
-- select public.grant_role('sebastian.andres.official@gmail.com', 'field_admin', 'Alta desde Admin GOD');
