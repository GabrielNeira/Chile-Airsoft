-- ============================================================
-- HOTFIX DEFINITIVO: Eliminar referencias a f.status
--
-- Como la columna 'status' en 'fair_play_reports' fue eliminada o renombrada,
-- PostgreSQL arroja un error de compilación de plan (column does not exist)
-- al intentar registrar un check-in.
-- 
-- Este script reemplaza la función de cálculo de métricas para que
-- ignore completamente los fair_play_reports (ya que no se usarán
-- en esta etapa) y asigne valores por defecto (0 reportes, score 50).
-- ============================================================

create or replace function public.calculate_operator_metric_scores(target_operator uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_events integer := 0;
  v_achievements integer := 0;
  v_fair_play_score integer := 50;
  v_event_score integer := 0;
  v_achievement_score integer := 0;
  v_operator_score integer := 1;
begin
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

  v_fair_play_score   := 50; -- Por defecto, ya que Fair Play no se usa en esta etapa
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
    0, 0, 0, now(), now()
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

end;
$$;
