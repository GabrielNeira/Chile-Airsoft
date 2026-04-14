-- Hotfix: habilitar mantenedor de admins de cancha para Admin GOD
-- Evita dependencia circular entre can_manage_roles() y can_manage_field_admins_by_email().

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

  return public.is_super_admin() or v_is_homura_by_email;
end;
$$;

create or replace function public.can_manage_field_admins_by_email()
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

  return public.is_super_admin() or v_is_homura_by_email;
end;
$$;

grant execute on function public.can_manage_roles() to authenticated;
grant execute on function public.can_manage_roles() to service_role;

grant execute on function public.can_manage_field_admins_by_email() to authenticated;
grant execute on function public.can_manage_field_admins_by_email() to service_role;

-- Verificacion sugerida:
-- select public.can_manage_roles();
-- select public.can_manage_field_admins_by_email();
