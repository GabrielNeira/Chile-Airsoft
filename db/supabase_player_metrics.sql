-- ChileAirsoft / Player level metrics system
-- Captures trusted metrics from fields and self-reports from players.
-- Run after db/supabase_schema.sql and db/supabase_progression.sql

create type public.metric_event_type as enum (
  'attendance_validated',
  'chrono_validated',
  'objective_completed',
  'mission_completed',
  'fair_play_green',
  'fair_play_yellow',
  'fair_play_red',
  'training_self_report',
  'training_verified'
);

create type public.metric_capture_channel as enum (
  'field_admin',
  'organizer',
  'player'
);

create type public.metric_verification_state as enum (
  'pending',
  'verified',
  'rejected'
);

create table public.player_metric_events (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null references public.operator_profiles (user_id) on delete cascade,
  event_id uuid references public.events (id) on delete set null,
  event_type public.metric_event_type not null,
  capture_channel public.metric_capture_channel not null,
  source_ref_id uuid,
  value_numeric numeric(10,2) not null default 1,
  weight integer not null default 0,
  verification_state public.metric_verification_state not null default 'pending',
  captured_by uuid not null references auth.users (id) on delete restrict,
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  note text,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (value_numeric >= 0)
);

create table public.player_level_snapshots (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null references public.operator_profiles (user_id) on delete cascade,
  xp_total integer not null,
  level integer not null,
  rank_title text not null,
  trusted_score integer not null,
  created_at timestamptz not null default now()
);

create index idx_metric_events_operator_date
  on public.player_metric_events (operator_user_id, captured_at desc);

create index idx_metric_events_verification
  on public.player_metric_events (verification_state, event_type);

create index idx_level_snapshots_operator
  on public.player_level_snapshots (operator_user_id, created_at desc);

create or replace function public.metric_default_weight(metric_type public.metric_event_type)
returns integer
language sql
immutable
as $$
  select case metric_type
    when 'attendance_validated' then 25
    when 'chrono_validated' then 20
    when 'objective_completed' then 15
    when 'mission_completed' then 18
    when 'fair_play_green' then 12
    when 'fair_play_yellow' then -20
    when 'fair_play_red' then -60
    when 'training_self_report' then 3
    when 'training_verified' then 8
    else 0
  end;
$$;

create or replace function public.compute_operator_level(target_operator uuid)
returns table (
  trusted_score integer,
  xp_total integer,
  level integer,
  rank_title text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score integer;
  v_xp integer;
  v_level integer;
  v_rank text;
begin
  select coalesce(sum(pme.weight), 0)::integer
  into v_score
  from public.player_metric_events pme
  where pme.operator_user_id = target_operator
    and pme.verification_state = 'verified';

  -- Convert trusted score to XP with controlled slope.
  v_xp := greatest(0, v_score * 10);

  -- Level curve: soft early progression, harder later.
  v_level := least(50, floor(sqrt(v_xp::numeric / 120))::integer + 1);

  v_rank := case
    when v_level >= 40 then 'Tier 1 Operator'
    when v_level >= 30 then 'Veteran'
    when v_level >= 20 then 'Advanced'
    when v_level >= 10 then 'Field Ready'
    else 'Recruit'
  end;

  return query select v_score, v_xp, v_level, v_rank;
end;
$$;

create or replace function public.refresh_operator_level_from_metrics(target_operator uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result record;
begin
  select * into v_result from public.compute_operator_level(target_operator);

  insert into public.operator_progression (
    operator_user_id,
    xp_total,
    level,
    rank_title,
    soft_tokens,
    premium_tokens,
    updated_at
  )
  values (
    target_operator,
    v_result.xp_total,
    v_result.level,
    v_result.rank_title,
    0,
    0,
    now()
  )
  on conflict (operator_user_id) do update
  set
    xp_total = v_result.xp_total,
    level = v_result.level,
    rank_title = v_result.rank_title,
    updated_at = now();

  insert into public.player_level_snapshots (
    operator_user_id,
    xp_total,
    level,
    rank_title,
    trusted_score,
    created_at
  )
  values (
    target_operator,
    v_result.xp_total,
    v_result.level,
    v_result.rank_title,
    v_result.trusted_score,
    now()
  );
end;
$$;

create or replace function public.tg_refresh_level_metrics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_operator_level_from_metrics(coalesce(new.operator_user_id, old.operator_user_id));
  return coalesce(new, old);
end;
$$;

create trigger trg_metric_events_refresh_level
after insert or update or delete on public.player_metric_events
for each row execute function public.tg_refresh_level_metrics();

-- Capture trusted metric events from existing operational tables.
create or replace function public.tg_capture_checkin_metric()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.player_metric_events (
    operator_user_id,
    event_id,
    event_type,
    capture_channel,
    source_ref_id,
    value_numeric,
    weight,
    verification_state,
    captured_by,
    verified_by,
    verified_at,
    note
  )
  values (
    new.operator_user_id,
    new.event_id,
    'attendance_validated',
    'field_admin',
    new.id,
    1,
    public.metric_default_weight('attendance_validated'),
    'verified',
    new.checked_in_by,
    new.checked_in_by,
    now(),
    'Auto-captured from event check-in'
  );

  return new;
end;
$$;

create trigger trg_capture_checkin_metric
after insert on public.event_checkins
for each row execute function public.tg_capture_checkin_metric();

create or replace function public.tg_capture_chrono_metric()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.player_metric_events (
    operator_user_id,
    event_id,
    event_type,
    capture_channel,
    source_ref_id,
    value_numeric,
    weight,
    verification_state,
    captured_by,
    verified_by,
    verified_at,
    note
  )
  values (
    new.operator_user_id,
    new.event_id,
    'chrono_validated',
    'organizer',
    new.id,
    new.fps,
    public.metric_default_weight('chrono_validated'),
    'verified',
    new.measured_by,
    new.measured_by,
    now(),
    'Auto-captured from chrono validation'
  );

  return new;
end;
$$;

create trigger trg_capture_chrono_metric
after insert on public.chrono_validations
for each row execute function public.tg_capture_chrono_metric();

create or replace function public.tg_capture_fair_play_metric()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metric_type public.metric_event_type;
begin
  v_metric_type := case new.status
    when 'green' then 'fair_play_green'::public.metric_event_type
    when 'yellow' then 'fair_play_yellow'::public.metric_event_type
    else 'fair_play_red'::public.metric_event_type
  end;

  insert into public.player_metric_events (
    operator_user_id,
    event_id,
    event_type,
    capture_channel,
    source_ref_id,
    value_numeric,
    weight,
    verification_state,
    captured_by,
    verified_by,
    verified_at,
    note
  )
  values (
    new.operator_user_id,
    new.event_id,
    v_metric_type,
    'organizer',
    new.id,
    1,
    public.metric_default_weight(v_metric_type),
    'verified',
    new.reported_by,
    new.reported_by,
    now(),
    'Auto-captured from fair play report'
  );

  return new;
end;
$$;

create trigger trg_capture_fair_play_metric
after insert on public.fair_play_reports
for each row execute function public.tg_capture_fair_play_metric();

create or replace function public.player_report_training_session(minutes_trained integer, notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_event uuid := gen_random_uuid();
begin
  if v_user is null then
    raise exception 'Unauthorized';
  end if;

  if minutes_trained < 10 then
    raise exception 'Training session must be at least 10 minutes';
  end if;

  insert into public.player_metric_events (
    id,
    operator_user_id,
    event_type,
    capture_channel,
    value_numeric,
    weight,
    verification_state,
    captured_by,
    note
  )
  values (
    v_event,
    v_user,
    'training_self_report',
    'player',
    minutes_trained,
    public.metric_default_weight('training_self_report'),
    'pending',
    v_user,
    notes
  );

  return v_event;
end;
$$;

create or replace function public.verify_player_metric_event(metric_event_id uuid, approve boolean, verifier_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verifier uuid := auth.uid();
  v_target public.player_metric_events%rowtype;
begin
  if v_verifier is null then
    raise exception 'Unauthorized';
  end if;

  if not public.is_super_admin() then
    raise exception 'Only admins can verify player-submitted metrics';
  end if;

  select * into v_target from public.player_metric_events where id = metric_event_id;
  if v_target.id is null then
    raise exception 'Metric event not found';
  end if;

  update public.player_metric_events
  set
    verification_state = case when approve then 'verified' else 'rejected' end,
    verified_by = v_verifier,
    verified_at = now(),
    note = coalesce(v_target.note, '') || case when verifier_note is not null then ' | ' || verifier_note else '' end
  where id = metric_event_id;

  if approve then
    insert into public.player_metric_events (
      operator_user_id,
      event_type,
      capture_channel,
      source_ref_id,
      value_numeric,
      weight,
      verification_state,
      captured_by,
      verified_by,
      verified_at,
      note
    )
    values (
      v_target.operator_user_id,
      'training_verified',
      'field_admin',
      v_target.id,
      v_target.value_numeric,
      public.metric_default_weight('training_verified'),
      'verified',
      v_target.captured_by,
      v_verifier,
      now(),
      'Verified training bonus'
    );
  end if;
end;
$$;

alter table public.player_metric_events enable row level security;
alter table public.player_level_snapshots enable row level security;

create policy player_metric_events_read_own
on public.player_metric_events
for select
using (operator_user_id = auth.uid() or public.is_super_admin());

create policy player_metric_events_insert_player
on public.player_metric_events
for insert
with check (
  operator_user_id = auth.uid()
  and capture_channel = 'player'
  and verification_state = 'pending'
  and event_type = 'training_self_report'
);

create policy player_metric_events_insert_admin
on public.player_metric_events
for insert
with check (public.is_super_admin());

create policy player_metric_events_update_admin
on public.player_metric_events
for update
using (public.is_super_admin())
with check (public.is_super_admin());

create policy player_level_snapshots_read_own
on public.player_level_snapshots
for select
using (operator_user_id = auth.uid() or public.is_super_admin());
