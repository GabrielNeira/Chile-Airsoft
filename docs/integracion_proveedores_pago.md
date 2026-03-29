# Integracion por proveedor de pago

## Respuesta corta
Si, casi todos los proveedores serios entregan API y webhooks.
No, no todos exponen el mismo contrato ni los mismos estados.

## Regla de arquitectura recomendada
1. Cada proveedor se integra por un adaptador propio.
2. Todos los adaptadores traducen a un payload canonico interno.
3. Solo el webhook confirmado dispara efectos de negocio.
4. Siempre aplicar idempotencia por proveedor + payment_id o merchant_order_id.

## Que API usar por proveedor

Matriz operativa minima:
1. Crear pago/orden: API server-to-server del proveedor.
2. Confirmar pago: webhook firmado del proveedor hacia tu backend.
3. Reconciliar: API de consulta por payment_id o merchant_order_id.
4. Reembolso: API de refund del proveedor.

### Mercado Pago
1. Usar Webhooks para eventos de pago.
2. Guardar id externo de pago y estado.
3. Reconciliar con endpoint de detalle de pago cuando haya dudas.

Payload canonico sugerido para adapter Mercado Pago -> ChileAirsoft:
{
	"metadata": {
		"field_payment_account_id": "UUID",
		"event_title": "Domingo Milsim",
		"event_date": "2026-03-29"
	},
	"order": {
		"external_order_id": "ORD-MP-1001"
	},
	"payment": {
		"payment_id": "MP-123456",
		"status": "approved",
		"amount": 25000,
		"currency": "CLP",
		"paid_at": "2026-03-29T16:20:00Z"
	}
}

### Flow
1. Usar notificacion webhook o callback oficial.
2. Validar firma/hash segun documentacion Flow.
3. Consultar estado de pago en API de confirmacion para reconciliacion.

Payload canonico sugerido para adapter Flow -> ChileAirsoft:
{
	"metadata": {
		"field_payment_account_id": "UUID",
		"event_title": "Domingo Milsim",
		"event_date": "2026-03-29"
	},
	"order": {
		"external_order_id": "ORD-FLOW-9001"
	},
	"payment": {
		"payment_id": "FLOW-9001",
		"status": "paid",
		"amount": 25000,
		"currency": "CLP",
		"paid_at": "2026-03-29T16:20:00Z"
	}
}

### Transbank Webpay
1. Usar flujo de confirmacion y status transaction.
2. Verificar token y resultado en backend.
3. No confiar en redirect del navegador como confirmacion final.

### Stripe
1. Usar webhooks de PaymentIntent o Checkout Session.
2. Verificar firma Stripe-Signature.
3. Reconciliar con retrieve de PaymentIntent si hay discrepancias.

### TUU / Haulmer (caso Fusterland)
1. Verificar primero con soporte si existe webhook/API de pagos para comercios TUU.
2. Si no existe webhook publico, operar fase semiautomatica via export de pagos.
3. No confundir API de Openfactura (DTE/facturacion) con confirmacion de pagos POS/link.
4. Escalar a integracion automatica solo con confirmacion oficial de capacidades tecnicas.

## Todos entregan API?
1. Proveedores de pago modernos: casi siempre si.
2. Gateways o medios locales pequenos: a veces solo callback limitado o panel manual.
3. Si no hay webhook/API robusta, no conviene automatizar core del negocio con ese proveedor.

## Contrato canonico minimo que debes exigir
1. payment_id unico del proveedor.
2. external_order_id de comercio.
3. status de pago.
4. amount y currency.
5. paid_at.
6. metadata para field_payment_account_id.

## Criterios para elegir proveedor en esta plataforma
1. Soporte webhook firmado.
2. Consulta API de estado por payment_id.
3. Documentacion clara de idempotencia y retries.
4. Baja latencia en notificaciones.
5. Cobertura en Chile y costos por transaccion.

## Estrategia recomendada para ChileAirsoft
1. Fase 1: Mercado Pago o Flow como proveedor inicial.
2. Fase 2: agregar Stripe para clientes con checkout internacional.
3. Fase 3: sumar Transbank segun demanda enterprise.

## SQL de auditoria y simulacion
Usar archivo:
[db/supabase_payment_audit_and_simulation.sql](db/supabase_payment_audit_and_simulation.sql)

Incluye:
1. Vista public.payment_audit_view.
2. Funcion public.simulate_payment_webhook_approved(...).

## Playbook operativo TUU
Usar guia:
[docs/playbook_integracion_tuu_fusterland.md](docs/playbook_integracion_tuu_fusterland.md)

## Gobierno de proyecto (PMP)
1. Caso de negocio + matrices: [docs/caso_negocio_pmp_concentrador_pagos.md](docs/caso_negocio_pmp_concentrador_pagos.md)
2. Acta de proyecto: [docs/acta_proyecto_concentrador_pagos.md](docs/acta_proyecto_concentrador_pagos.md)

## Mapeo de estados por proveedor
El mapeo de estados fue agregado en:
[db/supabase_payment_webhooks.sql](db/supabase_payment_webhooks.sql)

Tabla:
1. public.payment_provider_status_map

Uso en procesamiento:
1. public.process_payment_webhook ahora usa normalize_payment_status(provider_code, raw_status).
