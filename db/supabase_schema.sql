-- ChileAirsoft / Sygtactical
-- Core schema for CO (Credencial de Operador)
-- Target: Supabase (PostgreSQL 15+)

create extension if not exists pgcrypto;

-- Enums
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

create type public.blood_group as enum (
  'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'
);

create type public.fair_play_status as enum (
  'green',
  'yellow',
  'red'
);

create type public.field_user_role as enum (
  'player',
  'field_admin',
  'organizer',
  'super_admin'
);

-- Profiles and roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.field_user_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table public.operator_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  real_name text not null,
  rut_encrypted bytea not null,
  blood_group public.blood_group not null,
  team text,
  operator_role public.operator_role not null default 'assault',
  emergency_contact_name text,
  emergency_contact_phone text,
  avatar_url text,
  team_logo_url text,
  unique_qr_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fields (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.field_admins (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (field_id, user_id)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields (id) on delete restrict,
  title text not null,
  event_date date not null,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.event_organizers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (event_id, user_id)
);

-- Helper functions for RLS (defined after dependent tables exist)
create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'super_admin'
  );
$$;

create or replace function public.is_field_admin(field_id_input uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.field_admins fa
    where fa.user_id = auth.uid()
      and fa.field_id = field_id_input
  )
  or public.is_super_admin();
$$;

create or replace function public.is_organizer_for_event(event_id_input uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.event_organizers eo
    where eo.user_id = auth.uid()
      and eo.event_id = event_id_input
  )
  or public.is_super_admin();
$$;

-- Check-in from QR scan by field admin or organizer
create table public.event_checkins (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  operator_user_id uuid not null references public.operator_profiles (user_id) on delete cascade,
  checkin_source text not null default 'qr_scan',
  checked_in_by uuid not null references auth.users (id) on delete restrict,
  checked_in_at timestamptz not null default now(),
  unique (event_id, operator_user_id)
);

-- Arsenal and chrono validations
create table public.arsenal_replicas (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null references public.operator_profiles (user_id) on delete cascade,
  brand text not null,
  model text not null,
  serial_or_tag text,
  created_at timestamptz not null default now()
);

create table public.chrono_validations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  replica_id uuid not null references public.arsenal_replicas (id) on delete cascade,
  operator_user_id uuid not null references public.operator_profiles (user_id) on delete cascade,
  fps numeric(6,2) not null check (fps > 0),
  joules numeric(6,3) not null check (joules > 0),
  bb_weight_g numeric(4,3) not null check (bb_weight_g > 0),
  measured_by uuid not null references auth.users (id) on delete restrict,
  measured_at timestamptz not null default now(),
  note text
);

-- Fair play history and reports
create table public.fair_play_reports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  operator_user_id uuid not null references public.operator_profiles (user_id) on delete cascade,
  status public.fair_play_status not null,
  reason text,
  reported_by uuid not null references auth.users (id) on delete restrict,
  reported_at timestamptz not null default now()
);

-- Derived immutable metrics table (updated by trigger only)
create table public.operator_global_metrics (
  operator_user_id uuid primary key references public.operator_profiles (user_id) on delete cascade,
  total_events integer not null default 0,
  total_green integer not null default 0,
  total_yellow integer not null default 0,
  total_red integer not null default 0,
  latest_fps numeric(6,2),
  latest_joules numeric(6,3),
  updated_at timestamptz not null default now()
);

-- Update updated_at helper
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_operator_profiles_updated_at
before update on public.operator_profiles
for each row execute function public.tg_set_updated_at();

-- Application-layer encryption helper for RUT
-- Pass a secret key from app/service role; do not expose key to clients.
create or replace function public.encrypt_rut(plain_rut text, secret_key text)
returns bytea
language sql
as $$
  select pgp_sym_encrypt(plain_rut, secret_key)::bytea;
$$;

create or replace function public.decrypt_rut(cipher_rut bytea, secret_key text)
returns text
language sql
as $$
  select pgp_sym_decrypt(cipher_rut::bytea, secret_key);
$$;

-- Metrics refresh logic
create or replace function public.refresh_operator_metrics(target_operator uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_latest_fps numeric(6,2);
  v_latest_joules numeric(6,3);
begin
  select cv.fps, cv.joules
  into v_latest_fps, v_latest_joules
  from public.chrono_validations cv
  where cv.operator_user_id = target_operator
  order by cv.measured_at desc
  limit 1;

  insert into public.operator_global_metrics (
    operator_user_id,
    total_events,
    total_green,
    total_yellow,
    total_red,
    latest_fps,
    latest_joules,
    updated_at
  )
  values (
    target_operator,
    (select count(*) from public.event_checkins ec where ec.operator_user_id = target_operator),
    (select count(*) from public.fair_play_reports f where f.operator_user_id = target_operator and f.status = 'green'),
    (select count(*) from public.fair_play_reports f where f.operator_user_id = target_operator and f.status = 'yellow'),
    (select count(*) from public.fair_play_reports f where f.operator_user_id = target_operator and f.status = 'red'),
    v_latest_fps,
    v_latest_joules,
    now()
  )
  on conflict (operator_user_id) do update
  set
    total_events = excluded.total_events,
    total_green = excluded.total_green,
    total_yellow = excluded.total_yellow,
    total_red = excluded.total_red,
    latest_fps = excluded.latest_fps,
    latest_joules = excluded.latest_joules,
    updated_at = now();
end;
$$;

create or replace function public.tg_refresh_metrics_from_checkins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_operator_metrics(coalesce(new.operator_user_id, old.operator_user_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.tg_refresh_metrics_from_fair_play()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_operator_metrics(coalesce(new.operator_user_id, old.operator_user_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.tg_refresh_metrics_from_chrono()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_operator_metrics(coalesce(new.operator_user_id, old.operator_user_id));
  return coalesce(new, old);
end;
$$;

create trigger trg_checkins_refresh_metrics
after insert or delete on public.event_checkins
for each row execute function public.tg_refresh_metrics_from_checkins();

create trigger trg_fair_play_refresh_metrics
after insert or update or delete on public.fair_play_reports
for each row execute function public.tg_refresh_metrics_from_fair_play();

create trigger trg_chrono_refresh_metrics
after insert or update or delete on public.chrono_validations
for each row execute function public.tg_refresh_metrics_from_chrono();

-- RLS
alter table public.user_roles enable row level security;
alter table public.operator_profiles enable row level security;
alter table public.fields enable row level security;
alter table public.field_admins enable row level security;
alter table public.events enable row level security;
alter table public.event_organizers enable row level security;
alter table public.event_checkins enable row level security;
alter table public.arsenal_replicas enable row level security;
alter table public.chrono_validations enable row level security;
alter table public.fair_play_reports enable row level security;
alter table public.operator_global_metrics enable row level security;

-- operator_profiles: owner can read/update own (except sensitive rules handled in app); admins can read all.
create policy operator_profiles_select
on public.operator_profiles
for select
using (auth.uid() = user_id or public.is_super_admin());

create policy operator_profiles_update_own
on public.operator_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy operator_profiles_insert_own
on public.operator_profiles
for insert
with check (auth.uid() = user_id);

-- field_admins / events / organizers
create policy fields_read_all
on public.fields
for select
using (true);

create policy events_read_all
on public.events
for select
using (true);

create policy event_organizers_read_own
on public.event_organizers
for select
using (user_id = auth.uid() or public.is_super_admin());

-- checkins: only organizer for the event or field admin can insert.
create policy checkins_read_own_or_admin
on public.event_checkins
for select
using (
  operator_user_id = auth.uid()
  or public.is_super_admin()
  or public.is_organizer_for_event(event_id)
);

create policy checkins_insert_by_organizer_or_field_admin
on public.event_checkins
for insert
with check (
  public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
);

-- arsenal: owner manages own replicas; organizers/admins read.
create policy arsenal_read
on public.arsenal_replicas
for select
using (
  operator_user_id = auth.uid()
  or public.is_super_admin()
);

create policy arsenal_write_own
on public.arsenal_replicas
for all
using (operator_user_id = auth.uid())
with check (operator_user_id = auth.uid());

-- chrono: insert only organizer or field admin; player read-only own.
create policy chrono_read
on public.chrono_validations
for select
using (
  operator_user_id = auth.uid()
  or public.is_super_admin()
  or public.is_organizer_for_event(event_id)
);

create policy chrono_insert_organizer_or_field_admin
on public.chrono_validations
for insert
with check (
  public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
);

-- fair play: only organizer/admin write; player can only read own.
create policy fair_play_read
on public.fair_play_reports
for select
using (
  operator_user_id = auth.uid()
  or public.is_super_admin()
  or public.is_organizer_for_event(event_id)
);

create policy fair_play_insert_organizer_or_field_admin
on public.fair_play_reports
for insert
with check (
  public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
);

create policy fair_play_update_admin_only
on public.fair_play_reports
for update
using (public.is_super_admin())
with check (public.is_super_admin());

-- metrics: read own + admins, no direct writes.
create policy metrics_read
on public.operator_global_metrics
for select
using (operator_user_id = auth.uid() or public.is_super_admin());

-- indexes
create index idx_operator_profiles_qr on public.operator_profiles (unique_qr_token);
create index idx_checkins_event_operator on public.event_checkins (event_id, operator_user_id);
create index idx_chrono_operator_measured_at on public.chrono_validations (operator_user_id, measured_at desc);
create index idx_fair_play_operator_reported_at on public.fair_play_reports (operator_user_id, reported_at desc);
