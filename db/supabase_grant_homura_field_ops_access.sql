do $$
declare
  v_user_id uuid := '4acf55e2-8ad8-427f-8adc-be8c94d0718b';
  v_has_user_roles boolean := false;
  v_has_role boolean := false;
  v_has_user_role boolean := false;
  v_has_field_admins boolean := false;
  v_field_id uuid := null;
begin
  select exists (
    select 1
    from information_schema.tables t
    where t.table_schema = 'public'
      and t.table_name = 'user_roles'
  ) into v_has_user_roles;

  if v_has_user_roles then
    select exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'user_roles'
        and c.column_name = 'role'
    ) into v_has_role;

    select exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'user_roles'
        and c.column_name = 'user_role'
    ) into v_has_user_role;

    if v_has_role then
      execute
        'insert into public.user_roles (user_id, role)
         values ($1, ''organizer'')
         on conflict do nothing'
      using v_user_id;
    elsif v_has_user_role then
      execute
        'insert into public.user_roles (user_id, user_role)
         values ($1, ''organizer'')
         on conflict do nothing'
      using v_user_id;
    end if;
  end if;

  select exists (
    select 1
    from information_schema.tables t
    where t.table_schema = 'public'
      and t.table_name = 'field_admins'
  ) into v_has_field_admins;

  if v_has_field_admins then
    select f.id
    into v_field_id
    from public.fields f
    where coalesce(f.is_active, true) = true
    order by f.created_at asc
    limit 1;

    if v_field_id is not null then
      insert into public.field_admins (field_id, user_id)
      values (v_field_id, v_user_id)
      on conflict do nothing;
    end if;
  end if;
end;
$$;

select *
from public.user_roles
where user_id = '4acf55e2-8ad8-427f-8adc-be8c94d0718b';

select *
from public.field_admins
where user_id = '4acf55e2-8ad8-427f-8adc-be8c94d0718b';