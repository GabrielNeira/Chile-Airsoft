create or replace function public.can_access_field_operations()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_has_role boolean := false;
  v_has_user_role boolean := false;
  v_has_field_admins boolean := false;
  v_has_event_organizers boolean := false;
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
      and ur.role::text in ('organizer', 'super_admin')
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
      and ur.user_role::text in ('organizer', 'super_admin')
  ) then
    return true;
  end if;

  select exists (
    select 1
    from information_schema.tables t
    where t.table_schema = 'public'
      and t.table_name = 'field_admins'
  ) into v_has_field_admins;

  if v_has_field_admins and exists (
    select 1
    from public.field_admins fa
    where fa.user_id = auth.uid()
  ) then
    return true;
  end if;

  select exists (
    select 1
    from information_schema.tables t
    where t.table_schema = 'public'
      and t.table_name = 'event_organizers'
  ) into v_has_event_organizers;

  if v_has_event_organizers and exists (
    select 1
    from public.event_organizers eo
    where eo.user_id = auth.uid()
  ) then
    return true;
  end if;

  return false;
exception
  when undefined_table or undefined_column then
    return false;
end;
$$;

grant execute on function public.can_access_field_operations() to authenticated;
grant execute on function public.can_access_field_operations() to service_role;