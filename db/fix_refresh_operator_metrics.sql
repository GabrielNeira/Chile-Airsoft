-- ============================================================
-- HOTFIX DEFINITIVO (Parte 2): Eliminar f.status de refresh_operator_metrics
--
-- Existen DOS triggers que se ejecutan al hacer check-in. El script anterior
-- arregló 'calculate_operator_metric_scores', pero este arregla 
-- 'refresh_operator_metrics', que también intentaba leer f.status.
-- ============================================================

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
    0, -- Se elimina busqueda de f.status = 'green'
    0, -- Se elimina busqueda de f.status = 'yellow'
    0, -- Se elimina busqueda de f.status = 'red'
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
