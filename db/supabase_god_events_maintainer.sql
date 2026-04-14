-- Admin GOD: mantenedor global de eventos (reporte, cierre y eliminacion permanente)
-- Ejecutar en Supabase SQL Editor.

create or replace function public.god_events_maintainer_report(
  p_creator_email text default null,
  p_creator_user_id uuid default null,
  p_event_title text default null,
  p_created_from date default null,
  p_created_to date default null,
  p_event_date_from date default null,
  p_event_date_to date default null,
  p_limit integer default 300,
  p_offset integer default 0
)
returns table (
  event_id uuid,
  field_id uuid,
  field_name text,
  title text,
  event_date date,
  created_at timestamptz,
  scheduled_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  registration_closed_at timestamptz,
  max_players integer,
  created_by uuid,
  creator_email text,
  is_registration_closed boolean,
  is_event_closed boolean,
  total_rows bigint
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 300), 1000));
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_has_scheduled_at boolean := false;
  v_has_registration_closed_at boolean := false;
  v_has_max_players boolean := false;
  v_scheduled_expr text;
  v_registration_closed_expr text;
  v_max_players_expr text;
  v_registration_closed_bool_expr text;
  v_sql text;
begin
  if not public.can_manage_roles() then
    raise exception using
      errcode = '42501',
      message = 'Solo Admin GOD puede consultar el mantenedor global de eventos.';
  end if;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'events'
      and c.column_name = 'scheduled_at'
  ) into v_has_scheduled_at;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'events'
      and c.column_name = 'registration_closed_at'
  ) into v_has_registration_closed_at;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'events'
      and c.column_name = 'max_players'
  ) into v_has_max_players;

  v_scheduled_expr := case when v_has_scheduled_at then 'e.scheduled_at' else 'null::timestamptz' end;
  v_registration_closed_expr := case when v_has_registration_closed_at then 'e.registration_closed_at' else 'null::timestamptz' end;
  v_max_players_expr := case when v_has_max_players then 'e.max_players' else 'null::integer' end;
  v_registration_closed_bool_expr := case when v_has_registration_closed_at then '(e.registration_closed_at is not null)' else 'false' end;

  v_sql := '
    select
      e.id::uuid as event_id,
      e.field_id::uuid as field_id,
      coalesce(f.name, ''sin-cancha'')::text as field_name,
      e.title::text as title,
      e.event_date::date as event_date,
      e.created_at::timestamptz as created_at,
      (' || v_scheduled_expr || ')::timestamptz as scheduled_at,
      e.starts_at::timestamptz as starts_at,
      e.ends_at::timestamptz as ends_at,
      (' || v_registration_closed_expr || ')::timestamptz as registration_closed_at,
      (' || v_max_players_expr || ')::integer as max_players,
      e.created_by::uuid as created_by,
      coalesce(u.email::text, ''sin-email'')::text as creator_email,
      (' || v_registration_closed_bool_expr || ')::boolean as is_registration_closed,
      (e.ends_at is not null)::boolean as is_event_closed,
      count(*) over()::bigint as total_rows
    from public.events e
    left join public.fields f
      on f.id = e.field_id
    left join auth.users u
      on u.id = e.created_by
    where ($1 is null or lower(coalesce(u.email, '''')) like ''%'' || lower($1) || ''%'')
      and ($2 is null or e.created_by = $2)
      and ($3 is null or lower(coalesce(e.title, '''')) like ''%'' || lower($3) || ''%'')
      and ($4 is null or e.created_at >= $4::date)
      and ($5 is null or e.created_at < ($5::date + interval ''1 day''))
      and ($6 is null or e.event_date >= $6)
      and ($7 is null or e.event_date <= $7)
    order by e.created_at desc, e.event_date desc, e.title asc
    limit $8
    offset $9';

  return query execute v_sql
    using
      nullif(trim(p_creator_email), ''),
      p_creator_user_id,
      nullif(trim(p_event_title), ''),
      p_created_from,
      p_created_to,
      p_event_date_from,
      p_event_date_to,
      v_limit,
      v_offset;
end;
$$;

grant execute on function public.god_events_maintainer_report(text, uuid, text, date, date, date, date, integer, integer) to authenticated;
grant execute on function public.god_events_maintainer_report(text, uuid, text, date, date, date, date, integer, integer) to service_role;

create or replace function public.god_close_event(
  p_event_id uuid,
  p_close_registrations boolean default true,
  p_close_event boolean default true,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_registration_closed_at boolean := false;
  v_set_clauses text[] := array[]::text[];
  v_sql text;
  v_row record;
begin
  if p_event_id is null then
    raise exception using errcode = '22023', message = 'Debes indicar p_event_id.';
  end if;

  if not public.can_manage_roles() then
    raise exception using
      errcode = '42501',
      message = 'Solo Admin GOD puede cerrar eventos globalmente.';
  end if;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'events'
      and c.column_name = 'registration_closed_at'
  ) into v_has_registration_closed_at;

  if p_close_registrations and v_has_registration_closed_at then
    v_set_clauses := array_append(v_set_clauses, 'registration_closed_at = coalesce(registration_closed_at, now())');
  end if;

  if p_close_event then
    v_set_clauses := array_append(v_set_clauses, 'ends_at = coalesce(ends_at, now())');
  end if;

  if coalesce(array_length(v_set_clauses, 1), 0) = 0 then
    select e.id, e.title, e.ends_at
    into v_row
    from public.events e
    where e.id = p_event_id;

    if not found then
      raise exception using errcode = 'P0002', message = 'Evento no encontrado.';
    end if;

    return jsonb_build_object(
      'status', 'unchanged',
      'event_id', v_row.id,
      'title', v_row.title,
      'message', 'No se aplicaron cambios de cierre.'
    );
  end if;

  v_sql := format(
    'update public.events e set %s where e.id = $1 returning e.id, e.title, e.ends_at',
    array_to_string(v_set_clauses, ', ')
  );

  execute v_sql into v_row using p_event_id;

  if v_row.id is null then
    raise exception using errcode = 'P0002', message = 'Evento no encontrado o sin permisos.';
  end if;

  return jsonb_build_object(
    'status', 'closed',
    'event_id', v_row.id,
    'title', v_row.title,
    'ends_at', v_row.ends_at,
    'reason', nullif(trim(p_reason), '')
  );
end;
$$;

grant execute on function public.god_close_event(uuid, boolean, boolean, text) to authenticated;
grant execute on function public.god_close_event(uuid, boolean, boolean, text) to service_role;

create or replace function public.god_delete_event_permanent(
  p_event_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
begin
  if p_event_id is null then
    raise exception using errcode = '22023', message = 'Debes indicar p_event_id.';
  end if;

  if not public.can_manage_roles() then
    raise exception using
      errcode = '42501',
      message = 'Solo Admin GOD puede eliminar eventos globalmente.';
  end if;

  delete from public.events e
  where e.id = p_event_id
  returning e.id, e.title, e.created_by
  into v_event;

  if v_event.id is null then
    raise exception using errcode = 'P0002', message = 'Evento no encontrado o sin permisos para eliminar.';
  end if;

  return jsonb_build_object(
    'status', 'deleted',
    'event_id', v_event.id,
    'title', v_event.title,
    'created_by', v_event.created_by,
    'reason', nullif(trim(p_reason), '')
  );
end;
$$;

grant execute on function public.god_delete_event_permanent(uuid, text) to authenticated;
grant execute on function public.god_delete_event_permanent(uuid, text) to service_role;
