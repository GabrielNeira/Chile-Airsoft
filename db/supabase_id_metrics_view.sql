-- Supabase ID metrics projection (fully columnar, no JSON payloads)
-- Run after db/supabase_schema.sql, db/supabase_progression.sql and db/supabase_player_metrics.sql

create table if not exists public.operator_metric_scores (
  operator_user_id uuid primary key references public.operator_profiles (user_id) on delete cascade,
  fair_play_score integer not null default 50 check (fair_play_score between 0 and 100),
  events_experience_score integer not null default 0 check (events_experience_score between 0 and 100),
  achievements_score integer not null default 0 check (achievements_score between 0 and 100),
  operator_score integer not null default 1 check (operator_score between 1 and 100),
  total_confirmed_events integer not null default 0,
  total_achievements_unlocked integer not null default 0,
  total_fair_play_green integer not null default 0,
  total_fair_play_yellow integer not null default 0,
  total_fair_play_red integer not null default 0,
  calculated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  v_fair_play_score integer := 50;
  v_event_score integer := 0;
  v_achievement_score integer := 0;
  v_operator_score integer := 1;
begin
  select
    coalesce(sum(case when f.status = 'green' then 1 else 0 end), 0),
    coalesce(sum(case when f.status = 'yellow' then 1 else 0 end), 0),
    coalesce(sum(case when f.status = 'red' then 1 else 0 end), 0)
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

  -- FairPlay score (starts at 50, rewards green, penalizes yellow/red)
  v_fair_play_score := greatest(0, least(100, 50 + v_green * 5 - v_yellow * 8 - v_red * 18));

  -- Experience by confirmed events
  v_event_score := least(100, v_events * 4);

  -- Achievement contribution
  v_achievement_score := least(100, v_achievements * 8);

  -- Weighted Operator score 1..100
  v_operator_score := greatest(1, least(100, round(v_fair_play_score * 0.5 + v_event_score * 0.3 + v_achievement_score * 0.2)));

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
    calculated_at = now(),
    updated_at = now();
end;
$$;

create or replace function public.tg_refresh_operator_metric_scores()
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

-- Triggers: recompute score when fairplay/checkins/achievements change.
drop trigger if exists trg_score_from_fair_play on public.fair_play_reports;
create trigger trg_score_from_fair_play
after insert or update or delete on public.fair_play_reports
for each row execute function public.tg_refresh_operator_metric_scores();

drop trigger if exists trg_score_from_checkins on public.event_checkins;
create trigger trg_score_from_checkins
after insert or delete on public.event_checkins
for each row execute function public.tg_refresh_operator_metric_scores();

drop trigger if exists trg_score_from_achievements on public.operator_achievements;
create trigger trg_score_from_achievements
after insert or delete on public.operator_achievements
for each row execute function public.tg_refresh_operator_metric_scores();

alter table public.operator_metric_scores enable row level security;

drop policy if exists metric_scores_read_own on public.operator_metric_scores;
create policy metric_scores_read_own
on public.operator_metric_scores
for select
using (operator_user_id = auth.uid() or public.is_super_admin());

drop policy if exists metric_scores_write_admin on public.operator_metric_scores;
create policy metric_scores_write_admin
on public.operator_metric_scores
for all
using (public.is_super_admin())
with check (public.is_super_admin());

create or replace view public.v_operator_id_metrics as
select
  op.user_id as operator_user_id,
  op.credential_code,
  op.nickname,
  op.real_name,
  op.operator_role,
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
  oms.updated_at as metrics_updated_at
from public.operator_profiles op
left join public.operator_metric_scores oms
  on oms.operator_user_id = op.user_id;

grant select on public.v_operator_id_metrics to authenticated;
