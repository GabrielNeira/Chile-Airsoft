-- Operador: catalogo de eventos activos + registro y pago directo.
-- Ejecutar en Supabase SQL Editor.

create or replace function public.operator_active_events_catalog(
  p_search text default null,
  p_limit integer default 100
)
returns table (
  event_id uuid,
  title text,
  field_id uuid,
  field_name text,
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

grant execute on function public.operator_active_events_catalog(text, integer) to authenticated;
grant execute on function public.operator_active_events_catalog(text, integer) to service_role;

create or replace function public.operator_register_and_pay_event(
  p_event_id uuid,
  p_amount numeric default 25000,
  p_currency text default 'CLP'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_name text;
  v_event record;
  v_registered_count integer := 0;
  v_existing_status text;
  v_field_payment_account record;
  v_amount numeric := greatest(coalesce(p_amount, 0), 0);
  v_currency text := upper(trim(coalesce(p_currency, 'CLP')));
  v_external_order_id text;
  v_provider_payment_id text;
  v_order_id uuid;
  v_transaction_id uuid;
  v_registration_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Sesion no valida para registrarse y pagar.';
  end if;

  if p_event_id is null then
    raise exception using errcode = '22023', message = 'Debes indicar el evento a pagar.';
  end if;

  select
    e.id,
    e.field_id,
    e.title,
    e.event_date,
    e.max_players,
    e.registration_closed_at,
    e.ends_at,
    e.created_by
  into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null then
    raise exception using errcode = 'P0002', message = 'Evento no encontrado.';
  end if;

  if v_event.ends_at is not null then
    raise exception using errcode = 'P0001', message = 'El evento ya esta cerrado.';
  end if;

  if v_event.registration_closed_at is not null then
    raise exception using errcode = 'P0001', message = 'Inscripciones cerradas para este evento.';
  end if;

  select r.registration_status::text
  into v_existing_status
  from public.event_paid_registrations r
  where r.event_id = p_event_id
    and r.operator_user_id = v_uid
    and r.registration_status in ('paid', 'present', 'assigned')
  order by r.created_at desc
  limit 1;

  if v_existing_status is not null then
    return jsonb_build_object(
      'status', 'already_registered',
      'event_id', p_event_id,
      'registration_status', v_existing_status
    );
  end if;

  select count(*)::integer
  into v_registered_count
  from public.event_paid_registrations r
  where r.event_id = p_event_id
    and r.registration_status in ('paid', 'present', 'assigned');

  if v_event.max_players is not null and v_registered_count >= v_event.max_players then
    raise exception using errcode = 'P0001', message = 'No quedan cupos disponibles en este evento.';
  end if;

  select fpa.id, fpa.provider_code
  into v_field_payment_account
  from public.field_payment_accounts fpa
  where fpa.field_id = v_event.field_id
    and fpa.is_active = true
  order by fpa.created_at asc
  limit 1;

  if v_field_payment_account.id is null then
    raise exception using errcode = 'P0001', message = 'La cancha no tiene cuenta de pago activa configurada.';
  end if;

  select u.email
  into v_email
  from auth.users u
  where u.id = v_uid;

  select op.real_name
  into v_name
  from public.operator_profiles op
  where op.user_id = v_uid;

  v_external_order_id := format(
    'APP-%s-%s-%s',
    replace(v_event.id::text, '-', ''),
    to_char(now(), 'YYYYMMDDHH24MISS'),
    substr(replace(v_uid::text, '-', ''), 1, 6)
  );

  v_provider_payment_id := format(
    'APPPAY-%s-%s',
    to_char(now(), 'YYYYMMDDHH24MISSMS'),
    substr(replace(v_uid::text, '-', ''), 1, 8)
  );

  insert into public.payment_orders (
    field_id,
    organizer_user_id,
    event_id,
    external_order_id,
    currency,
    total_amount,
    customer_email,
    customer_name,
    metadata
  )
  values (
    v_event.field_id,
    v_event.created_by,
    v_event.id,
    v_external_order_id,
    v_currency,
    v_amount,
    v_email,
    v_name,
    jsonb_build_object(
      'source', 'operator_app_checkout',
      'operator_user_id', v_uid,
      'event_title', v_event.title
    )
  )
  returning id into v_order_id;

  insert into public.payment_transactions (
    field_payment_account_id,
    payment_order_id,
    provider_code,
    provider_payment_id,
    event_external_id,
    raw_status,
    normalized_status,
    amount,
    currency,
    paid_at,
    payload,
    received_at
  )
  values (
    v_field_payment_account.id,
    v_order_id,
    v_field_payment_account.provider_code,
    v_provider_payment_id,
    v_external_order_id,
    'approved',
    'approved',
    v_amount,
    v_currency,
    now(),
    jsonb_build_object(
      'source', 'operator_app_checkout',
      'operator_user_id', v_uid,
      'event_id', v_event.id,
      'event_title', v_event.title
    ),
    now()
  )
  returning id into v_transaction_id;

  insert into public.event_paid_registrations (
    event_id,
    payment_order_id,
    payment_transaction_id,
    operator_user_id,
    registration_status,
    checkin_source,
    metadata
  )
  values (
    v_event.id,
    v_order_id,
    v_transaction_id,
    v_uid,
    'paid',
    'operator_app_checkout',
    jsonb_build_object(
      'source', 'operator_app_checkout',
      'amount', v_amount,
      'currency', v_currency
    )
  )
  returning id into v_registration_id;

  return jsonb_build_object(
    'status', 'registered_paid',
    'event_id', v_event.id,
    'event_title', v_event.title,
    'payment_order_id', v_order_id,
    'payment_transaction_id', v_transaction_id,
    'registration_id', v_registration_id,
    'amount', v_amount,
    'currency', v_currency
  );
end;
$$;

grant execute on function public.operator_register_and_pay_event(uuid, numeric, text) to authenticated;
grant execute on function public.operator_register_and_pay_event(uuid, numeric, text) to service_role;
