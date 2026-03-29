# Checklist de despliegue operativo: pagos por webhook

## Objetivo
Dejar productivo hoy el flujo completo:
1. Pago en sitio externo de cancha.
2. Webhook seguro con firma.
3. Procesamiento idempotente.
4. Evento e inscripciones pagadas disponibles en consola de cancha.

## 0) Pre-chequeos
1. Tener rol para ejecutar SQL en Supabase (owner/admin).
2. Confirmar que existe al menos una cancha en public.fields.
3. Confirmar que existe usuario organizador que administrara esa cancha.
4. Confirmar que la app web ya compila (ok en este repo).

## 1) Orden exacto de ejecucion SQL
Ejecutar en este orden, de arriba hacia abajo.

1. [db/supabase_schema.sql](db/supabase_schema.sql)
2. [db/supabase_progression.sql](db/supabase_progression.sql)
3. [db/supabase_player_metrics.sql](db/supabase_player_metrics.sql)
4. [db/supabase_id_metrics_view.sql](db/supabase_id_metrics_view.sql)
5. [db/supabase_match_ops_metrics.sql](db/supabase_match_ops_metrics.sql)
6. [db/supabase_rls_helpers_hotfix.sql](db/supabase_rls_helpers_hotfix.sql)
7. [db/supabase_guest_event_players.sql](db/supabase_guest_event_players.sql)
8. [db/supabase_field_operations_access.sql](db/supabase_field_operations_access.sql)
9. [db/supabase_payment_webhooks.sql](db/supabase_payment_webhooks.sql)
10. [db/supabase_payment_audit_and_simulation.sql](db/supabase_payment_audit_and_simulation.sql)

Notas:
- Si tu proyecto ya tiene parte de estas migraciones, igual puedes ejecutar por bloques; varios scripts estan escritos de forma idempotente.
- Si usas migraciones versionadas, convierte este orden a archivos numerados y aplicalos en ese mismo orden.

## 2) Crear cuenta de pago por cancha
Despues del SQL, inserta una cuenta activa para la cancha/proveedor.

SQL recomendado:

insert into public.field_payment_accounts (
  field_id,
  provider_code,
  organizer_user_id,
  provider_account_ref,
  webhook_secret,
  is_active
)
values (
  'FIELD_UUID_AQUI',
  'mercadopago',
  'ORGANIZER_USER_UUID_AQUI',
  'mp-account-main',
  'REEMPLAZAR_POR_SECRETO_LARGO_Y_ALEATORIO',
  true
)
returning id;

Guarda el id retornado. Ese valor se usara como metadata.field_payment_account_id en cada pago.

## 3) Variables de entorno para la Edge Function
La funcion [supabase/functions/payment-webhook/index.ts](supabase/functions/payment-webhook/index.ts) requiere:

1. SUPABASE_URL
2. SUPABASE_SERVICE_ROLE_KEY

En Supabase Cloud normalmente ya estan disponibles para Edge Functions; si no, definirlas en Secrets del proyecto.

Comando CLI de ejemplo:

supabase secrets set SUPABASE_URL=TU_URL
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY

## 4) Despliegue de la funcion
Funcion a desplegar:
[supabase/functions/payment-webhook/index.ts](supabase/functions/payment-webhook/index.ts)

Comando CLI de ejemplo:

supabase functions deploy payment-webhook --no-verify-jwt

Usar no-verify-jwt porque el llamado vendra desde proveedor externo, no desde usuario autenticado.

Alternativa sin CLI (si no tienes supabase instalado localmente):
1. Ir a Supabase Dashboard -> Edge Functions.
2. Crear funcion payment-webhook.
3. Pegar el contenido de [supabase/functions/payment-webhook/index.ts](supabase/functions/payment-webhook/index.ts).
4. Deploy desde Dashboard.

URL esperada:
https://PROJECT_REF.functions.supabase.co/payment-webhook

## 5) Contrato minimo que debe enviar el proveedor
Headers requeridos:
1. x-provider-code
2. x-idempotency-key
3. x-signature

Header opcional:
1. x-event-id

Body JSON minimo:

{
  "metadata": {
    "field_payment_account_id": "UUID_DE_FIELD_PAYMENT_ACCOUNTS",
    "event_title": "Domingo Milsim",
    "event_date": "2026-03-29"
  },
  "order": {
    "external_order_id": "ORD-1001"
  },
  "payment": {
    "payment_id": "PAY-1001",
    "status": "approved",
    "amount": 25000,
    "currency": "CLP",
    "paid_at": "2026-03-29T15:10:00Z"
  },
  "customer": {
    "email": "jugador1@correo.cl",
    "name": "Jugador Uno",
    "phone": "+56911111111"
  },
  "registrations": [
    {
      "operator_user_id": "UUID_OPCIONAL",
      "guest_nickname": "Invitado Uno",
      "guest_rut": "12345678K",
      "guest_blood_group": "O+",
      "is_minor": false
    }
  ]
}

## 6) Prueba manual webhook con firma HMAC (PowerShell)
Opcion recomendada (automatizada):

1. Ejecutar script [scripts/webhook_smoke_test.ps1](scripts/webhook_smoke_test.ps1)

pwsh -File scripts/webhook_smoke_test.ps1 \
  -FunctionUrl "https://PROJECT_REF.functions.supabase.co/payment-webhook" \
  -WebhookSecret "TU_WEBHOOK_SECRET" \
  -FieldPaymentAccountId "UUID_DE_FIELD_PAYMENT_ACCOUNTS" \
  -ProviderCode "mercadopago" \
  -RunIdempotencyCheck

2. El script hace primera llamada y segunda llamada con mismo idempotency key para validar idempotencia.

Opcion manual (paso a paso):

Paso 1: define variables en consola PowerShell.

$secret = "REEMPLAZAR_POR_WEBHOOK_SECRET"
$provider = "mercadopago"
$idempotency = "test-ord-1001-v1"
$url = "https://PROJECT_REF.functions.supabase.co/payment-webhook"

$payload = @'
{
  "metadata": {
    "field_payment_account_id": "UUID_DE_FIELD_PAYMENT_ACCOUNTS",
    "event_title": "Domingo Milsim",
    "event_date": "2026-03-29"
  },
  "order": {
    "external_order_id": "ORD-1001"
  },
  "payment": {
    "payment_id": "PAY-1001",
    "status": "approved",
    "amount": 25000,
    "currency": "CLP",
    "paid_at": "2026-03-29T15:10:00Z"
  },
  "customer": {
    "email": "jugador1@correo.cl",
    "name": "Jugador Uno",
    "phone": "+56911111111"
  },
  "registrations": [
    {
      "guest_nickname": "Invitado Uno",
      "guest_rut": "12345678K",
      "guest_blood_group": "O+",
      "is_minor": false
    }
  ]
}
'@

Paso 2: calcula firma HMAC SHA256 en hex.

$hmac = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($secret))
$hashBytes = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload))
$signature = -join ($hashBytes | ForEach-Object { $_.ToString("x2") })

Paso 3: envia request.

Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Headers @{
  "x-provider-code" = $provider
  "x-idempotency-key" = $idempotency
  "x-signature" = $signature
} -Body $payload

Resultado esperado primera vez:
- status: processed
- result.registrations_upserted >= 1

## 7) Prueba de idempotencia (obligatoria)
Repite exactamente el mismo request (mismo idempotency key, mismo body, misma firma).

Resultado esperado segunda vez:
- status: duplicate o ignored por ya procesado.
- No se deben crear filas nuevas de inscripcion para la misma identidad.

## 8) Verificaciones SQL post-prueba
1. Webhook auditado:

select id, idempotency_key, process_state, error_message, received_at, processed_at
from public.webhook_events_log
order by received_at desc
limit 20;

2. Orden y transaccion:

select o.id, o.external_order_id, t.provider_payment_id, t.normalized_status, t.amount, t.currency
from public.payment_orders o
join public.payment_transactions t on t.payment_order_id = o.id
order by t.received_at desc
limit 20;

3. Inscripciones pagadas:

select id, event_id, operator_user_id, guest_nickname, guest_rut_normalized, registration_status, team_slot
from public.event_paid_registrations
order by created_at desc
limit 50;

## 9) Verificacion funcional en UI (punto 4)
En [frontend/app/src/components/FieldOperationsConsole.tsx](frontend/app/src/components/FieldOperationsConsole.tsx):
1. Ir a pestaña EVENTO.
2. Ver seccion Pipeline pago a cancha.
3. Confirmar registros en estado paid.
4. Click en Marcar presente y validar cambio a present.
5. Click en A Alpha/A Bravo/A Reserva y validar cambio a assigned.
6. Confirmar que aparecen en equipos y quedan operables para partidas.

## 10) Criterios de salida para pasar a productivo
1. Webhook con firma valida responde processed.
2. Reintento con mismo idempotency key no duplica datos.
3. Inscripcion avanza paid -> present -> assigned desde consola.
4. Check-in/equipo reflejado en operacion de evento.
5. Logs sin errores recurrentes en webhook_events_log.

## 11) Rollback rapido si algo falla
1. Desactivar cuenta de integracion afectada:

update public.field_payment_accounts
set is_active = false
where id = 'FIELD_PAYMENT_ACCOUNT_UUID';

2. Esto bloquea nuevos webhooks de esa cuenta sin romper el resto del sistema.

3. Investigar en:
- [db/supabase_payment_webhooks.sql](db/supabase_payment_webhooks.sql)
- [supabase/functions/payment-webhook/index.ts](supabase/functions/payment-webhook/index.ts)
- tabla public.webhook_events_log

## 12) Kit comercial-tecnico para onboarding de canchas
1. Resumen comercial: [docs/kit_integracion_canchas_comercial.md](docs/kit_integracion_canchas_comercial.md)
2. Anexo tecnico: [docs/anexo_tecnico_webhook_pago.md](docs/anexo_tecnico_webhook_pago.md)
3. Plantilla de acuerdo: [docs/plantilla_acuerdo_integracion.md](docs/plantilla_acuerdo_integracion.md)
