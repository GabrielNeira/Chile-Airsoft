create or replace function public.is_super_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_has_role boolean := false;
  v_has_user_role boolean := false;
begin
  if auth.uid() is null then
    return false;
  end if;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'user_roles'
      and c.column_name = 'role'
  ) into v_has_role;

  if v_has_role and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role::text = 'super_admin'
  ) then
    return true;
  end if;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'user_roles'
      and c.column_name = 'user_role'
  ) into v_has_user_role;

  if v_has_user_role and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.user_role::text = 'super_admin'
  ) then
    return true;
  end if;

  return false;
exception
  when undefined_table or undefined_column then
    return false;
end;
$$;

create or replace function public.is_field_admin(field_id_input uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  return exists (
    select 1
    from public.field_admins fa
    where fa.user_id = auth.uid()
      and fa.field_id = field_id_input
  ) or public.is_super_admin();
exception
  when undefined_table or undefined_column then
    return false;
end;
$$;

create or replace function public.is_organizer_for_event(event_id_input uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  return exists (
    select 1
    from public.event_organizers eo
    where eo.user_id = auth.uid()
      and eo.event_id = event_id_input
  ) or public.is_super_admin();
exception
  when undefined_table or undefined_column then
    return false;
end;
$$;

grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_super_admin() to service_role;

grant execute on function public.is_field_admin(uuid) to authenticated;
grant execute on function public.is_field_admin(uuid) to service_role;

grant execute on function public.is_organizer_for_event(uuid) to authenticated;
grant execute on function public.is_organizer_for_event(uuid) to service_role;