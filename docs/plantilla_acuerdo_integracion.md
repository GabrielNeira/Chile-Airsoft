# Plantilla de acuerdo de integracion de pagos

## Partes
1. Proveedor/Cancha: [NOMBRE]
2. Integrador: ChileAirsoft

## Objeto
El Proveedor enviara notificaciones de pago y habilitara consultas de estado para sincronizar eventos y registros operativos en ChileAirsoft.

## Alcance tecnico
1. Envio de webhook firmado a endpoint de ChileAirsoft.
2. Entrega de campos minimos: payment_id, external_order_id, status, amount, currency, paid_at.
3. Soporte de ambiente sandbox y credenciales de prueba.
4. Endpoint de consulta de estado por payment_id u orden.

## Responsabilidades del Proveedor
1. Garantizar exactitud de estado de pago enviado.
2. Implementar firma de webhook y proteger secretos.
3. Aplicar reintentos ante errores temporales.
4. Notificar cambios de API/version con al menos 15 dias corridos.

## Responsabilidades de ChileAirsoft
1. Validar firma de webhook.
2. Procesar eventos con idempotencia.
3. Mantener trazabilidad y auditoria de eventos.
4. Entregar soporte de integracion en horarios acordados.

## SLA sugerido
1. Disponibilidad endpoint webhook: 99.5% mensual.
2. Tiempo maximo de respuesta webhook: 3 segundos promedio.
3. Tiempo de primera respuesta soporte: 1 dia habil.
4. Tiempo objetivo de resolucion incidentes criticos: 8 horas habiles.

## Seguridad
1. Intercambio de secretos por canal seguro.
2. Rotacion de webhook_secret cada 90 dias o ante incidente.
3. Acceso a credenciales bajo principio de minimo privilegio.
4. Registro de auditoria por al menos 180 dias.

## Politica de reintentos
1. Reintentos del mismo evento deben mantener el mismo idempotency key.
2. Reintentos maximos recomendados: 6 en 24 horas.
3. Tras agotar reintentos, el Proveedor debe exponer evento en cola de conciliacion manual.

## Datos personales
1. Las partes declaran cumplir normativa aplicable de proteccion de datos en Chile.
2. Se minimiza almacenamiento de datos sensibles a lo estrictamente operativo.
3. Se habilita proceso de rectificacion/eliminacion conforme canal formal.

## Go-live y aceptacion
Criterios de salida:
1. Prueba approved exitosa.
2. Prueba idempotencia exitosa.
3. Prueba firma invalida exitosa.
4. Prueba reconciliacion por API exitosa.

Firmas:
1. Representante Proveedor/Cancha
2. Representante ChileAirsoft
