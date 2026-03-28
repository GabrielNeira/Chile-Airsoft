-- ChileAirsoft / Operaciones de cancha + metricas de partidas y tiempo
-- Ejecutar despues de:
--   db/supabase_schema.sql
--   db/supabase_progression.sql
--   db/supabase_player_metrics.sql
--   db/supabase_id_metrics_view.sql

do $$
begin
  if not exists (select 1 from pg_type where typname = 'team_slot') then
    create type public.team_slot as enum ('alpha', 'bravo', 'reserve');
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'match_status') then
    create type public.match_status as enum ('planned', 'running', 'finished');
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'fair_play_status') then
    create type public.fair_play_status as enum ('green', 'yellow', 'red');
  end if;
end;
$$;

create table if not exists public.event_team_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  operator_user_id uuid not null references public.operator_profiles (user_id) on delete cascade,
  team_slot public.team_slot not null default 'reserve',
  day_role text,
  assignment_note text,
  is_active boolean not null default true,
  assigned_by uuid not null references auth.users (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  unique (event_id, operator_user_id)
);

alter table public.event_team_assignments
  add column if not exists day_role text,
  add column if not exists assignment_note text,
  add column if not exists is_active boolean not null default true;

-- Seed para entorno de pruebas: al menos 1 cancha disponible.
insert into public.fields (name, city, is_active)
select 'Cancha Demo ChileAirsoft', 'Santiago', true
where not exists (
  select 1
  from public.fields f
  where lower(f.name) = lower('Cancha Demo ChileAirsoft')
);

create or replace function public.is_platform_organizer()
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
           and ur.role::text in (''organizer'', ''super_admin'')
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
           and ur.user_role::text in (''organizer'', ''super_admin'')
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

create table if not exists public.event_matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  title text not null,
  status public.match_status not null default 'planned',
  starts_at timestamptz,
  ends_at timestamptz,
  paused_at timestamptz,
  total_paused_seconds integer not null default 0,
  duration_seconds integer,
  winner_team public.team_slot,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  check (total_paused_seconds >= 0),
  check (duration_seconds is null or duration_seconds >= 0),
  check (winner_team is null or winner_team in ('alpha', 'bravo'))
);

alter table public.event_matches
  add column if not exists paused_at timestamptz,
  add column if not exists total_paused_seconds integer not null default 0;

create table if not exists public.event_match_participants (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.event_matches (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  operator_user_id uuid not null references public.operator_profiles (user_id) on delete cascade,
  team_slot public.team_slot not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  play_seconds integer,
  unique (match_id, operator_user_id),
  check (play_seconds is null or play_seconds >= 0)
);

create table if not exists public.conduct_cards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  match_id uuid references public.event_matches (id) on delete set null,
  operator_user_id uuid not null references public.operator_profiles (user_id) on delete cascade,
  card_type public.fair_play_status not null,
  detail text not null,
  issued_by uuid not null references auth.users (id) on delete restrict,
  issued_at timestamptz not null default now()
);

alter table public.event_team_assignments enable row level security;
alter table public.event_matches enable row level security;
alter table public.event_match_participants enable row level security;
alter table public.conduct_cards enable row level security;

-- Eventos: habilitar creacion y edicion por admins de cancha/organizers/super admins.
drop policy if exists events_insert_field_admin on public.events;
create policy events_insert_field_admin
on public.events
for insert
with check (
  created_by = auth.uid()
  and (
    public.is_super_admin()
    or public.is_platform_organizer()
    or public.is_field_admin(field_id)
  )
);

drop policy if exists events_update_by_organizer_or_field_admin on public.events;
create policy events_update_by_organizer_or_field_admin
on public.events
for update
using (
  public.is_super_admin()
  or public.is_organizer_for_event(id)
  or public.is_field_admin(field_id)
)
with check (
  public.is_super_admin()
  or public.is_organizer_for_event(id)
  or public.is_field_admin(field_id)
);

-- Organizadores del evento.
drop policy if exists event_organizers_insert_self_or_admin on public.event_organizers;
create policy event_organizers_insert_self_or_admin
on public.event_organizers
for insert
with check (
  public.is_super_admin()
  or user_id = auth.uid()
  or public.is_organizer_for_event(event_id)
);

drop policy if exists event_organizers_delete_admin on public.event_organizers;
create policy event_organizers_delete_admin
on public.event_organizers
for delete
using (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
);

-- Asignaciones de equipos.
drop policy if exists event_team_assignments_read on public.event_team_assignments;
create policy event_team_assignments_read
on public.event_team_assignments
for select
using (
  operator_user_id = auth.uid()
  or public.is_super_admin()
  or public.is_organizer_for_event(event_id)
);

drop policy if exists event_team_assignments_write on public.event_team_assignments;
create policy event_team_assignments_write
on public.event_team_assignments
for all
using (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
)
with check (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
);

-- Partidas.
drop policy if exists event_matches_read on public.event_matches;
create policy event_matches_read
on public.event_matches
for select
using (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
  or exists (
    select 1
    from public.event_checkins ec
    where ec.event_id = event_id
      and ec.operator_user_id = auth.uid()
  )
);

drop policy if exists event_matches_write on public.event_matches;
create policy event_matches_write
on public.event_matches
for all
using (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
)
with check (
  created_by = auth.uid()
  and (
    public.is_super_admin()
    or public.is_organizer_for_event(event_id)
    or exists (
      select 1
      from public.events e
      where e.id = event_id
        and public.is_field_admin(e.field_id)
    )
  )
);

-- Participantes de partidas.
drop policy if exists event_match_participants_read on public.event_match_participants;
create policy event_match_participants_read
on public.event_match_participants
for select
using (
  operator_user_id = auth.uid()
  or public.is_super_admin()
  or public.is_organizer_for_event(event_id)
);

drop policy if exists event_match_participants_write on public.event_match_participants;
create policy event_match_participants_write
on public.event_match_participants
for all
using (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
)
with check (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
);

-- Tarjetas de conducta.
drop policy if exists conduct_cards_read on public.conduct_cards;
create policy conduct_cards_read
on public.conduct_cards
for select
using (
  operator_user_id = auth.uid()
  or public.is_super_admin()
  or public.is_organizer_for_event(event_id)
);

drop policy if exists conduct_cards_write on public.conduct_cards;
create policy conduct_cards_write
on public.conduct_cards
for all
using (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
)
with check (
  issued_by = auth.uid()
  and (
    public.is_super_admin()
    or public.is_organizer_for_event(event_id)
    or exists (
      select 1
      from public.events e
      where e.id = event_id
        and public.is_field_admin(e.field_id)
    )
  )
);

create or replace function public.tg_event_add_creator_organizer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.event_organizers (event_id, user_id)
  values (new.id, new.created_by)
  on conflict (event_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_event_add_creator_organizer on public.events;
create trigger trg_event_add_creator_organizer
after insert on public.events
for each row execute function public.tg_event_add_creator_organizer();

create or replace function public.tg_sync_conduct_card_to_fair_play()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fair_play_reports (
    event_id,
    operator_user_id,
    status,
    reason,
    reported_by,
    reported_at
  )
  values (
    new.event_id,
    new.operator_user_id,
    new.card_type,
    new.detail,
    new.issued_by,
    new.issued_at
  );

  return new;
end;
$$;

drop trigger if exists trg_sync_conduct_card_to_fair_play on public.conduct_cards;
create trigger trg_sync_conduct_card_to_fair_play
after insert on public.conduct_cards
for each row execute function public.tg_sync_conduct_card_to_fair_play();

alter type public.metric_event_type add value if not exists 'match_participated';
alter type public.metric_event_type add value if not exists 'match_won';
alter type public.metric_event_type add value if not exists 'match_lost';
alter type public.metric_event_type add value if not exists 'field_time_minutes';

create or replace function public.metric_default_weight(metric_type public.metric_event_type)
returns integer
language sql
immutable
as $$
  select case metric_type::text
    when 'attendance_validated' then 25
    when 'chrono_validated' then 20
    when 'objective_completed' then 15
    when 'mission_completed' then 18
    when 'fair_play_green' then 12
    when 'fair_play_yellow' then -20
    when 'fair_play_red' then -60
    when 'training_self_report' then 3
    when 'training_verified' then 8
    when 'match_participated' then 10
    when 'match_won' then 14
    when 'match_lost' then -6
    when 'field_time_minutes' then 1
    else 0
  end;
$$;

create unique index if not exists idx_player_metric_events_source_type
on public.player_metric_events (event_type, source_ref_id)
where source_ref_id is not null;

create or replace function public.tg_capture_match_metrics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_play_seconds integer;
  v_time_weight integer;
  v_metric_participated text := 'match_participated';
  v_metric_won text := 'match_won';
  v_metric_lost text := 'match_lost';
  v_metric_field_time text := 'field_time_minutes';
  v_metric_result text;
begin
  if new.status = 'finished' and coalesce(old.status, 'planned') <> 'finished' then
    update public.event_match_participants p
    set
      left_at = coalesce(p.left_at, new.ends_at, now()),
      play_seconds = coalesce(
        p.play_seconds,
        greatest(
          0,
          extract(
            epoch from coalesce(p.left_at, new.ends_at, now()) - p.joined_at
          )::integer
        )
      )
    where p.match_id = new.id;

    for rec in
      select p.id, p.operator_user_id, p.team_slot, p.play_seconds
      from public.event_match_participants p
      where p.match_id = new.id
    loop
      v_play_seconds := coalesce(rec.play_seconds, 0);
      v_time_weight := greatest(0, floor(v_play_seconds / 300.0)::integer);

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
        rec.operator_user_id,
        new.event_id,
        v_metric_participated::public.metric_event_type,
        'organizer'::public.metric_capture_channel,
        rec.id,
        1,
        public.metric_default_weight(v_metric_participated::public.metric_event_type),
        'verified'::public.metric_verification_state,
        new.created_by,
        new.created_by,
        now(),
        'Auto-captured from match participant'
      )
      on conflict (event_type, source_ref_id) do nothing;

      v_metric_result := v_metric_participated;
      if new.winner_team is not null and rec.team_slot = new.winner_team then
        v_metric_result := v_metric_won;
      elsif new.winner_team is not null and rec.team_slot in ('alpha', 'bravo') and rec.team_slot <> new.winner_team then
        v_metric_result := v_metric_lost;
      end if;

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
        rec.operator_user_id,
        new.event_id,
        v_metric_result::public.metric_event_type,
        'organizer'::public.metric_capture_channel,
        rec.id,
        1,
        case
          when v_metric_result = v_metric_won then public.metric_default_weight(v_metric_won::public.metric_event_type)
          when v_metric_result = v_metric_lost then public.metric_default_weight(v_metric_lost::public.metric_event_type)
          else 0
        end,
        'verified'::public.metric_verification_state,
        new.created_by,
        new.created_by,
        now(),
        'Auto-captured from match result'
      )
      on conflict (event_type, source_ref_id) do nothing;

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
        rec.operator_user_id,
        new.event_id,
        v_metric_field_time::public.metric_event_type,
        'organizer'::public.metric_capture_channel,
        rec.id,
        round(v_play_seconds::numeric / 60.0, 2),
        v_time_weight,
        'verified'::public.metric_verification_state,
        new.created_by,
        new.created_by,
        now(),
        'Auto-captured from match duration'
      )
      on conflict (event_type, source_ref_id) do nothing;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_capture_match_metrics on public.event_matches;
create trigger trg_capture_match_metrics
after update on public.event_matches
for each row execute function public.tg_capture_match_metrics();

alter table public.operator_metric_scores
  add column if not exists total_matches_participated integer not null default 0,
  add column if not exists total_matches_won integer not null default 0,
  add column if not exists total_matches_lost integer not null default 0,
  add column if not exists total_field_time_seconds bigint not null default 0;

create or replace function public.calculate_operator_metric_scores(target_operator uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_green integer := 0;
  v_yellow integer := 0;
  v_red integer := 0;
  v_events integer := 0;
  v_achievements integer := 0;
  v_matches_participated integer := 0;
  v_matches_won integer := 0;
  v_matches_lost integer := 0;
  v_field_seconds bigint := 0;
  v_fair_play_score integer := 50;
  v_event_score integer := 0;
  v_achievement_score integer := 0;
  v_operator_score integer := 1;
begin
  select
    coalesce(sum(case when coalesce(to_jsonb(f) ->> 'status', to_jsonb(f) ->> 'card_type') = 'green' then 1 else 0 end), 0),
    coalesce(sum(case when coalesce(to_jsonb(f) ->> 'status', to_jsonb(f) ->> 'card_type') = 'yellow' then 1 else 0 end), 0),
    coalesce(sum(case when coalesce(to_jsonb(f) ->> 'status', to_jsonb(f) ->> 'card_type') = 'red' then 1 else 0 end), 0)
  into v_green, v_yellow, v_red
  from public.fair_play_reports f
  where f.operator_user_id = target_operator;

  select coalesce(count(*), 0)
  into v_events
  from public.event_checkins ec
  where ec.operator_user_id = target_operator;

  select coalesce(count(*), 0)
  into v_achievements
  from public.operator_achievements oa
  where oa.operator_user_id = target_operator;

  select
    coalesce(count(*), 0),
    coalesce(sum(case when m.winner_team = p.team_slot and p.team_slot in ('alpha', 'bravo') then 1 else 0 end), 0),
    coalesce(sum(case when m.winner_team is not null and p.team_slot in ('alpha', 'bravo') and m.winner_team <> p.team_slot then 1 else 0 end), 0),
    coalesce(sum(coalesce(p.play_seconds, 0)), 0)
  into v_matches_participated, v_matches_won, v_matches_lost, v_field_seconds
  from public.event_match_participants p
  join public.event_matches m on m.id = p.match_id
  where p.operator_user_id = target_operator
    and m.status = 'finished';

  v_fair_play_score := greatest(0, least(100, 50 + v_green * 5 - v_yellow * 8 - v_red * 18));

  v_event_score := least(
    100,
    v_events * 3
    + v_matches_participated * 2
    + v_matches_won * 4
    + floor(v_field_seconds / 900.0)::integer
  );

  v_achievement_score := least(100, v_achievements * 8);

  v_operator_score := greatest(
    1,
    least(
      100,
      round(v_fair_play_score * 0.45 + v_event_score * 0.35 + v_achievement_score * 0.20)
    )
  );

  insert into public.operator_metric_scores (
    operator_user_id,
    fair_play_score,
    events_experience_score,
    achievements_score,
    operator_score,
    total_confirmed_events,
    total_achievements_unlocked,
    total_fair_play_green,
    total_fair_play_yellow,
    total_fair_play_red,
    total_matches_participated,
    total_matches_won,
    total_matches_lost,
    total_field_time_seconds,
    calculated_at,
    updated_at
  )
  values (
    target_operator,
    v_fair_play_score,
    v_event_score,
    v_achievement_score,
    v_operator_score,
    v_events,
    v_achievements,
    v_green,
    v_yellow,
    v_red,
    v_matches_participated,
    v_matches_won,
    v_matches_lost,
    v_field_seconds,
    now(),
    now()
  )
  on conflict (operator_user_id) do update
  set
    fair_play_score = excluded.fair_play_score,
    events_experience_score = excluded.events_experience_score,
    achievements_score = excluded.achievements_score,
    operator_score = excluded.operator_score,
    total_confirmed_events = excluded.total_confirmed_events,
    total_achievements_unlocked = excluded.total_achievements_unlocked,
    total_fair_play_green = excluded.total_fair_play_green,
    total_fair_play_yellow = excluded.total_fair_play_yellow,
    total_fair_play_red = excluded.total_fair_play_red,
    total_matches_participated = excluded.total_matches_participated,
    total_matches_won = excluded.total_matches_won,
    total_matches_lost = excluded.total_matches_lost,
    total_field_time_seconds = excluded.total_field_time_seconds,
    calculated_at = now(),
    updated_at = now();
end;
$$;

create or replace function public.tg_refresh_operator_metric_scores_from_match_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.calculate_operator_metric_scores(coalesce(new.operator_user_id, old.operator_user_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_score_from_match_participants on public.event_match_participants;
create trigger trg_score_from_match_participants
after insert or update or delete on public.event_match_participants
for each row execute function public.tg_refresh_operator_metric_scores_from_match_participants();

create or replace view public.v_operator_id_metrics as
select
  op.user_id as operator_user_id,
  to_jsonb(op) ->> 'credential_code' as credential_code,
  op.nickname,
  op.real_name,
  coalesce(to_jsonb(op) ->> 'operator_role', to_jsonb(op) ->> 'role') as operator_role,
  op.team,
  op.blood_group,
  oms.operator_score,
  oms.fair_play_score,
  oms.events_experience_score,
  oms.achievements_score,
  oms.total_confirmed_events,
  oms.total_achievements_unlocked,
  oms.total_fair_play_green,
  oms.total_fair_play_yellow,
  oms.total_fair_play_red,
  oms.total_matches_participated,
  oms.total_matches_won,
  oms.total_matches_lost,
  oms.total_field_time_seconds,
  oms.updated_at as metrics_updated_at
from public.operator_profiles op
left join public.operator_metric_scores oms
  on oms.operator_user_id = op.user_id;

grant select on public.v_operator_id_metrics to authenticated;

do $$
declare
  rec record;
begin
  for rec in select user_id from public.operator_profiles loop
    perform public.calculate_operator_metric_scores(rec.user_id);
  end loop;
end;
$$;

create index if not exists idx_event_team_assignments_event_team
  on public.event_team_assignments (event_id, team_slot);

create index if not exists idx_event_matches_event_status
  on public.event_matches (event_id, status, created_at desc);

create index if not exists idx_event_match_participants_operator
  on public.event_match_participants (operator_user_id, match_id);

create index if not exists idx_conduct_cards_operator_issued
  on public.conduct_cards (operator_user_id, issued_at desc);
