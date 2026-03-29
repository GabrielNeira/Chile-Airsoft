-- ChileAirsoft / Admin role management
-- Adds secure helpers to grant/revoke roles with validation and audit trail.

create extension if not exists pgcrypto;

create table if not exists public.role_admin_audit (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users (id) on delete cascade,
  target_email text not null,
  role_text text not null,
  action text not null check (action in ('grant', 'revoke')),
  reason text,
  executed_by uuid,
  executed_by_email text,
  executed_at timestamptz not null default now()
);

alter table public.role_admin_audit enable row level security;

drop policy if exists role_admin_audit_read on public.role_admin_audit;
create policy role_admin_audit_read
on public.role_admin_audit
for select
using (public.is_super_admin());

revoke all on public.role_admin_audit from authenticated;

create or replace function public.normalize_field_user_role_input(p_role text)
returns text
language plpgsql
immutable
as $$
declare
  v_role text := lower(trim(coalesce(p_role, '')));
begin
  case v_role
    when 'admin', 'super_admin', 'superadmin', 'platform_admin' then
      return 'super_admin';
    when 'organizer' then
      return 'organizer';
    when 'field_admin', 'fieldadmin' then
      return 'field_admin';
    when 'player' then
      return 'player';
    else
      raise exception 'Invalid role value: %. Allowed: admin|super_admin|organizer|field_admin|player', p_role;
  end case;
end;
$$;

create or replace function public.can_manage_roles()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- SQL editor / privileged sessions may not have JWT context.
  if auth.uid() is null then
    return current_user in ('postgres', 'supabase_admin', 'service_role');
  end if;

  return public.is_super_admin();
end;
$$;

create or replace function public.grant_role(
  p_user_email text,
  p_role text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(coalesce(p_user_email, '')));
  v_role text := public.normalize_field_user_role_input(p_role);
  v_target_user_id uuid;
  v_has_role boolean := false;
  v_has_user_role boolean := false;
  v_applied integer := 0;
  v_executed_by uuid := auth.uid();
  v_executed_by_email text := null;
begin
  if not public.can_manage_roles() then
    raise exception 'Only super_admin can manage roles';
  end if;

  if v_email = '' then
    raise exception 'p_user_email is required';
  end if;

  select u.id
  into v_target_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_target_user_id is null then
    raise exception 'User not found for email: %', v_email;
  end if;

  if v_executed_by is not null then
    select u.email
    into v_executed_by_email
    from auth.users u
    where u.id = v_executed_by
    limit 1;
  else
    v_executed_by_email := current_user;
  end if;

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
       values ($1, $2)
       on conflict (user_id, role) do nothing'
    using v_target_user_id, v_role;

    get diagnostics v_applied = row_count;
  elsif v_has_user_role then
    execute
      'insert into public.user_roles (user_id, user_role)
       values ($1, $2)
       on conflict do nothing'
    using v_target_user_id, v_role;

    get diagnostics v_applied = row_count;
  else
    raise exception 'user_roles table does not contain role/user_role column';
  end if;

  insert into public.role_admin_audit (
    target_user_id,
    target_email,
    role_text,
    action,
    reason,
    executed_by,
    executed_by_email
  )
  values (
    v_target_user_id,
    v_email,
    v_role,
    'grant',
    p_reason,
    v_executed_by,
    v_executed_by_email
  );

  if v_applied = 0 then
    return jsonb_build_object(
      'status', 'already_exists',
      'email', v_email,
      'role', v_role,
      'user_id', v_target_user_id
    );
  end if;

  return jsonb_build_object(
    'status', 'granted',
    'email', v_email,
    'role', v_role,
    'user_id', v_target_user_id
  );
end;
$$;

create or replace function public.revoke_role(
  p_user_email text,
  p_role text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(coalesce(p_user_email, '')));
  v_role text := public.normalize_field_user_role_input(p_role);
  v_target_user_id uuid;
  v_has_role boolean := false;
  v_has_user_role boolean := false;
  v_applied integer := 0;
  v_super_admin_count integer := 0;
  v_executed_by uuid := auth.uid();
  v_executed_by_email text := null;
begin
  if not public.can_manage_roles() then
    raise exception 'Only super_admin can manage roles';
  end if;

  if v_email = '' then
    raise exception 'p_user_email is required';
  end if;

  select u.id
  into v_target_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_target_user_id is null then
    raise exception 'User not found for email: %', v_email;
  end if;

  if v_executed_by is not null then
    select u.email
    into v_executed_by_email
    from auth.users u
    where u.id = v_executed_by
    limit 1;
  else
    v_executed_by_email := current_user;
  end if;

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

  if not v_has_role and not v_has_user_role then
    raise exception 'user_roles table does not contain role/user_role column';
  end if;

  if v_role = 'super_admin' then
    if auth.uid() is not null and auth.uid() = v_target_user_id then
      raise exception 'Cannot self-revoke super_admin';
    end if;

    if v_has_role then
      select count(*)
      into v_super_admin_count
      from public.user_roles ur
      where ur.role::text = 'super_admin';
    else
      execute
        'select count(*)
         from public.user_roles ur
         where ur.user_role::text = ''super_admin'''
      into v_super_admin_count;
    end if;

    if v_super_admin_count <= 1 then
      raise exception 'Cannot revoke last super_admin';
    end if;
  end if;

  if v_has_role then
    delete from public.user_roles
    where user_id = v_target_user_id
      and role::text = v_role;

    get diagnostics v_applied = row_count;
  else
    execute
      'delete from public.user_roles
       where user_id = $1
         and user_role::text = $2'
    using v_target_user_id, v_role;

    get diagnostics v_applied = row_count;
  end if;

  insert into public.role_admin_audit (
    target_user_id,
    target_email,
    role_text,
    action,
    reason,
    executed_by,
    executed_by_email
  )
  values (
    v_target_user_id,
    v_email,
    v_role,
    'revoke',
    p_reason,
    v_executed_by,
    v_executed_by_email
  );

  if v_applied = 0 then
    return jsonb_build_object(
      'status', 'not_assigned',
      'email', v_email,
      'role', v_role,
      'user_id', v_target_user_id
    );
  end if;

  return jsonb_build_object(
    'status', 'revoked',
    'email', v_email,
    'role', v_role,
    'user_id', v_target_user_id
  );
end;
$$;

grant execute on function public.can_manage_roles() to authenticated;
grant execute on function public.can_manage_roles() to service_role;
grant execute on function public.grant_role(text, text, text) to authenticated;
grant execute on function public.grant_role(text, text, text) to service_role;
grant execute on function public.revoke_role(text, text, text) to authenticated;
grant execute on function public.revoke_role(text, text, text) to service_role;

-- Requested assignment: grant admin role to the specified email.
do $$
begin
  if exists (
    select 1
    from auth.users u
    where lower(u.email) = 'gabrielneiraillanes@gmail.com'
  ) then
    perform public.grant_role(
      'gabrielneiraillanes@gmail.com',
      'admin',
      'Bootstrap admin assignment requested in repository task.'
    );
  else
    raise notice 'User gabrielneiraillanes@gmail.com not found yet; run SELECT public.grant_role(...) after signup.';
  end if;
end;
$$;
