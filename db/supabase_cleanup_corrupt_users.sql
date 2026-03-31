-- Cleanup helper for users stuck in inconsistent onboarding/registration state.
--
-- Usage:
-- 1) Set v_apply := false and run to preview.
-- 2) Fill _cleanup_targets with emails and/or RUTs.
-- 3) Set v_apply := true and run to apply.
--
-- This script resets identity/profile state so users can retry onboarding.
-- It does NOT delete auth.users unless v_delete_auth_user = true.

create extension if not exists citext;

DO $$
DECLARE
  v_apply boolean := false;
  v_delete_auth_user boolean := false;
  v_target_emails text[] := array[
    'gabriel.neira@andesminingsolutions.com',
    'neiragabriel1995@gmail.com'
  ]::text[];
  v_target_ruts text[] := array[]::text[];
  v_target_user_ids uuid[] := array[]::uuid[];
  v_count_targets integer := 0;
  v_count_profiles integer := 0;
  v_count_identities integer := 0;
  v_count_consents integer := 0;
  v_count_attempts integer := 0;
  v_count_auth_users integer := 0;
BEGIN
  create temporary table if not exists _cleanup_targets (
    email citext,
    rut text,
    user_id uuid
  ) on commit drop;

  truncate table _cleanup_targets;

  -- Quick input mode (recommended): fill one or more arrays.
  -- v_target_emails := array['user1@example.com', 'user2@example.com'];
  -- v_target_ruts := array['12.345.678-5'];
  -- v_target_user_ids := array['00000000-0000-0000-0000-000000000000'::uuid];

  if coalesce(array_length(v_target_emails, 1), 0) > 0 then
    insert into _cleanup_targets (email)
    select unnest(v_target_emails)::citext;
  end if;

  if coalesce(array_length(v_target_ruts, 1), 0) > 0 then
    insert into _cleanup_targets (rut)
    select unnest(v_target_ruts);
  end if;

  if coalesce(array_length(v_target_user_ids, 1), 0) > 0 then
    insert into _cleanup_targets (user_id)
    select unnest(v_target_user_ids);
  end if;

  -- TODO: replace these examples with real users to clean.
  -- insert into _cleanup_targets (email) values
  --   ('user1@example.com'),
  --   ('user2@example.com');
  --
  -- insert into _cleanup_targets (rut) values
  --   ('12.345.678-5');
  --
  -- insert into _cleanup_targets (user_id) values
  --   ('00000000-0000-0000-0000-000000000000');

  -- Normalize any provided RUTs when helper exists.
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'normalize_rut'
  ) then
    update _cleanup_targets
    set rut = public.normalize_rut(rut)
    where rut is not null;
  end if;

  -- Resolve user_id by email and/or rut.
  update _cleanup_targets t
  set user_id = coalesce(
    t.user_id,
    (select u.id from auth.users u where lower(u.email) = lower(t.email::text) limit 1),
    (select ri.user_id from public.rut_identities ri where ri.rut = t.rut limit 1)
  );

  select count(*) into v_count_targets
  from _cleanup_targets t
  where t.user_id is not null;

  if v_count_targets = 0 then
    raise notice 'No target users resolved.';
    raise notice 'Set v_target_emails / v_target_ruts / v_target_user_ids, or insert rows into _cleanup_targets.';
    raise notice 'Example: v_target_emails := array[''gabriel.neira@andesminingsolutions.com''];';
    return;
  end if;

  select count(*) into v_count_profiles
  from public.operator_profiles op
  where op.user_id in (select t.user_id from _cleanup_targets t where t.user_id is not null);

  select count(*) into v_count_identities
  from public.rut_identities ri
  where ri.user_id in (select t.user_id from _cleanup_targets t where t.user_id is not null)
     or ri.rut in (select t.rut from _cleanup_targets t where t.rut is not null);

  select count(*) into v_count_consents
  from public.user_privacy_consents c
  where c.rut in (
    select ri.rut
    from public.rut_identities ri
    where ri.user_id in (select t.user_id from _cleanup_targets t where t.user_id is not null)
    union
    select t.rut from _cleanup_targets t where t.rut is not null
  );

  select count(*) into v_count_attempts
  from public.rut_login_attempts a
  where a.rut in (
    select ri.rut
    from public.rut_identities ri
    where ri.user_id in (select t.user_id from _cleanup_targets t where t.user_id is not null)
    union
    select t.rut from _cleanup_targets t where t.rut is not null
  );

  select count(*) into v_count_auth_users
  from auth.users u
  where u.id in (select t.user_id from _cleanup_targets t where t.user_id is not null);

  raise notice 'Targets resolved: %', v_count_targets;
  raise notice 'Would delete operator_profiles: %', v_count_profiles;
  raise notice 'Would delete rut_identities: %', v_count_identities;
  raise notice 'Would delete user_privacy_consents: %', v_count_consents;
  raise notice 'Would delete rut_login_attempts: %', v_count_attempts;
  if v_delete_auth_user then
    raise notice 'Would delete auth.users: %', v_count_auth_users;
  end if;

  if not v_apply then
    raise notice 'Preview mode only. Set v_apply := true to execute.';
    return;
  end if;

  -- Reset onboarding/profile state.
  delete from public.operator_profiles op
  where op.user_id in (select t.user_id from _cleanup_targets t where t.user_id is not null);

  delete from public.rut_identities ri
  where ri.user_id in (select t.user_id from _cleanup_targets t where t.user_id is not null)
     or ri.rut in (select t.rut from _cleanup_targets t where t.rut is not null);

  -- Optional metadata cleanup so old hints do not auto-populate.
  update auth.users u
  set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb) - 'rut' - 'legal_full_names'
  where u.id in (select t.user_id from _cleanup_targets t where t.user_id is not null);

  if v_delete_auth_user then
    delete from auth.users u
    where u.id in (select t.user_id from _cleanup_targets t where t.user_id is not null);
  end if;

  raise notice 'Cleanup applied successfully.';
END $$;
