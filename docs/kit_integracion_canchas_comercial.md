# Kit comercial para canchas: integracion de pagos ChileAirsoft

## Propuesta de valor
ChileAirsoft convierte pagos en asistentes operativos listos para jugar.

Beneficios directos para la cancha:
1. Menos friccion en acceso: pago confirmado se transforma en registro listo para control.
2. Menos trabajo manual: lista de pagados centralizada por evento.
3. Operacion mas rapida en terreno: flujo pagado -> presente -> equipo.
4. Trazabilidad total: pago, orden, inscripcion, check-in, asignacion.
5. Mayor retencion: historial de jugador y score visible para organizacion.

## Alcance de integracion
La cancha mantiene su checkout actual (sitio propio, e-commerce o ticketera).
ChileAirsoft recibe confirmaciones por webhook y sincroniza:
1. Evento
2. Inscripciones pagadas
3. Estado operativo de participantes

## Requisitos minimos para conectar
1. Webhook server-to-server activo.
2. Firma de webhook (HMAC o mecanismo oficial del proveedor).
3. Identificadores: payment_id y external_order_id.
4. Estado de pago y monto.
5. API de consulta de estado para reconciliacion.
6. Sandbox para pruebas.

## Flujo resumido
1. Jugador paga en plataforma de la cancha.
2. Proveedor envia webhook a ChileAirsoft.
3. ChileAirsoft valida firma, aplica idempotencia y guarda transaccion.
4. Se crea/actualiza evento e inscripcion pagada.
5. Organizador marca presente y asigna equipo desde consola.

## Modelo de costos recomendado (editable)
1. Setup integracion unica por cancha.
2. Fee mensual por operacion/soporte.
3. Variable por transaccion procesada (si aplica).

## Plan de implementacion sugerido
1. Semana 1: sandbox + validacion tecnica.
2. Semana 2: piloto con 1 cancha y 1 proveedor.
3. Semana 3: salida productiva y monitoreo.

## Indicadores de exito
1. Tiempo promedio desde pago hasta registro operativo.
2. Tasa de pagos procesados sin intervencion manual.
3. Tiempo de ingreso de jugadores en cancha.
4. Tasa de errores webhook por proveedor.

## Material de referencia interna
1. Checklist operativo: docs/checklist_despliegue_webhook_pagos.md
2. Guia de proveedores: docs/integracion_proveedores_pago.md
3. Anexo tecnico: docs/anexo_tecnico_webhook_pago.md
4. Acuerdo base: docs/plantilla_acuerdo_integracion.md
