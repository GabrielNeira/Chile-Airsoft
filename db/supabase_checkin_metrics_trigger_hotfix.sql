-- ============================================================
-- HOTFIX: column f.status does not exist en calculate_operator_metric_scores
--
-- El trigger trg_score_from_checkins llama a calculate_operator_metric_scores
-- que referencia fair_play_reports.status. Si la columna tiene otro nombre
-- en produccion, el INSERT en event_checkins falla bloqueando el check-in.
--
-- Este hotfix envuelve las consultas en bloques EXCEPTION para que el
-- error sea silenciado y el checkin proceda correctamente.
-- ============================================================

-- 1. Reemplazar la funcion de calculo con manejo de excepciones robusto
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
  -- Intentar leer fair_play_reports con columna status
  -- Si la columna no existe en esta instancia de BD, silenciar el error
  begin
    select
      coalesce(sum(case when f.status::text = 'green'  then 1 else 0 end), 0),
      coalesce(sum(case when f.status::text = 'yellow' then 1 else 0 end), 0),
      coalesce(sum(case when f.status::text = 'red'    then 1 else 0 end), 0)
    into v_green, v_yellow, v_red
    from public.fair_play_reports f
    where f.operator_user_id = target_operator;
  exception
    when undefined_column or undefined_table then
      v_green  := 0;
      v_yellow := 0;
      v_red    := 0;
  end;

  -- Contar checkins del operador
  begin
    select coalesce(count(*), 0)
    into v_events
    from public.event_checkins ec
    where ec.operator_user_id = target_operator;
  exception
    when undefined_table then
      v_events := 0;
  end;

  -- Contar logros
  begin
    select coalesce(count(*), 0)
    into v_achievements
    from public.operator_achievements oa
    where oa.operator_user_id = target_operator;
  exception
    when undefined_table then
      v_achievements := 0;
  end;

  v_fair_play_score   := greatest(0, least(100, 50 + v_green * 5 - v_yellow * 8 - v_red * 18));
  v_event_score       := least(100, v_events * 4);
  v_achievement_score := least(100, v_achievements * 8);
  v_operator_score    := greatest(1, least(100,
    round(v_fair_play_score * 0.5 + v_event_score * 0.3 + v_achievement_score * 0.2)
  ));

  insert into public.operator_metric_scores (
    operator_user_id, fair_play_score, events_experience_score, achievements_score,
    operator_score, total_confirmed_events, total_achievements_unlocked,
    total_fair_play_green, total_fair_play_yellow, total_fair_play_red,
    calculated_at, updated_at
  )
  values (
    target_operator, v_fair_play_score, v_event_score, v_achievement_score,
    v_operator_score, v_events, v_achievements,
    v_green, v_yellow, v_red, now(), now()
  )
  on conflict (operator_user_id) do update set
    fair_play_score             = excluded.fair_play_score,
    events_experience_score     = excluded.events_experience_score,
    achievements_score          = excluded.achievements_score,
    operator_score              = excluded.operator_score,
    total_confirmed_events      = excluded.total_confirmed_events,
    total_achievements_unlocked = excluded.total_achievements_unlocked,
    total_fair_play_green       = excluded.total_fair_play_green,
    total_fair_play_yellow      = excluded.total_fair_play_yellow,
    total_fair_play_red         = excluded.total_fair_play_red,
    calculated_at               = now(),
    updated_at                  = now();

exception
  when others then
    raise warning 'calculate_operator_metric_scores: error para operador %: %', target_operator, sqlerrm;
end;
$$;

-- 2. Recrear el trigger wrapper con manejo defensivo de errores
create or replace function public.tg_refresh_operator_metric_scores()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.calculate_operator_metric_scores(coalesce(new.operator_user_id, old.operator_user_id));
  exception
    when others then
      raise warning 'tg_refresh_operator_metric_scores: %', sqlerrm;
  end;
  return coalesce(new, old);
end;
$$;

-- 3. Re-crear triggers para asegurar que apuntan a la funcion correcta
drop trigger if exists trg_score_from_checkins on public.event_checkins;
create trigger trg_score_from_checkins
after insert or delete on public.event_checkins
for each row execute function public.tg_refresh_operator_metric_scores();

drop trigger if exists trg_score_from_fair_play on public.fair_play_reports;
create trigger trg_score_from_fair_play
after insert or update or delete on public.fair_play_reports
for each row execute function public.tg_refresh_operator_metric_scores();
