-- Supabase real_name immutable hardening
-- Goal:
-- 1) Prevent self-service edits of real_name at backend level.
-- 2) Keep API compatibility with existing frontend payloads.
-- 3) Add nullable ICE2 and allergies profile fields.
-- Run after: db/supabase_identity_linking.sql

alter table public.operator_profiles
  add column if not exists emergency_contact_name_2 text,
  add column if not exists emergency_contact_phone_2 text,
  add column if not exists allergies text;

-- Replace self-edit RPC so real_name is not updated anymore.
-- Compatibility note: this variant avoids enum-typed parameters so it runs on
-- environments where public.operator_role/public.blood_group were created as text.
do $$
declare
  v_proc record;
begin
  for v_proc in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'update_my_operator_profile'
  loop
    execute format('drop function %s', v_proc.signature);
  end loop;
end
$$;

create or replace function public.update_my_operator_profile(
  p_nickname text,
  p_real_name text,
  p_blood_group text,
  p_team text,
  p_operator_role text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_avatar_url text,
  p_emergency_contact_name_2 text default null,
  p_emergency_contact_phone_2 text default null,
  p_allergies text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old record;
  v_blood_group_type text;
  v_role_type text;
  v_role_column text;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select op.* into v_old
  from public.operator_profiles op
  where op.user_id = v_uid;

  if v_old is null then
    raise exception 'Profile not found for current user';
  end if;

  update public.operator_profiles
  set
    nickname = p_nickname,
    team = p_team,
    emergency_contact_name = p_emergency_contact_name,
    emergency_contact_phone = p_emergency_contact_phone,
    avatar_url = p_avatar_url,
    emergency_contact_name_2 = p_emergency_contact_name_2,
    emergency_contact_phone_2 = p_emergency_contact_phone_2,
    allergies = nullif(trim(p_allergies), '')
  where user_id = v_uid;

  select a.atttypid::regtype::text
  into v_blood_group_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'operator_profiles'
    and a.attname = 'blood_group'
    and a.attnum > 0
    and not a.attisdropped;

  if v_blood_group_type is not null then
    execute format(
      'update public.operator_profiles set blood_group = $1::%s where user_id = $2',
      v_blood_group_type
    )
    using p_blood_group, v_uid;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operator_profiles'
      and column_name = 'operator_role'
  ) then
    v_role_column := 'operator_role';
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operator_profiles'
      and column_name = 'user_role'
  ) then
    v_role_column := 'user_role';
  else
    v_role_column := null;
  end if;

  if v_role_column is not null then
    select a.atttypid::regtype::text
    into v_role_type
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'operator_profiles'
      and a.attname = v_role_column
      and a.attnum > 0
      and not a.attisdropped;

    execute format(
      'update public.operator_profiles set %I = $1::%s where user_id = $2',
      v_role_column,
      v_role_type
    )
    using p_operator_role, v_uid;
  end if;

  -- p_real_name kept only for API compatibility. real_name is immutable here.
end;
$$;

-- Guardrail: block direct updates to real_name for non-admin authenticated users.
create or replace function public.tg_block_real_name_self_edit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.real_name is distinct from old.real_name then
    -- Allow trusted server-side contexts without an end-user JWT.
    if auth.uid() is null then
      return new;
    end if;

    if not public.is_super_admin() then
      raise exception 'real_name is immutable and cannot be edited by the user';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_block_real_name_self_edit on public.operator_profiles;
create trigger trg_block_real_name_self_edit
before update of real_name on public.operator_profiles
for each row execute function public.tg_block_real_name_self_edit();
