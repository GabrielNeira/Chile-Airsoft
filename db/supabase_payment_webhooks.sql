-- ChileAirsoft / Integracion de pagos multi-cancha con webhook idempotente
-- Ejecutar despues de:
--   db/supabase_schema.sql
--   db/supabase_match_ops_metrics.sql

create extension if not exists pgcrypto;

create table if not exists public.payment_providers (
  code text primary key,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.payment_providers (code, display_name)
values
  ('mercadopago', 'Mercado Pago'),
  ('flow', 'Flow'),
  ('transbank', 'Transbank'),
  ('stripe', 'Stripe')
on conflict (code) do nothing;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum ('pending', 'approved', 'rejected', 'refunded');
  end if;
end;
$$;

create table if not exists public.payment_provider_status_map (
  id uuid primary key default gen_random_uuid(),
  provider_code text not null references public.payment_providers (code) on delete cascade,
  provider_status text not null,
  normalized_status public.payment_status not null,
  created_at timestamptz not null default now(),
  unique (provider_code, provider_status)
);

insert into public.payment_provider_status_map (provider_code, provider_status, normalized_status)
values
  -- Mercado Pago
  ('mercadopago', 'approved', 'approved'),
  ('mercadopago', 'accredited', 'approved'),
  ('mercadopago', 'authorized', 'pending'),
  ('mercadopago', 'in_process', 'pending'),
  ('mercadopago', 'pending', 'pending'),
  ('mercadopago', 'rejected', 'rejected'),
  ('mercadopago', 'cancelled', 'rejected'),
  ('mercadopago', 'refunded', 'refunded'),
  ('mercadopago', 'charged_back', 'refunded'),

  -- Flow
  ('flow', 'paid', 'approved'),
  ('flow', 'completed', 'approved'),
  ('flow', 'pending', 'pending'),
  ('flow', 'waiting', 'pending'),
  ('flow', 'rejected', 'rejected'),
  ('flow', 'failed', 'rejected'),
  ('flow', 'cancelled', 'rejected'),
  ('flow', 'refunded', 'refunded'),

  -- Transbank
  ('transbank', 'authorized', 'approved'),
  ('transbank', 'approved', 'approved'),
  ('transbank', 'initialized', 'pending'),
  ('transbank', 'pending', 'pending'),
  ('transbank', 'failed', 'rejected'),
  ('transbank', 'reversed', 'refunded'),
  ('transbank', 'nullified', 'refunded'),

  -- Stripe
  ('stripe', 'succeeded', 'approved'),
  ('stripe', 'requires_payment_method', 'pending'),
  ('stripe', 'requires_confirmation', 'pending'),
  ('stripe', 'requires_action', 'pending'),
  ('stripe', 'processing', 'pending'),
  ('stripe', 'canceled', 'rejected'),
  ('stripe', 'refunded', 'refunded')
on conflict (provider_code, provider_status) do update
set normalized_status = excluded.normalized_status;

create table if not exists public.field_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields (id) on delete cascade,
  provider_code text not null references public.payment_providers (code) on delete restrict,
  organizer_user_id uuid not null references auth.users (id) on delete restrict,
  provider_account_ref text not null,
  webhook_secret text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (field_id, provider_code, provider_account_ref)
);

drop trigger if exists trg_field_payment_accounts_updated_at on public.field_payment_accounts;
create trigger trg_field_payment_accounts_updated_at
before update on public.field_payment_accounts
for each row execute function public.tg_set_updated_at();

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields (id) on delete restrict,
  organizer_user_id uuid not null references auth.users (id) on delete restrict,
  event_id uuid references public.events (id) on delete set null,
  external_order_id text not null,
  currency text not null default 'CLP',
  total_amount numeric(12,2) not null check (total_amount >= 0),
  customer_email text,
  customer_name text,
  customer_phone text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (field_id, external_order_id)
);

drop trigger if exists trg_payment_orders_updated_at on public.payment_orders;
create trigger trg_payment_orders_updated_at
before update on public.payment_orders
for each row execute function public.tg_set_updated_at();

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum ('pending', 'approved', 'rejected', 'refunded');
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'webhook_process_state') then
    create type public.webhook_process_state as enum ('received', 'processed', 'ignored', 'failed');
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'registration_status') then
    create type public.registration_status as enum ('paid', 'present', 'assigned', 'cancelled', 'refunded');
  end if;
end;
$$;

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  field_payment_account_id uuid not null references public.field_payment_accounts (id) on delete restrict,
  payment_order_id uuid not null references public.payment_orders (id) on delete cascade,
  provider_code text not null references public.payment_providers (code) on delete restrict,
  provider_payment_id text not null,
  event_external_id text,
  raw_status text not null,
  normalized_status public.payment_status not null,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'CLP',
  paid_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_code, provider_payment_id)
);

drop trigger if exists trg_payment_transactions_updated_at on public.payment_transactions;
create trigger trg_payment_transactions_updated_at
before update on public.payment_transactions
for each row execute function public.tg_set_updated_at();

create table if not exists public.webhook_events_log (
  id uuid primary key default gen_random_uuid(),
  provider_code text not null references public.payment_providers (code) on delete restrict,
  event_external_id text,
  idempotency_key text not null,
  signature_valid boolean not null,
  payload jsonb not null default '{}'::jsonb,
  process_state public.webhook_process_state not null default 'received',
  process_result jsonb,
  error_message text,
  retry_count integer not null default 0,
  received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (idempotency_key)
);

create table if not exists public.event_paid_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  payment_order_id uuid not null references public.payment_orders (id) on delete cascade,
  payment_transaction_id uuid not null references public.payment_transactions (id) on delete cascade,
  operator_user_id uuid references public.operator_profiles (user_id) on delete set null,
  guest_nickname text,
  guest_rut_normalized text,
  guest_blood_group text,
  is_minor boolean not null default false,
  registration_identity text generated always as (
    coalesce(operator_user_id::text, nullif(guest_rut_normalized, ''), lower(coalesce(guest_nickname, '')))
  ) stored,
  registration_status public.registration_status not null default 'paid',
  checkin_source text not null default 'payment_webhook',
  team_slot public.team_slot,
  checked_in_at timestamptz,
  assigned_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (registration_identity <> ''),
  unique (event_id, payment_order_id, registration_identity)
);

drop trigger if exists trg_event_paid_registrations_updated_at on public.event_paid_registrations;
create trigger trg_event_paid_registrations_updated_at
before update on public.event_paid_registrations
for each row execute function public.tg_set_updated_at();

create index if not exists idx_event_paid_registrations_event_status
  on public.event_paid_registrations (event_id, registration_status, created_at desc);
create index if not exists idx_payment_transactions_order
  on public.payment_transactions (payment_order_id, normalized_status, received_at desc);
create index if not exists idx_webhook_events_provider_received
  on public.webhook_events_log (provider_code, received_at desc);

alter table public.field_payment_accounts enable row level security;
alter table public.payment_orders enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.webhook_events_log enable row level security;
alter table public.event_paid_registrations enable row level security;

drop policy if exists field_payment_accounts_read on public.field_payment_accounts;
create policy field_payment_accounts_read
on public.field_payment_accounts
for select
using (
  public.is_super_admin()
  or organizer_user_id = auth.uid()
  or public.is_field_admin(field_id)
);

drop policy if exists field_payment_accounts_write on public.field_payment_accounts;
create policy field_payment_accounts_write
on public.field_payment_accounts
for all
using (
  public.is_super_admin()
  or organizer_user_id = auth.uid()
  or public.is_field_admin(field_id)
)
with check (
  public.is_super_admin()
  or organizer_user_id = auth.uid()
  or public.is_field_admin(field_id)
);

drop policy if exists payment_orders_read on public.payment_orders;
create policy payment_orders_read
on public.payment_orders
for select
using (
  public.is_super_admin()
  or organizer_user_id = auth.uid()
  or public.is_field_admin(field_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_organizer_for_event(e.id)
  )
);

drop policy if exists event_paid_registrations_read on public.event_paid_registrations;
create policy event_paid_registrations_read
on public.event_paid_registrations
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
);

drop policy if exists event_paid_registrations_write on public.event_paid_registrations;
create policy event_paid_registrations_write
on public.event_paid_registrations
for update
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

revoke all on public.payment_transactions from authenticated;
revoke all on public.webhook_events_log from authenticated;

create or replace function public.normalize_payment_status(p_provider_code text, raw_status text)
returns public.payment_status
language plpgsql
stable
as $$
declare
  v_mapped public.payment_status;
  v_provider text := nullif(lower(trim(coalesce(p_provider_code, ''))), '');
  v_status text := lower(trim(coalesce(raw_status, '')));
begin
  if v_provider is not null then
    select m.normalized_status
    into v_mapped
    from public.payment_provider_status_map m
    where m.provider_code = v_provider
      and lower(m.provider_status) = v_status
    limit 1;

    if v_mapped is not null then
      return v_mapped;
    end if;
  end if;

  if v_status in ('approved', 'paid', 'accredited', 'succeeded', 'success') then
    return 'approved'::public.payment_status;
  end if;

  if v_status in ('refunded', 'chargeback', 'reversed') then
    return 'refunded'::public.payment_status;
  end if;

  if v_status in ('rejected', 'failed', 'cancelled', 'canceled', 'voided') then
    return 'rejected'::public.payment_status;
  end if;

  return 'pending'::public.payment_status;
end;
$$;

create or replace function public.normalize_payment_status(raw_status text)
returns public.payment_status
language sql
stable
as $$
  select public.normalize_payment_status(null, raw_status);
$$;

create or replace function public.resolve_or_create_event_for_payment(
  p_field_id uuid,
  p_organizer_user_id uuid,
  p_event_id uuid,
  p_event_title text,
  p_event_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_title text := coalesce(nullif(trim(p_event_title), ''), 'Evento generado por pago');
  v_date date := coalesce(p_event_date, now()::date);
begin
  if p_event_id is not null then
    select e.id
    into v_event_id
    from public.events e
    where e.id = p_event_id;

    if v_event_id is not null then
      return v_event_id;
    end if;
  end if;

  select e.id
  into v_event_id
  from public.events e
  where e.field_id = p_field_id
    and e.created_by = p_organizer_user_id
    and e.event_date = v_date
    and e.title = v_title
  order by e.created_at desc
  limit 1;

  if v_event_id is null then
    insert into public.events (field_id, title, event_date, created_by)
    values (p_field_id, v_title, v_date, p_organizer_user_id)
    returning id into v_event_id;
  end if;

  insert into public.event_organizers (event_id, user_id)
  values (v_event_id, p_organizer_user_id)
  on conflict (event_id, user_id) do nothing;

  return v_event_id;
end;
$$;

create or replace function public.process_payment_webhook(
  p_provider_code text,
  p_event_external_id text,
  p_idempotency_key text,
  p_signature_valid boolean,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log_id uuid;
  v_log_state public.webhook_process_state;
  v_field_payment_account_id uuid;
  v_field_id uuid;
  v_organizer_user_id uuid;
  v_event_id uuid;
  v_external_order_id text;
  v_provider_payment_id text;
  v_raw_status text;
  v_normalized_status public.payment_status;
  v_currency text;
  v_amount numeric(12,2);
  v_paid_at timestamptz;
  v_order_id uuid;
  v_transaction_id uuid;
  v_created_regs integer := 0;
  v_result jsonb;
  v_items jsonb;
  v_item jsonb;
begin
  if coalesce(trim(p_idempotency_key), '') = '' then
    raise exception 'idempotency_key is required';
  end if;

  insert into public.webhook_events_log (
    provider_code,
    event_external_id,
    idempotency_key,
    signature_valid,
    payload,
    process_state,
    received_at,
    last_received_at
  )
  values (
    p_provider_code,
    p_event_external_id,
    p_idempotency_key,
    p_signature_valid,
    coalesce(p_payload, '{}'::jsonb),
    'received',
    now(),
    now()
  )
  on conflict (idempotency_key) do update
  set
    retry_count = public.webhook_events_log.retry_count + 1,
    last_received_at = now(),
    payload = excluded.payload,
    signature_valid = excluded.signature_valid
  returning id, process_state into v_log_id, v_log_state;

  if v_log_state = 'processed' then
    return jsonb_build_object(
      'status', 'duplicate',
      'message', 'Webhook already processed',
      'idempotency_key', p_idempotency_key
    );
  end if;

  if not p_signature_valid then
    update public.webhook_events_log
    set
      process_state = 'ignored',
      error_message = 'Invalid signature',
      processed_at = now(),
      process_result = jsonb_build_object('status', 'ignored', 'reason', 'invalid_signature')
    where id = v_log_id;

    return jsonb_build_object('status', 'ignored', 'reason', 'invalid_signature');
  end if;

  v_field_payment_account_id := nullif(p_payload #>> '{metadata,field_payment_account_id}', '')::uuid;
  if v_field_payment_account_id is null then
    raise exception 'metadata.field_payment_account_id is required';
  end if;

  select fpa.field_id, fpa.organizer_user_id
  into v_field_id, v_organizer_user_id
  from public.field_payment_accounts fpa
  where fpa.id = v_field_payment_account_id
    and fpa.provider_code = p_provider_code
    and fpa.is_active = true;

  if v_field_id is null or v_organizer_user_id is null then
    raise exception 'field payment account not found or inactive';
  end if;

  v_external_order_id := coalesce(
    nullif(p_payload #>> '{order,external_order_id}', ''),
    nullif(p_payload ->> 'external_order_id', ''),
    nullif(p_payload #>> '{data,external_order_id}', '')
  );

  if v_external_order_id is null then
    raise exception 'external_order_id is required';
  end if;

  v_provider_payment_id := coalesce(
    nullif(p_payload #>> '{payment,payment_id}', ''),
    nullif(p_payload ->> 'payment_id', ''),
    nullif(p_payload #>> '{data,payment_id}', ''),
    p_event_external_id,
    p_idempotency_key
  );

  v_raw_status := coalesce(
    nullif(p_payload #>> '{payment,status}', ''),
    nullif(p_payload ->> 'status', ''),
    nullif(p_payload #>> '{data,status}', ''),
    'pending'
  );

  v_normalized_status := public.normalize_payment_status(p_provider_code, v_raw_status);
  v_currency := coalesce(nullif(p_payload #>> '{payment,currency}', ''), nullif(p_payload ->> 'currency', ''), 'CLP');
  v_amount := coalesce(
    nullif(p_payload #>> '{payment,amount}', '')::numeric,
    nullif(p_payload ->> 'amount', '')::numeric,
    0
  );
  v_paid_at := coalesce(
    nullif(p_payload #>> '{payment,paid_at}', '')::timestamptz,
    nullif(p_payload ->> 'paid_at', '')::timestamptz,
    now()
  );

  v_event_id := public.resolve_or_create_event_for_payment(
    v_field_id,
    v_organizer_user_id,
    nullif(p_payload #>> '{metadata,event_id}', '')::uuid,
    p_payload #>> '{metadata,event_title}',
    nullif(p_payload #>> '{metadata,event_date}', '')::date
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
    customer_phone,
    metadata
  )
  values (
    v_field_id,
    v_organizer_user_id,
    v_event_id,
    v_external_order_id,
    v_currency,
    v_amount,
    nullif(p_payload #>> '{customer,email}', ''),
    nullif(p_payload #>> '{customer,name}', ''),
    nullif(p_payload #>> '{customer,phone}', ''),
    coalesce(p_payload #> '{metadata}', '{}'::jsonb)
  )
  on conflict (field_id, external_order_id) do update
  set
    event_id = excluded.event_id,
    total_amount = excluded.total_amount,
    currency = excluded.currency,
    customer_email = coalesce(excluded.customer_email, public.payment_orders.customer_email),
    customer_name = coalesce(excluded.customer_name, public.payment_orders.customer_name),
    customer_phone = coalesce(excluded.customer_phone, public.payment_orders.customer_phone),
    metadata = public.payment_orders.metadata || excluded.metadata,
    updated_at = now()
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
    v_field_payment_account_id,
    v_order_id,
    p_provider_code,
    v_provider_payment_id,
    p_event_external_id,
    v_raw_status,
    v_normalized_status,
    v_amount,
    v_currency,
    v_paid_at,
    coalesce(p_payload, '{}'::jsonb),
    now()
  )
  on conflict (provider_code, provider_payment_id) do update
  set
    raw_status = excluded.raw_status,
    normalized_status = excluded.normalized_status,
    amount = excluded.amount,
    currency = excluded.currency,
    paid_at = excluded.paid_at,
    payload = excluded.payload,
    event_external_id = excluded.event_external_id,
    received_at = now(),
    updated_at = now()
  returning id into v_transaction_id;

  if v_normalized_status <> 'approved' then
    update public.webhook_events_log
    set
      process_state = 'ignored',
      processed_at = now(),
      process_result = jsonb_build_object(
        'status', 'ignored',
        'reason', 'non_approved_status',
        'normalized_status', v_normalized_status::text,
        'event_id', v_event_id
      )
    where id = v_log_id;

    return jsonb_build_object(
      'status', 'ignored',
      'normalized_status', v_normalized_status::text,
      'event_id', v_event_id
    );
  end if;

  v_items := coalesce(p_payload #> '{registrations}', '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    v_items := jsonb_build_array(
      jsonb_build_object(
        'operator_user_id', nullif(p_payload #>> '{player,operator_user_id}', ''),
        'guest_nickname', nullif(p_payload #>> '{player,nickname}', ''),
        'guest_rut', nullif(p_payload #>> '{player,rut}', ''),
        'guest_blood_group', nullif(p_payload #>> '{player,blood_group}', ''),
        'is_minor', coalesce((p_payload #>> '{player,is_minor}')::boolean, false)
      )
    );
  end if;

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    insert into public.event_paid_registrations (
      event_id,
      payment_order_id,
      payment_transaction_id,
      operator_user_id,
      guest_nickname,
      guest_rut_normalized,
      guest_blood_group,
      is_minor,
      registration_status,
      metadata
    )
    values (
      v_event_id,
      v_order_id,
      v_transaction_id,
      nullif(v_item ->> 'operator_user_id', '')::uuid,
      nullif(v_item ->> 'guest_nickname', ''),
      upper(regexp_replace(coalesce(v_item ->> 'guest_rut', ''), '[^0-9Kk]', '', 'g')),
      nullif(v_item ->> 'guest_blood_group', ''),
      coalesce((v_item ->> 'is_minor')::boolean, false),
      'paid',
      coalesce(v_item, '{}'::jsonb)
    )
    on conflict (event_id, payment_order_id, registration_identity) do update
    set
      payment_transaction_id = excluded.payment_transaction_id,
      guest_nickname = coalesce(excluded.guest_nickname, public.event_paid_registrations.guest_nickname),
      guest_rut_normalized = coalesce(excluded.guest_rut_normalized, public.event_paid_registrations.guest_rut_normalized),
      guest_blood_group = coalesce(excluded.guest_blood_group, public.event_paid_registrations.guest_blood_group),
      is_minor = excluded.is_minor,
      metadata = public.event_paid_registrations.metadata || excluded.metadata,
      updated_at = now();

    v_created_regs := v_created_regs + 1;
  end loop;

  v_result := jsonb_build_object(
    'status', 'processed',
    'event_id', v_event_id,
    'payment_order_id', v_order_id,
    'payment_transaction_id', v_transaction_id,
    'registrations_upserted', v_created_regs
  );

  update public.webhook_events_log
  set
    process_state = 'processed',
    process_result = v_result,
    processed_at = now(),
    error_message = null
  where id = v_log_id;

  return v_result;
exception
  when others then
    update public.webhook_events_log
    set
      process_state = 'failed',
      error_message = SQLERRM,
      processed_at = now(),
      process_result = jsonb_build_object('status', 'failed', 'error', SQLERRM)
    where id = v_log_id;

    raise;
end;
$$;

grant execute on function public.process_payment_webhook(text, text, text, boolean, jsonb) to service_role;
grant execute on function public.resolve_or_create_event_for_payment(uuid, uuid, uuid, text, date) to service_role;
grant execute on function public.normalize_payment_status(text, text) to service_role;
grant execute on function public.normalize_payment_status(text) to service_role;

grant select, insert, update on public.payment_orders to service_role;
grant select, insert, update on public.payment_transactions to service_role;
grant select, insert, update on public.webhook_events_log to service_role;
grant select, insert, update on public.event_paid_registrations to service_role;
grant select on public.field_payment_accounts to service_role;
