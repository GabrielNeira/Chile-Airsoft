-- ChileAirsoft / Auditoria de pagos + simulacion de webhook
-- Requiere:
--   db/supabase_payment_webhooks.sql

create or replace view public.payment_audit_view as
select
  t.id as payment_transaction_id,
  t.received_at,
  t.provider_code,
  t.provider_payment_id,
  t.event_external_id,
  t.raw_status,
  t.normalized_status,
  t.amount,
  t.currency,
  t.paid_at,
  o.id as payment_order_id,
  o.external_order_id,
  o.field_id,
  o.organizer_user_id,
  o.event_id,
  o.customer_email,
  o.customer_name,
  o.customer_phone,
  coalesce(regs.total_registrations, 0) as registrations_total,
  coalesce(regs.paid_count, 0) as registrations_paid,
  coalesce(regs.present_count, 0) as registrations_present,
  coalesce(regs.assigned_count, 0) as registrations_assigned
from public.payment_transactions t
join public.payment_orders o
  on o.id = t.payment_order_id
left join lateral (
  select
    count(*) as total_registrations,
    count(*) filter (where r.registration_status = 'paid') as paid_count,
    count(*) filter (where r.registration_status = 'present') as present_count,
    count(*) filter (where r.registration_status = 'assigned') as assigned_count
  from public.event_paid_registrations r
  where r.payment_transaction_id = t.id
) regs on true;

comment on view public.payment_audit_view is
'Vista consolidada de transacciones de pago, orden comercial e inscripciones de evento por estado.';

create or replace function public.simulate_payment_webhook_approved(
  p_field_payment_account_id uuid,
  p_external_order_id text default null,
  p_provider_payment_id text default null,
  p_amount numeric default 25000,
  p_currency text default 'CLP',
  p_guest_nickname text default 'Invitado Simulado',
  p_guest_rut text default '12345678K',
  p_event_title text default 'Evento Simulado por Webhook',
  p_event_date date default (now()::date)
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider_code text;
  v_payload jsonb;
  v_idempotency_key text;
  v_external_order_id text;
  v_provider_payment_id text;
  v_result jsonb;
begin
  select fpa.provider_code
  into v_provider_code
  from public.field_payment_accounts fpa
  where fpa.id = p_field_payment_account_id
    and fpa.is_active = true;

  if v_provider_code is null then
    raise exception 'field_payment_account_id invalido o inactivo';
  end if;

  v_external_order_id := coalesce(nullif(trim(p_external_order_id), ''), 'SIM-ORD-' || to_char(now(), 'YYYYMMDDHH24MISS'));
  v_provider_payment_id := coalesce(nullif(trim(p_provider_payment_id), ''), 'SIM-PAY-' || to_char(now(), 'YYYYMMDDHH24MISS'));
  v_idempotency_key := 'sim-' || v_external_order_id || '-v1';

  v_payload := jsonb_build_object(
    'metadata', jsonb_build_object(
      'field_payment_account_id', p_field_payment_account_id,
      'event_title', p_event_title,
      'event_date', p_event_date
    ),
    'order', jsonb_build_object(
      'external_order_id', v_external_order_id
    ),
    'payment', jsonb_build_object(
      'payment_id', v_provider_payment_id,
      'status', 'approved',
      'amount', p_amount,
      'currency', p_currency,
      'paid_at', now()
    ),
    'customer', jsonb_build_object(
      'email', 'simulado@chileairsoft.cl',
      'name', 'Pago Simulado',
      'phone', '+56900000000'
    ),
    'registrations', jsonb_build_array(
      jsonb_build_object(
        'guest_nickname', p_guest_nickname,
        'guest_rut', p_guest_rut,
        'guest_blood_group', 'O+',
        'is_minor', false
      )
    )
  );

  select public.process_payment_webhook(
    v_provider_code,
    null,
    v_idempotency_key,
    true,
    v_payload
  )
  into v_result;

  return v_result || jsonb_build_object(
    'simulation_idempotency_key', v_idempotency_key,
    'simulation_provider_code', v_provider_code,
    'simulation_external_order_id', v_external_order_id,
    'simulation_provider_payment_id', v_provider_payment_id
  );
end;
$$;

grant execute on function public.simulate_payment_webhook_approved(uuid, text, text, numeric, text, text, text, text, date) to service_role;

-- Ejemplo de uso:
-- select public.simulate_payment_webhook_approved(
--   'FIELD_PAYMENT_ACCOUNT_UUID'
-- );
--
-- Auditoria posterior:
-- select *
-- from public.payment_audit_view
-- order by received_at desc
-- limit 20;
