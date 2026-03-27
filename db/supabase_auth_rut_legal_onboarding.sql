-- Supabase auth + onboarding legal hardening (Chile)
-- Objetivo:
-- 1) RUT como llave unica transversal (tabla maestra de identidad)
-- 2) Registro base: rut, correo, edad, nombres autocompletados
-- 3) Cumplimiento de avisos/comprobaciones alineadas a Ley N 19.628
-- 4) Soporte para login por RUT con bitacora y rate-limit basico
--
-- Requisito previo: db/supabase_registration_hardening.sql

create extension if not exists citext;
create extension if not exists pgcrypto;

-- Compatibilidad RLS: en algunos esquemas legacy user_roles usa user_role en lugar de role.
create or replace function public.is_super_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_has_role boolean := false;
  v_has_user_role boolean := false;
  v_result boolean := false;
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

  if v_has_role then
    execute
      'select exists (
         select 1
         from public.user_roles ur
         where ur.user_id = $1
           and ur.role::text = ''super_admin''
       )'
    into v_result
    using auth.uid();

    return coalesce(v_result, false);
  end if;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'user_roles'
      and c.column_name = 'user_role'
  ) into v_has_user_role;

  if v_has_user_role then
    execute
      'select exists (
         select 1
         from public.user_roles ur
         where ur.user_id = $1
           and ur.user_role::text = ''super_admin''
       )'
    into v_result
    using auth.uid();

    return coalesce(v_result, false);
  end if;

  return false;
exception
  when undefined_table or undefined_column then
    return false;
end;
$$;

-- Compatibilidad legacy: algunos entornos antiguos no tienen blood_group en operator_profiles.
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

-- Mascara de correo para UX sin exponer correo completo
create or replace function public.mask_email(p_email text)
returns text
language plpgsql
immutable
as $$
declare
  v_local text;
  v_domain text;
begin
  if p_email is null or position('@' in p_email) = 0 then
    return '***@***';
  end if;

  v_local := split_part(p_email, '@', 1);
  v_domain := split_part(p_email, '@', 2);

  if length(v_local) <= 2 then
    v_local := repeat('*', length(v_local));
  else
    v_local := left(v_local, 1) || repeat('*', greatest(length(v_local) - 2, 1)) || right(v_local, 1);
  end if;

  return v_local || '@' || v_domain;
end;
$$;

-- Tabla maestra de identidad. El RUT es la PK funcional del usuario.
create table if not exists public.rut_identities (
  rut text primary key,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  email citext not null unique,
  age smallint not null check (age between 14 and 120),
  legal_full_names text not null,
  names_autocomplete_source text not null default 'sii_api',
  names_autocompleted_at timestamptz not null default now(),
  guardian_full_name text,
  guardian_rut text,
  guardian_email citext,
  guardian_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (public.is_valid_rut(rut)),
  check (
    age >= 18
    or (
      length(trim(coalesce(guardian_full_name, ''))) > 0
      and guardian_rut is not null
      and public.is_valid_rut(guardian_rut)
      and guardian_email is not null
      and guardian_consent_at is not null
    )
  )
);

create index if not exists idx_rut_identities_user_id on public.rut_identities (user_id);
create index if not exists idx_rut_identities_email on public.rut_identities (email);

create or replace function public.tg_normalize_rut_identities()
returns trigger
language plpgsql
as $$
begin
  new.rut := public.normalize_rut(new.rut);

  if new.guardian_rut is not null then
    new.guardian_rut := public.normalize_rut(new.guardian_rut);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_rut_identities on public.rut_identities;
create trigger trg_normalize_rut_identities
before insert or update on public.rut_identities
for each row execute function public.tg_normalize_rut_identities();

drop trigger if exists trg_rut_identities_updated_at on public.rut_identities;
create trigger trg_rut_identities_updated_at
before update on public.rut_identities
for each row execute function public.tg_set_updated_at();

-- Vinculo transversal hacia perfiles operativos
alter table public.operator_profiles
  add column if not exists rut_pk text;

alter table public.operator_profiles
  add column if not exists blood_group public.blood_group;

alter table public.operator_profiles
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
  set blood_group = 'O+'::public.blood_group
  where blood_group is null;

  alter table public.operator_profiles
    alter column blood_group set default 'O+'::public.blood_group;

  alter table public.operator_profiles
    alter column blood_group set not null;

  update public.operator_profiles
  set operator_role = 'assault'::public.operator_role
  where operator_role is null;

  alter table public.operator_profiles
    alter column operator_role set default 'assault'::public.operator_role;

  alter table public.operator_profiles
    alter column operator_role set not null;
end $$;

create unique index if not exists idx_operator_profiles_rut_pk
  on public.operator_profiles (rut_pk)
  where rut_pk is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'operator_profiles_rut_pk_fkey'
  ) then
    alter table public.operator_profiles
      add constraint operator_profiles_rut_pk_fkey
      foreign key (rut_pk)
      references public.rut_identities (rut)
      on delete restrict;
  end if;
end $$;

-- Historial de consentimientos (auditable)
create table if not exists public.user_privacy_consents (
  id uuid primary key default gen_random_uuid(),
  rut text not null references public.rut_identities (rut) on delete cascade,
  consent_kind text not null,
  consent_version text not null,
  accepted boolean not null,
  accepted_at timestamptz not null default now(),
  purpose text not null,
  legal_reference text not null default 'Ley N 19.628',
  ip inet,
  user_agent text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (consent_kind in (
    'privacy_notice',
    'terms_and_conditions',
    'data_processing',
    'guardian_authorization'
  ))
);

create unique index if not exists idx_user_privacy_consents_unique
  on public.user_privacy_consents (rut, consent_kind, consent_version);

create index if not exists idx_user_privacy_consents_rut_created
  on public.user_privacy_consents (rut, created_at desc);

-- Bitacora de intentos de login por RUT (seguridad operacional)
create table if not exists public.rut_login_attempts (
  id bigserial primary key,
  rut text not null,
  requested_by uuid references auth.users (id) on delete set null,
  ip inet,
  user_agent text,
  was_rate_limited boolean not null default false,
  attempted_at timestamptz not null default now(),
  check (public.is_valid_rut(rut))
);

create index if not exists idx_rut_login_attempts_rut_time
  on public.rut_login_attempts (rut, attempted_at desc);

create index if not exists idx_rut_login_attempts_ip_time
  on public.rut_login_attempts (ip, attempted_at desc);

alter table public.rut_identities enable row level security;
alter table public.user_privacy_consents enable row level security;
alter table public.rut_login_attempts enable row level security;

drop policy if exists rut_identities_select_own on public.rut_identities;
create policy rut_identities_select_own
on public.rut_identities
for select
using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists rut_identities_update_own on public.rut_identities;
create policy rut_identities_update_own
on public.rut_identities
for update
using (user_id = auth.uid() or public.is_super_admin())
with check (user_id = auth.uid() or public.is_super_admin());

drop policy if exists privacy_consents_select_own on public.user_privacy_consents;
create policy privacy_consents_select_own
on public.user_privacy_consents
for select
using (
  exists (
    select 1
    from public.rut_identities ri
    where ri.rut = user_privacy_consents.rut
      and (ri.user_id = auth.uid() or public.is_super_admin())
  )
);

drop policy if exists rut_login_attempts_admin_read on public.rut_login_attempts;
create policy rut_login_attempts_admin_read
on public.rut_login_attempts
for select
using (public.is_super_admin());

-- Registro/onboarding con validaciones legales y datos minimos requeridos
create or replace function public.register_my_identity_with_rut(
  p_rut text,
  p_email text,
  p_age integer,
  p_autocompleted_full_names text,
  p_names_source text default 'sii_api',
  p_privacy_version text default 'v1',
  p_terms_version text default 'v1',
  p_data_processing_version text default 'v1',
  p_accept_privacy boolean default false,
  p_accept_terms boolean default false,
  p_accept_data_processing boolean default false,
  p_guardian_full_name text default null,
  p_guardian_rut text default null,
  p_guardian_email text default null,
  p_guardian_acceptance boolean default false,
  p_ip inet default null,
  p_user_agent text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_auth_email text;
  v_norm_rut text;
  v_existing_user uuid;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  if p_rut is null or not public.is_valid_rut(p_rut) then
    raise exception 'RUT invalido';
  end if;

  if p_age is null or p_age < 14 or p_age > 120 then
    raise exception 'Edad fuera de rango permitido';
  end if;

  if length(trim(coalesce(p_autocompleted_full_names, ''))) = 0 then
    raise exception 'Nombres autocompletados son obligatorios';
  end if;

  if not (coalesce(p_accept_privacy, false) and coalesce(p_accept_terms, false) and coalesce(p_accept_data_processing, false)) then
    raise exception 'Debe aceptar aviso de privacidad, terminos y tratamiento de datos';
  end if;

  if p_age < 18 then
    if not coalesce(p_guardian_acceptance, false) then
      raise exception 'Se requiere autorizacion del representante legal para menor de edad';
    end if;

    if length(trim(coalesce(p_guardian_full_name, ''))) = 0 then
      raise exception 'Nombre del representante legal es obligatorio';
    end if;

    if p_guardian_rut is null or not public.is_valid_rut(p_guardian_rut) then
      raise exception 'RUT del representante legal invalido';
    end if;

    if length(trim(coalesce(p_guardian_email, ''))) = 0 then
      raise exception 'Correo del representante legal es obligatorio';
    end if;
  end if;

  select u.email into v_auth_email
  from auth.users u
  where u.id = v_uid;

  if v_auth_email is null then
    raise exception 'No se encontro correo asociado a la cuenta';
  end if;

  if lower(trim(v_auth_email)) <> lower(trim(coalesce(p_email, ''))) then
    raise exception 'El correo informado no coincide con el correo autenticado';
  end if;

  v_norm_rut := public.normalize_rut(p_rut);

  select ri.user_id into v_existing_user
  from public.rut_identities ri
  where ri.rut = v_norm_rut;

  if v_existing_user is not null and v_existing_user <> v_uid then
    raise exception 'RUT ya registrado por otra cuenta';
  end if;

  insert into public.rut_identities (
    rut,
    user_id,
    email,
    age,
    legal_full_names,
    names_autocomplete_source,
    names_autocompleted_at,
    guardian_full_name,
    guardian_rut,
    guardian_email,
    guardian_consent_at
  )
  values (
    v_norm_rut,
    v_uid,
    lower(trim(v_auth_email)),
    p_age,
    trim(p_autocompleted_full_names),
    coalesce(nullif(trim(coalesce(p_names_source, '')), ''), 'sii_api'),
    now(),
    nullif(trim(coalesce(p_guardian_full_name, '')), ''),
    case
      when p_guardian_rut is null then null
      else public.normalize_rut(p_guardian_rut)
    end,
    nullif(lower(trim(coalesce(p_guardian_email, ''))), ''),
    case when p_age < 18 then now() else null end
  )
  on conflict (rut) do update
  set
    user_id = excluded.user_id,
    email = excluded.email,
    age = excluded.age,
    legal_full_names = excluded.legal_full_names,
    names_autocomplete_source = excluded.names_autocomplete_source,
    names_autocompleted_at = now(),
    guardian_full_name = excluded.guardian_full_name,
    guardian_rut = excluded.guardian_rut,
    guardian_email = excluded.guardian_email,
    guardian_consent_at = excluded.guardian_consent_at,
    updated_at = now();

  insert into public.user_privacy_consents (
    rut,
    consent_kind,
    consent_version,
    accepted,
    accepted_at,
    purpose,
    ip,
    user_agent,
    created_by
  )
  values
    (v_norm_rut, 'privacy_notice', p_privacy_version, true, now(), 'Informar tratamiento de datos personales del registro', p_ip, p_user_agent, v_uid),
    (v_norm_rut, 'terms_and_conditions', p_terms_version, true, now(), 'Aceptar reglas de uso de la plataforma', p_ip, p_user_agent, v_uid),
    (v_norm_rut, 'data_processing', p_data_processing_version, true, now(), 'Autorizar tratamiento para autenticacion y operacion del servicio', p_ip, p_user_agent, v_uid)
  on conflict (rut, consent_kind, consent_version) do update
  set
    accepted = excluded.accepted,
    accepted_at = excluded.accepted_at,
    ip = excluded.ip,
    user_agent = excluded.user_agent,
    created_by = excluded.created_by;

  if p_age < 18 then
    insert into public.user_privacy_consents (
      rut,
      consent_kind,
      consent_version,
      accepted,
      accepted_at,
      purpose,
      ip,
      user_agent,
      created_by
    )
    values (
      v_norm_rut,
      'guardian_authorization',
      p_privacy_version,
      true,
      now(),
      'Autorizacion del representante legal para tratamiento de datos de menor',
      p_ip,
      p_user_agent,
      v_uid
    )
    on conflict (rut, consent_kind, consent_version) do update
    set
      accepted = excluded.accepted,
      accepted_at = excluded.accepted_at,
      ip = excluded.ip,
      user_agent = excluded.user_agent,
      created_by = excluded.created_by;
  end if;

  update public.operator_profiles op
  set rut_pk = v_norm_rut
  where op.user_id = v_uid
    and op.rut_pk is null;

  return v_norm_rut;
end;
$$;

-- Consulta para UX de login por RUT (sin revelar existencia de cuenta)
create or replace function public.request_rut_login_hint(
  p_rut text,
  p_ip inet default null,
  p_user_agent text default null
)
returns table (
  allowed boolean,
  message text,
  masked_email text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm_rut text;
  v_recent_attempts integer;
  v_email text;
  v_uid uuid := auth.uid();
begin
  if p_rut is null or not public.is_valid_rut(p_rut) then
    return query
    select false, 'No fue posible procesar la solicitud.', '***@***';
    return;
  end if;

  v_norm_rut := public.normalize_rut(p_rut);

  select count(*) into v_recent_attempts
  from public.rut_login_attempts a
  where a.rut = v_norm_rut
    and a.attempted_at > now() - interval '15 minutes'
    and (
      (p_ip is not null and a.ip = p_ip)
      or p_ip is null
    );

  insert into public.rut_login_attempts (
    rut,
    requested_by,
    ip,
    user_agent,
    was_rate_limited,
    attempted_at
  )
  values (
    v_norm_rut,
    v_uid,
    p_ip,
    p_user_agent,
    v_recent_attempts >= 5,
    now()
  );

  if v_recent_attempts >= 5 then
    return query
    select false, 'Demasiados intentos. Espera 15 minutos antes de reintentar.', '***@***';
    return;
  end if;

  select ri.email::text into v_email
  from public.rut_identities ri
  where ri.rut = v_norm_rut;

  return query
  select
    true,
    'Si el RUT esta registrado, se enviaran instrucciones al correo asociado.',
    case
      when v_email is null then '***@***'
      else public.mask_email(v_email)
    end;
end;
$$;

-- Consulta de identidad propia para frontend (RUT visible al titular autenticado)
create or replace function public.get_my_identity_summary()
returns table (
  rut text,
  email text,
  age integer,
  legal_full_names text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  return query
  select
    ri.rut,
    ri.email::text,
    ri.age::integer,
    ri.legal_full_names
  from public.rut_identities ri
  where ri.user_id = v_uid;
end;
$$;

revoke all on public.rut_identities from anon, authenticated;
revoke all on public.user_privacy_consents from anon, authenticated;
revoke all on public.rut_login_attempts from anon, authenticated;

grant execute on function public.register_my_identity_with_rut(
  text, text, integer, text, text, text, text, text, boolean, boolean, boolean,
  text, text, text, boolean, inet, text
) to authenticated;

grant execute on function public.request_rut_login_hint(text, inet, text) to anon, authenticated;

grant execute on function public.get_my_identity_summary() to authenticated;
