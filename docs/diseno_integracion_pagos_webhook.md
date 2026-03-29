# Diseno tecnico: integracion de pagos multi-cancha

## Objetivo

Permitir que canchas independientes procesen pagos en sus propios sitios y que la plataforma central:

1. Reciba confirmacion por webhook.
2. Procese cada pago una sola vez (idempotencia).
3. Cree/actualice evento automaticamente.
4. Genere inscripciones pagadas para el flujo operacional `pagado -> presente -> equipo`.

## Componentes implementados

### 1) Modelo de datos SQL

Archivo: `db/supabase_payment_webhooks.sql`

Tablas nuevas:

- `payment_providers`: catalogo de proveedores de pago.
- `field_payment_accounts`: cuenta por cancha/proveedor (incluye `webhook_secret`).
- `payment_orders`: orden comercial normalizada.
- `payment_transactions`: transacciones por proveedor.
- `webhook_events_log`: bitacora de recepcion y resultado de webhooks.
- `event_paid_registrations`: inscripciones pagadas que alimentan operacion de cancha.

Enums nuevos:

- `payment_status`: `pending|approved|rejected|refunded`.
- `webhook_process_state`: `received|processed|ignored|failed`.
- `registration_status`: `paid|present|assigned|cancelled|refunded`.

Funciones nuevas:

- `normalize_payment_status(raw_status)`.
- `resolve_or_create_event_for_payment(...)`.
- `process_payment_webhook(...)`.

### 2) Endpoint webhook (Edge Function)

Archivo: `supabase/functions/payment-webhook/index.ts`

Contrato de entrada:

Headers requeridos:

- `x-provider-code`
- `x-idempotency-key`
- `x-signature`

Header opcional:

- `x-event-id`

Body JSON requerido:

- `metadata.field_payment_account_id`

Notas:

- La firma valida un HMAC-SHA256 del body completo usando `field_payment_accounts.webhook_secret`.
- Si la firma no valida, el evento queda auditado como `ignored`.
- Si valida, se invoca `process_payment_webhook`.

## Idempotencia

### Estrategia

- Llave unica: `webhook_events_log.idempotency_key`.
- Insercion con `ON CONFLICT` para reintentos sin duplicar efectos.
- Si el evento ya esta `processed`, se responde `duplicate`.

### Efecto

- No se duplica:
  - orden,
  - transaccion,
  - evento,
  - inscripcion pagada.

## Flujo de procesamiento

1. Llega webhook desde proveedor.
2. Se valida firma por cuenta de cancha/proveedor.
3. Se registra evento en `webhook_events_log`.
4. Se normaliza estado de pago.
5. Se crea/actualiza `payment_orders` y `payment_transactions`.
6. Si estado es `approved`:
   - resuelve o crea evento,
   - upsert de `event_paid_registrations`.
7. Se marca log como `processed` o `ignored`.

## Punto 4 implementado en consola: pagado -> presente -> equipo

Archivo: `frontend/app/src/components/FieldOperationsConsole.tsx`

Se agrego en vista `EVENTO`:

- Resumen de pipeline:
  - pagados pendientes de ingreso,
  - pagados presentes sin equipo.
- Lista de `event_paid_registrations`.
- Acciones por registro:
  - `Marcar presente`:
    - Operador: upsert en `event_checkins`.
    - Invitado: crear/buscar `event_guest_players` y marcar presente.
    - Actualiza estado a `present`.
  - `A Alpha`, `A Bravo`, `A Reserva`:
    - Garantiza primero estado presente.
    - Asigna en `event_team_assignments` o `event_guest_team_assignments`.
    - Actualiza estado a `assigned`.

Archivo de estilos actualizado:

- `frontend/app/src/components/field-operations-console.css`

## Orden sugerido de despliegue

1. Ejecutar SQL base si falta (`supabase_schema.sql`, `supabase_match_ops_metrics.sql`, `supabase_guest_event_players.sql`).
2. Ejecutar `db/supabase_payment_webhooks.sql`.
3. Desplegar Edge Function `payment-webhook`.
4. Configurar `field_payment_accounts` por cancha/proveedor.
5. Configurar proveedor externo para enviar webhook con contrato definido.

## Payload normalizado recomendado

```json
{
  "metadata": {
    "field_payment_account_id": "UUID",
    "event_id": "UUID opcional",
    "event_title": "Domingo Milsim",
    "event_date": "2026-03-29"
  },
  "order": {
    "external_order_id": "ORD-123"
  },
  "payment": {
    "payment_id": "PAY-ABC",
    "status": "approved",
    "amount": 25000,
    "currency": "CLP",
    "paid_at": "2026-03-29T10:30:00Z"
  },
  "customer": {
    "email": "jugador@correo.cl",
    "name": "Nombre Jugador",
    "phone": "+569..."
  },
  "registrations": [
    {
      "operator_user_id": "UUID opcional",
      "guest_nickname": "Invitado Uno",
      "guest_rut": "12345678K",
      "guest_blood_group": "O+",
      "is_minor": false
    }
  ]
}
```
