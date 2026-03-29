# Anexo tecnico de integracion webhook de pago

## 1. Endpoint receptor
URL base:
https://PROJECT_REF.functions.supabase.co/payment-webhook

Metodo:
POST

Content-Type:
application/json

## 2. Headers requeridos
1. x-provider-code
2. x-idempotency-key
3. x-signature

Header opcional:
1. x-event-id

## 3. Payload canonico minimo
{
  "metadata": {
    "field_payment_account_id": "UUID",
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

## 4. Firma y seguridad
1. Algoritmo recomendado: HMAC SHA-256.
2. Mensaje a firmar: body JSON exacto del request.
3. Clave: webhook_secret configurado por cancha en ChileAirsoft.
4. Firma enviada en x-signature en hexadecimal lowercase.

## 5. Idempotencia
1. Cada evento debe traer x-idempotency-key unico por intento logico.
2. Reintentos de red deben reutilizar el mismo x-idempotency-key.
3. ChileAirsoft responde duplicate o ignored cuando el evento ya fue procesado.

## 6. Estados esperados
Estados normalizados internos:
1. pending
2. approved
3. rejected
4. refunded

Mapeo por proveedor:
1. Definido en public.payment_provider_status_map.
2. Si un estado no existe en mapeo, se usa fallback generico.

## 7. Codigos de respuesta
1. 200: procesado o duplicado sin error.
2. 202: ignorado (ejemplo: firma invalida o estado no aprobado).
3. 400: payload o headers invalidos.
4. 404: cuenta de pago no encontrada/inactiva.
5. 500: error interno o de procesamiento.

## 8. Reintentos recomendados del proveedor
1. Reintento exponencial: 1m, 5m, 15m, 60m.
2. Maximo 24h de reintentos.
3. No generar nuevos idempotency-key en reintentos del mismo evento.

## 9. Pruebas obligatorias antes de productivo
1. Pago approved procesa evento e inscripciones.
2. Mismo request repetido no duplica datos.
3. Firma invalida queda en ignored.
4. Estado pending no crea inscripcion operativa.

## 10. Observabilidad
Consultar:
1. public.webhook_events_log
2. public.payment_transactions
3. public.payment_orders
4. public.event_paid_registrations
5. public.payment_audit_view
