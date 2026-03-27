-- Allow repeated nicknames; keep person uniqueness by RUT fingerprint.
-- Run after db/supabase_registration_hardening.sql

-- 1) Remove nickname uniqueness if it exists from old schema
alter table public.operator_profiles
  drop constraint if exists operator_profiles_nickname_key;

-- 2) Ensure fast lookup by nickname without forcing uniqueness
create index if not exists idx_operator_profiles_nickname
  on public.operator_profiles (nickname);

-- 3) Keep unique person identity by RUT fingerprint (created in registration hardening)
create unique index if not exists idx_operator_profiles_rut_fingerprint
  on public.operator_profiles (rut_fingerprint)
  where rut_fingerprint is not null;
