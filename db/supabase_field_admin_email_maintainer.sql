-- ChileAirsoft / Field admin maintainer (email-based)
-- Objective:
-- 1) Ensure the designated user is super_admin.
-- 2) Allow only that designated user to assign/revoke field admins by email.
-- 3) Remove every auth user except Homura (the designated super admin).

do $$
declare
  v_super_admin_id uuid := '4acf55e2-8ad8-427f-8adc-be8c94d0718b';
  v_role_columns text[] := array['role', 'user_role', 'field_user_role', 'app_role'];
  v_role_column text;
  v_applied boolean := false;
begin
  if not exists (
    select 1
    from auth.users u
    where u.id = v_super_admin_id
  ) then
    raise exception 'Homura user not found in auth.users: %', v_super_admin_id;
  end if;

  if not exists (
    select 1
    from information_schema.tables t
    where t.table_schema = 'public'
      and t.table_name = 'user_roles'
  ) then
    raise notice 'public.user_roles does not exist; skipping super_admin upsert.';
    return;
  end if;

  foreach v_role_column in array v_role_columns loop
    if exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'user_roles'
        and c.column_name = v_role_column
    ) then
      begin
        execute format(
          'insert into public.user_roles (user_id, %I)
           values ($1, ''super_admin'')
           on conflict do nothing',
          v_role_column
        )
        using v_super_admin_id;

        v_applied := true;
        exit;
      exception
        when others then
          raise notice 'Unable to upsert super_admin using column %. Error: %', v_role_column, SQLERRM;
      end;
    end if;
  end loop;

  if not v_applied then
    raise notice 'No compatible role column/value found in public.user_roles. Super admin upsert was skipped.';
  end if;
end;
$$;

do $$
declare
  v_super_admin_id uuid := '4acf55e2-8ad8-427f-8adc-be8c94d0718b';
  rec record;
begin
  if not exists (
    select 1
    from auth.users u
    where u.id = v_super_admin_id
  ) then
    raise exception 'Homura user not found in auth.users: %', v_super_admin_id;
  end if;

  -- Delete all rows that reference non-Homura users, across FK columns pointing to auth.users(id).
  -- This avoids ON DELETE RESTRICT failures when deleting auth.users.
  for rec in
    select
      kcu.table_schema,
      kcu.table_name,
      kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
     and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and ccu.table_schema = 'auth'
      and ccu.table_name = 'users'
      and ccu.column_name = 'id'
      and kcu.table_schema = 'public'
  loop
    execute format(
      'delete from %I.%I
       where %I in (
         select u.id
         from auth.users u
         where u.id <> $1
       )',
      rec.table_schema,
      rec.table_name,
      rec.column_name
    )
    using v_super_admin_id;
  end loop;

  -- Remove every remaining auth user except Homura.
  delete from auth.users u
  where u.id <> v_super_admin_id;
end;
$$;

create or replace function public.can_manage_field_admins_by_email()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_designated_super_admin uuid := '4acf55e2-8ad8-427f-8adc-be8c94d0718b';
begin
  if auth.uid() is null then
    return current_user in ('postgres', 'supabase_admin', 'service_role');
  end if;

  return auth.uid() = v_designated_super_admin;
end;
$$;

create or replace function public.list_field_admins_for_field(
  p_field_id uuid
)
returns table (
  user_id uuid,
  email text,
  assigned_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.can_manage_field_admins_by_email() then
    raise exception 'Only the designated super_admin can list/maintain field admins';
  end if;

  return query
  select
    fa.user_id,
    lower(coalesce(u.email, '')) as email,
    fa.assigned_at
  from public.field_admins fa
  left join auth.users u
    on u.id = fa.user_id
  where fa.field_id = p_field_id
  order by fa.assigned_at desc;
end;
$$;

create or replace function public.set_field_admin_by_email(
  p_field_id uuid,
  p_user_email text,
  p_enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(coalesce(p_user_email, '')));
  v_target_user_id uuid;
  v_applied integer := 0;
begin
  if not public.can_manage_field_admins_by_email() then
    raise exception 'Only the designated super_admin can assign field admins';
  end if;

  if p_field_id is null then
    raise exception 'p_field_id is required';
  end if;

  if v_email = '' then
    raise exception 'p_user_email is required';
  end if;

  if not exists (
    select 1
    from public.fields f
    where f.id = p_field_id
  ) then
    raise exception 'Field not found: %', p_field_id;
  end if;

  select u.id
  into v_target_user_id
  from auth.users u
  where lower(coalesce(u.email, '')) = v_email
  limit 1;

  if v_target_user_id is null then
    raise exception 'User not found for email: %', v_email;
  end if;

  if p_enabled then
    insert into public.field_admins (field_id, user_id)
    values (p_field_id, v_target_user_id)
    on conflict (field_id, user_id) do nothing;

    get diagnostics v_applied = row_count;

    if v_applied = 0 then
      return jsonb_build_object(
        'status', 'already_assigned',
        'field_id', p_field_id,
        'email', v_email,
        'user_id', v_target_user_id
      );
    end if;

    return jsonb_build_object(
      'status', 'assigned',
      'field_id', p_field_id,
      'email', v_email,
      'user_id', v_target_user_id
    );
  end if;

  delete from public.field_admins
  where field_id = p_field_id
    and user_id = v_target_user_id;

  get diagnostics v_applied = row_count;

  if v_applied = 0 then
    return jsonb_build_object(
      'status', 'not_assigned',
      'field_id', p_field_id,
      'email', v_email,
      'user_id', v_target_user_id
    );
  end if;

  return jsonb_build_object(
    'status', 'revoked',
    'field_id', p_field_id,
    'email', v_email,
    'user_id', v_target_user_id
  );
end;
$$;

grant execute on function public.can_manage_field_admins_by_email() to authenticated;
grant execute on function public.can_manage_field_admins_by_email() to service_role;

grant execute on function public.list_field_admins_for_field(uuid) to authenticated;
grant execute on function public.list_field_admins_for_field(uuid) to service_role;

grant execute on function public.set_field_admin_by_email(uuid, text, boolean) to authenticated;
grant execute on function public.set_field_admin_by_email(uuid, text, boolean) to service_role;