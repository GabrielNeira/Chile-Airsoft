-- Supabase registration hardening
-- Goals:
-- 1) Enforce one real person = one profile using a deterministic RUT fingerprint.
-- 2) Require ID card photo URL during profile registration.
-- 3) Add admin review fields for identity verification.
-- Run after db/supabase_identity_linking.sql

create extension if not exists pgcrypto;

-- Compatibility: some environments may not have these enums yet.
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'operator_role'
      and n.nspname = 'public'
  ) then
    create type public.operator_role as enum (
      'assault',
      'sniper',
      'medic',
      'support',
      'dmr',
      'breacher',
      'recon',
      'commander',
      'other'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'blood_group'
      and n.nspname = 'public'
  ) then
    create type public.blood_group as enum (
      'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'
    );
  end if;
end $$;

-- Legacy compatibility: some databases still use role/blood_type instead of enum columns.
alter table public.operator_profiles
  add column if not exists blood_group public.blood_group,
  add column if not exists operator_role public.operator_role;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operator_profiles'
      and column_name = 'role'
  ) then
    execute $sql$
      update public.operator_profiles
      set operator_role = case lower(trim(coalesce("role", '')))
        when 'assault' then 'assault'::public.operator_role
        when 'sniper' then 'sniper'::public.operator_role
        when 'medic' then 'medic'::public.operator_role
        when 'support' then 'support'::public.operator_role
        when 'dmr' then 'dmr'::public.operator_role
        when 'breacher' then 'breacher'::public.operator_role
        when 'recon' then 'recon'::public.operator_role
        when 'commander' then 'commander'::public.operator_role
        else 'other'::public.operator_role
      end
      where operator_role is null
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operator_profiles'
      and column_name = 'blood_type'
  ) then
    execute $sql$
      update public.operator_profiles
      set blood_group = case upper(trim(coalesce(blood_type, '')))
        when 'A+' then 'A+'::public.blood_group
        when 'A-' then 'A-'::public.blood_group
        when 'B+' then 'B+'::public.blood_group
        when 'B-' then 'B-'::public.blood_group
        when 'AB+' then 'AB+'::public.blood_group
        when 'AB-' then 'AB-'::public.blood_group
        when 'O+' then 'O+'::public.blood_group
        when 'O-' then 'O-'::public.blood_group
        else blood_group
      end
      where blood_group is null
    $sql$;
  end if;

  update public.operator_profiles
  set operator_role = 'assault'::public.operator_role
  where operator_role is null;

  update public.operator_profiles
  set blood_group = 'O+'::public.blood_group
  where blood_group is null;

  alter table public.operator_profiles
    alter column operator_role set default 'assault'::public.operator_role;

  alter table public.operator_profiles
    alter column blood_group set default 'O+'::public.blood_group;
end $$;

-- Identity columns
alter table public.operator_profiles
  add column if not exists rut_fingerprint text,
  add column if not exists id_card_photo_url text,
  add column if not exists identity_verification_status text not null default 'pending',
  add column if not exists identity_verification_note text,
  add column if not exists identity_verified_at timestamptz,
  add column if not exists identity_verified_by uuid references auth.users (id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'operator_profiles_identity_verification_status_chk'
  ) then
    alter table public.operator_profiles
      add constraint operator_profiles_identity_verification_status_chk
      check (identity_verification_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

create unique index if not exists idx_operator_profiles_rut_fingerprint
  on public.operator_profiles (rut_fingerprint)
  where rut_fingerprint is not null;

-- Normalize and hash helpers (never store RUT plaintext)
create or replace function public.normalize_rut(p_rut text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p_rut, ''), '[^0-9kK]', '', 'g'));
$$;

create or replace function public.compute_rut_fingerprint(p_rut text, p_secret_key text)
returns text
language plpgsql
stable
as $$
declare
  v_input text := public.normalize_rut(p_rut) || ':' || p_secret_key;
  v_ext_schema text;
  v_hash text;
begin
  select n.nspname into v_ext_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto'
  limit 1;

  if v_ext_schema is null then
    raise exception 'pgcrypto extension is required';
  end if;

  execute format(
    'select encode(%I.digest($1::text, ''sha256''::text), ''hex'')',
    v_ext_schema
  ) into v_hash using v_input;

  return v_hash;
end;
$$;

create or replace function public.encrypt_rut(plain_rut text, secret_key text)
returns bytea
language plpgsql
stable
as $$
declare
  v_ext_schema text;
  v_cipher bytea;
begin
  select n.nspname into v_ext_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto'
  limit 1;

  if v_ext_schema is null then
    raise exception 'pgcrypto extension is required';
  end if;

  execute format(
    'select %I.pgp_sym_encrypt($1::text, $2::text)::bytea',
    v_ext_schema
  ) into v_cipher using plain_rut, secret_key;

  return v_cipher;
end;
$$;

create or replace function public.decrypt_rut(cipher_rut bytea, secret_key text)
returns text
language plpgsql
stable
as $$
declare
  v_ext_schema text;
  v_plain text;
begin
  select n.nspname into v_ext_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto'
  limit 1;

  if v_ext_schema is null then
    raise exception 'pgcrypto extension is required';
  end if;

  execute format(
    'select %I.pgp_sym_decrypt($1::bytea, $2::text)',
    v_ext_schema
  ) into v_plain using cipher_rut, secret_key;

  return v_plain;
end;
$$;

create or replace function public.is_valid_rut(p_rut text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_norm text;
  v_body text;
  v_dv text;
  v_sum integer := 0;
  v_factor integer := 2;
  v_digit integer;
  v_expected text;
  i integer;
begin
  v_norm := public.normalize_rut(p_rut);

  if v_norm !~ '^[0-9]{7,8}[0-9K]$' then
    return false;
  end if;

  v_body := left(v_norm, length(v_norm) - 1);
  v_dv := right(v_norm, 1);

  for i in reverse length(v_body)..1 loop
    v_digit := substr(v_body, i, 1)::integer;
    v_sum := v_sum + (v_digit * v_factor);
    v_factor := case when v_factor = 7 then 2 else v_factor + 1 end;
  end loop;

  case 11 - (v_sum % 11)
    when 11 then v_expected := '0';
    when 10 then v_expected := 'K';
    else v_expected := (11 - (v_sum % 11))::text;
  end case;

  return v_dv = v_expected;
end;
$$;

alter table public.operator_profiles
  drop constraint if exists operator_profiles_rut_fingerprint_required_chk;

alter table public.operator_profiles
  drop constraint if exists operator_profiles_id_card_photo_required_chk;

create or replace function public.tg_require_identity_on_insert()
returns trigger
language plpgsql
as $$
begin
  if new.rut_fingerprint is null then
    raise exception 'RUT fingerprint is required for new operator profile';
  end if;

  if length(trim(coalesce(new.id_card_photo_url, ''))) = 0 then
    raise exception 'ID card photo URL is required for new operator profile';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_require_identity_on_insert on public.operator_profiles;
create trigger trg_require_identity_on_insert
before insert on public.operator_profiles
for each row execute function public.tg_require_identity_on_insert();

-- Self-registration with mandatory ID photo
create or replace function public.register_my_operator_profile(
  p_nickname text,
  p_real_name text,
  p_rut_plain text,
  p_rut_secret_key text,
  p_blood_group public.blood_group,
  p_team text,
  p_operator_role public.operator_role,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_avatar_url text,
  p_id_card_photo_url text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fingerprint text;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  if coalesce(trim(p_rut_plain), '') = '' then
    raise exception 'RUT is required';
  end if;

  if not public.is_valid_rut(p_rut_plain) then
    raise exception 'Invalid RUT format or verifier digit';
  end if;

  if exists (select 1 from public.operator_profiles where user_id = v_uid) then
    raise exception 'Operator profile already exists for this account';
  end if;

  if coalesce(trim(p_id_card_photo_url), '') = '' then
    raise exception 'ID card photo is required';
  end if;

  v_fingerprint := public.compute_rut_fingerprint(p_rut_plain, p_rut_secret_key);

  if exists (
    select 1
    from public.operator_profiles op
    where op.rut_fingerprint = v_fingerprint
  ) then
    raise exception 'RUT already registered in another account';
  end if;

  insert into public.operator_profiles (
    user_id,
    nickname,
    real_name,
    rut_encrypted,
    rut_fingerprint,
    blood_group,
    team,
    operator_role,
    emergency_contact_name,
    emergency_contact_phone,
    avatar_url,
    id_card_photo_url,
    identity_verification_status
  )
  values (
    v_uid,
    p_nickname,
    p_real_name,
    public.encrypt_rut(p_rut_plain, p_rut_secret_key),
    v_fingerprint,
    p_blood_group,
    p_team,
    p_operator_role,
    p_emergency_contact_name,
    p_emergency_contact_phone,
    p_avatar_url,
    p_id_card_photo_url,
    'pending'
  );

  return v_uid;
end;
$$;

-- Admin verification workflow
create or replace function public.admin_review_operator_identity(
  p_operator_user_id uuid,
  p_status text,
  p_note text default null
)
returns void
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
    raise exception 'Only super_admin can review operator identity';
  end if;

  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Invalid status. Use pending, approved or rejected';
  end if;

  update public.operator_profiles
  set
    identity_verification_status = p_status,
    identity_verification_note = p_note,
    identity_verified_at = now(),
    identity_verified_by = v_editor
  where user_id = p_operator_user_id;

  if not found then
    raise exception 'Operator profile not found';
  end if;
end;
$$;

-- Optional: private storage bucket for ID documents
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'operator-id-documents',
  'operator-id-documents',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists id_docs_insert_own on storage.objects;
create policy id_docs_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'operator-id-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists id_docs_read_own on storage.objects;
create policy id_docs_read_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'operator-id-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Keep operator ID uniqueness explicit
create unique index if not exists idx_operator_profiles_credential_code
  on public.operator_profiles (credential_code);
