-- Hotfix: habilitar operacion de eventos por rol en user_roles (field_admin/organizer/super_admin)
-- Objetivo: que al asignar rol desde Admin GOD, el acceso a crear/editar/eliminar eventos quede inmediato.

create or replace function public.has_field_operations_role(p_user_id uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_has_role boolean := false;
  v_has_user_role boolean := false;
begin
  if v_uid is null then
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
    where ur.user_id = v_uid
      and lower(trim(ur.role::text)) in ('field_admin', 'organizer', 'super_admin')
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
    where ur.user_id = v_uid
      and lower(trim(ur.user_role::text)) in ('field_admin', 'organizer', 'super_admin')
  ) then
    return true;
  end if;

  return false;
exception
  when undefined_table or undefined_column then
    return false;
end;
$$;

grant execute on function public.has_field_operations_role(uuid) to authenticated;
grant execute on function public.has_field_operations_role(uuid) to service_role;

create or replace function public.has_organizer_or_super_role(p_user_id uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_has_role boolean := false;
  v_has_user_role boolean := false;
begin
  if v_uid is null then
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
    where ur.user_id = v_uid
      and lower(trim(ur.role::text)) in ('organizer', 'super_admin')
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
    where ur.user_id = v_uid
      and lower(trim(ur.user_role::text)) in ('organizer', 'super_admin')
  ) then
    return true;
  end if;

  return false;
exception
  when undefined_table or undefined_column then
    return false;
end;
$$;

grant execute on function public.has_organizer_or_super_role(uuid) to authenticated;
grant execute on function public.has_organizer_or_super_role(uuid) to service_role;

create or replace function public.list_accessible_fields_for_operations()
returns table (
  id uuid,
  name text,
  city text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  if public.is_super_admin() or public.has_organizer_or_super_role(auth.uid()) then
    return query
    select f.id, f.name, f.city
    from public.fields f
    order by f.name;
    return;
  end if;

  return query
  select f.id, f.name, f.city
  from public.fields f
  where exists (
    select 1
    from public.field_admins fa
    where fa.field_id = f.id
      and fa.user_id = auth.uid()
  )
  order by f.name;
end;
$$;

grant execute on function public.list_accessible_fields_for_operations() to authenticated;
grant execute on function public.list_accessible_fields_for_operations() to service_role;

-- Reemplazo de politicas sobre events
alter table if exists public.events enable row level security;

drop policy if exists events_read_all on public.events;
drop policy if exists events_select_by_scope on public.events;
create policy events_select_by_scope
on public.events
for select
using (
  public.is_super_admin()
  or public.is_field_admin(field_id)
  or public.is_organizer_for_event(id)
  or created_by = auth.uid()
);

drop policy if exists events_insert_field_admin on public.events;
create policy events_insert_field_admin
on public.events
for insert
with check (
  created_by = auth.uid()
  and (
    public.is_super_admin()
    or public.is_field_admin(field_id)
    or public.has_organizer_or_super_role(auth.uid())
  )
);

drop policy if exists events_update_by_organizer_or_field_admin on public.events;
create policy events_update_by_organizer_or_field_admin
on public.events
for update
using (
  public.is_super_admin()
  or (
    public.is_field_admin(field_id)
    or public.is_organizer_for_event(id)
    or created_by = auth.uid()
  )
)
with check (
  public.is_super_admin()
  or (
    public.is_field_admin(field_id)
    or public.is_organizer_for_event(id)
    or created_by = auth.uid()
  )
);

-- Esta politica faltaba en varios despliegues; sin ella delete queda en 0 filas sin error.
drop policy if exists events_delete_by_organizer_or_field_admin on public.events;
create policy events_delete_by_organizer_or_field_admin
on public.events
for delete
using (
  public.is_super_admin()
  or (
    public.is_field_admin(field_id)
    or public.is_organizer_for_event(id)
    or created_by = auth.uid()
  )
);

-- Verificacion sugerida:
-- select public.has_field_operations_role();
-- select * from public.events where created_by = auth.uid() order by created_at desc;
