-- Supabase identity linking + profile editing workflow
-- Run after:
-- 1) db/supabase_schema.sql
-- 2) db/supabase_progression.sql
-- 3) db/supabase_player_metrics.sql
-- 4) db/supabase_id_metrics_view.sql

create extension if not exists pgcrypto;

-- 1) Unique credential code linked 1:1 to auth account (operator_profiles.user_id)
alter table public.operator_profiles
  add column if not exists credential_code text;

create or replace function public.generate_credential_code()
returns text
language plpgsql
as $$
declare
  v_code text;
begin
  v_code := 'CO-CL-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
  return v_code;
end;
$$;

update public.operator_profiles
set credential_code = public.generate_credential_code()
where credential_code is null;

alter table public.operator_profiles
  alter column credential_code set not null;

create unique index if not exists idx_operator_profiles_credential_code
  on public.operator_profiles (credential_code);

create or replace function public.tg_set_credential_code()
returns trigger
language plpgsql
as $$
begin
  if new.credential_code is null or length(trim(new.credential_code)) = 0 then
    new.credential_code := public.generate_credential_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_operator_profiles_set_credential_code on public.operator_profiles;
create trigger trg_operator_profiles_set_credential_code
before insert on public.operator_profiles
for each row execute function public.tg_set_credential_code();

-- 2) Audit table for profile edits
create table if not exists public.operator_profile_edit_audit (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null references public.operator_profiles (user_id) on delete cascade,
  edited_by uuid not null references auth.users (id) on delete restrict,
  edit_scope text not null,
  old_nickname text,
  new_nickname text,
  old_real_name text,
  new_real_name text,
  old_blood_group public.blood_group,
  new_blood_group public.blood_group,
  old_team text,
  new_team text,
  old_operator_role public.operator_role,
  new_operator_role public.operator_role,
  old_emergency_contact_name text,
  new_emergency_contact_name text,
  old_emergency_contact_phone text,
  new_emergency_contact_phone text,
  old_avatar_url text,
  new_avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.operator_profile_edit_audit enable row level security;

drop policy if exists profile_audit_read_own on public.operator_profile_edit_audit;
create policy profile_audit_read_own
on public.operator_profile_edit_audit
for select
using (operator_user_id = auth.uid() or public.is_super_admin());

-- 3) Function for user self-edit (explicit typed fields, no JSON)
create or replace function public.update_my_operator_profile(
  p_nickname text,
  p_real_name text,
  p_blood_group public.blood_group,
  p_team text,
  p_operator_role public.operator_role,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_avatar_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.operator_profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_old
  from public.operator_profiles op
  where op.user_id = v_uid;

  if v_old.user_id is null then
    raise exception 'Profile not found for current user';
  end if;

  update public.operator_profiles
  set
    nickname = p_nickname,
    real_name = p_real_name,
    blood_group = p_blood_group,
    team = p_team,
    operator_role = p_operator_role,
    emergency_contact_name = p_emergency_contact_name,
    emergency_contact_phone = p_emergency_contact_phone,
    avatar_url = p_avatar_url
  where user_id = v_uid;

  insert into public.operator_profile_edit_audit (
    operator_user_id,
    edited_by,
    edit_scope,
    old_nickname,
    new_nickname,
    old_real_name,
    new_real_name,
    old_blood_group,
    new_blood_group,
    old_team,
    new_team,
    old_operator_role,
    new_operator_role,
    old_emergency_contact_name,
    new_emergency_contact_name,
    old_emergency_contact_phone,
    new_emergency_contact_phone,
    old_avatar_url,
    new_avatar_url
  )
  values (
    v_uid,
    v_uid,
    'self',
    v_old.nickname,
    p_nickname,
    v_old.real_name,
    p_real_name,
    v_old.blood_group,
    p_blood_group,
    v_old.team,
    p_team,
    v_old.operator_role,
    p_operator_role,
    v_old.emergency_contact_name,
    p_emergency_contact_name,
    v_old.emergency_contact_phone,
    p_emergency_contact_phone,
    v_old.avatar_url,
    p_avatar_url
  );
end;
$$;

-- 4) Function for admin editing any operator profile (explicit typed fields)
create or replace function public.admin_update_operator_profile(
  p_operator_user_id uuid,
  p_nickname text,
  p_real_name text,
  p_blood_group public.blood_group,
  p_team text,
  p_operator_role public.operator_role,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_avatar_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_editor uuid := auth.uid();
  v_old public.operator_profiles%rowtype;
begin
  if v_editor is null then
    raise exception 'Unauthorized';
  end if;

  if not public.is_super_admin() then
    raise exception 'Only super_admin can edit any profile';
  end if;

  select * into v_old
  from public.operator_profiles op
  where op.user_id = p_operator_user_id;

  if v_old.user_id is null then
    raise exception 'Target operator profile not found';
  end if;

  update public.operator_profiles
  set
    nickname = p_nickname,
    real_name = p_real_name,
    blood_group = p_blood_group,
    team = p_team,
    operator_role = p_operator_role,
    emergency_contact_name = p_emergency_contact_name,
    emergency_contact_phone = p_emergency_contact_phone,
    avatar_url = p_avatar_url
  where user_id = p_operator_user_id;

  insert into public.operator_profile_edit_audit (
    operator_user_id,
    edited_by,
    edit_scope,
    old_nickname,
    new_nickname,
    old_real_name,
    new_real_name,
    old_blood_group,
    new_blood_group,
    old_team,
    new_team,
    old_operator_role,
    new_operator_role,
    old_emergency_contact_name,
    new_emergency_contact_name,
    old_emergency_contact_phone,
    new_emergency_contact_phone,
    old_avatar_url,
    new_avatar_url
  )
  values (
    p_operator_user_id,
    v_editor,
    'admin',
    v_old.nickname,
    p_nickname,
    v_old.real_name,
    p_real_name,
    v_old.blood_group,
    p_blood_group,
    v_old.team,
    p_team,
    v_old.operator_role,
    p_operator_role,
    v_old.emergency_contact_name,
    p_emergency_contact_name,
    v_old.emergency_contact_phone,
    p_emergency_contact_phone,
    v_old.avatar_url,
    p_avatar_url
  );
end;
$$;

-- 4.1) Function for admin to create a new linked operator profile (1:1 with auth user)
create or replace function public.admin_create_operator_profile(
  p_user_id uuid,
  p_nickname text,
  p_real_name text,
  p_rut_plain text,
  p_rut_secret_key text,
  p_blood_group public.blood_group,
  p_team text,
  p_operator_role public.operator_role,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_avatar_url text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_editor uuid := auth.uid();
begin
  if v_editor is null then
    raise exception 'Unauthorized';
  end if;

  if not public.is_super_admin() then
    raise exception 'Only super_admin can create operator profiles';
  end if;

  if exists (select 1 from public.operator_profiles where user_id = p_user_id) then
    raise exception 'Operator profile already exists for this user';
  end if;

  insert into public.operator_profiles (
    user_id,
    nickname,
    real_name,
    rut_encrypted,
    blood_group,
    team,
    operator_role,
    emergency_contact_name,
    emergency_contact_phone,
    avatar_url
  )
  values (
    p_user_id,
    p_nickname,
    p_real_name,
    public.encrypt_rut(p_rut_plain, p_rut_secret_key),
    p_blood_group,
    p_team,
    p_operator_role,
    p_emergency_contact_name,
    p_emergency_contact_phone,
    p_avatar_url
  );

  return p_user_id;
end;
$$;

-- 5) Convenience view for admin directory (no sensitive rut plaintext)
create or replace view public.v_operator_directory_admin as
select
  op.user_id,
  op.credential_code,
  op.nickname,
  op.real_name,
  op.blood_group,
  op.team,
  op.operator_role,
  op.emergency_contact_name,
  op.emergency_contact_phone,
  op.avatar_url,
  op.created_at,
  op.updated_at
from public.operator_profiles op;

grant select on public.v_operator_directory_admin to authenticated;
