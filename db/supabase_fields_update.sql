-- Agregar nuevas columnas a la tabla fields
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS admin_email text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS google_maps_url text;

-- Asegurarnos de que las políticas RLS sean correctas
ALTER TABLE public.fields ENABLE ROW LEVEL SECURITY;

-- Lectura pública para que todos puedan ver las canchas en la cartelera
DROP POLICY IF EXISTS fields_read ON public.fields;
CREATE POLICY fields_read ON public.fields FOR SELECT USING (true);

-- Escritura estricta solo para superadmin (Insertar, Actualizar, Borrar)
DROP POLICY IF EXISTS fields_insert ON public.fields;
CREATE POLICY fields_insert ON public.fields FOR INSERT WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS fields_update ON public.fields;
CREATE POLICY fields_update ON public.fields FOR UPDATE USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS fields_delete ON public.fields;
CREATE POLICY fields_delete ON public.fields FOR DELETE USING (public.is_super_admin());

-- 3. Actualizar la función RPC para incluir address y google_maps_url
DROP FUNCTION IF EXISTS public.operator_active_events_catalog(text, integer);

create or replace function public.operator_active_events_catalog(
  p_search text default null,
  p_limit integer default 100
)
returns table (
  event_id uuid,
  title text,
  field_id uuid,
  field_name text,
  field_address text,
  google_maps_url text,
  event_date date,
  max_players integer,
  registered_count integer,
  slots_available integer,
  is_full boolean,
  my_registration_status text,
  my_payment_order_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 300));
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_has_max_players boolean := false;
  v_has_registration_closed_at boolean := false;
  v_max_players_expr text;
  v_registration_locked_expr text;
  v_sql text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Sesion no valida para consultar eventos activos.';
  end if;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'events'
      and c.column_name = 'max_players'
  ) into v_has_max_players;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'events'
      and c.column_name = 'registration_closed_at'
  ) into v_has_registration_closed_at;

  v_max_players_expr := case when v_has_max_players then 'e.max_players' else 'null::integer' end;
  v_registration_locked_expr := case when v_has_registration_closed_at then '(e.registration_closed_at is not null)' else 'false' end;

  v_sql := '
    with base_events as (
      select
        e.id as event_id,
        e.title::text as title,
        e.field_id::uuid as field_id,
        coalesce(f.name, ''sin-cancha'')::text as field_name,
        f.address::text as field_address,
        f.google_maps_url::text as google_maps_url,
        e.event_date::date as event_date,
        (' || v_max_players_expr || ')::integer as max_players
      from public.events e
      left join public.fields f
        on f.id = e.field_id
      where e.ends_at is null
        and not (' || v_registration_locked_expr || ')
        and (
          $1 is null
          or lower(coalesce(e.title, '''')) like ''%'' || lower($1) || ''%''
          or lower(coalesce(f.name, '''')) like ''%'' || lower($1) || ''%''
        )
    ),
    reg_counts as (
      select
        r.event_id,
        count(*)::integer as registered_count
      from public.event_paid_registrations r
      where r.registration_status in (''paid'', ''present'', ''assigned'')
      group by r.event_id
    ),
    my_regs as (
      select distinct on (r.event_id)
        r.event_id,
        r.registration_status::text as my_registration_status,
        r.payment_order_id
      from public.event_paid_registrations r
      where r.operator_user_id = $2
      order by r.event_id, r.created_at desc
    )
    select
      b.event_id,
      b.title,
      b.field_id,
      b.field_name,
      b.field_address,
      b.google_maps_url,
      b.event_date,
      b.max_players,
      coalesce(rc.registered_count, 0) as registered_count,
      case
        when b.max_players is null then null::integer
        else greatest(b.max_players - coalesce(rc.registered_count, 0), 0)
      end as slots_available,
      case
        when b.max_players is null then false
        else coalesce(rc.registered_count, 0) >= b.max_players
      end as is_full,
      mr.my_registration_status,
      mr.payment_order_id as my_payment_order_id
    from base_events b
    left join reg_counts rc
      on rc.event_id = b.event_id
    left join my_regs mr
      on mr.event_id = b.event_id
    order by b.event_date asc, b.title asc
    limit $3';

  return query execute v_sql using v_search, v_uid, v_limit;
end;
$$;
