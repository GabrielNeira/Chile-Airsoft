# Playbook rapido: integracion TUU (Fusterland)

## Hallazgo actual
1. La URL de Fusterland en TUU funciona como checkout/link de pago.
2. La documentacion publica revisada de Openfactura (Haulmer) es principalmente DTE/facturacion.
3. En el sitio publico de TUU no aparece un portal developer claro de webhooks de pago.

Conclusion:
- No asumir webhook/API de pagos hasta confirmacion oficial de soporte TUU.

## Objetivo de esta fase
Determinar en 48 horas si TUU permite:
1. Integracion automatica (webhook/API).
2. Integracion semiautomatica (export reportes CSV/Excel).

## Paso 1: mensaje corto al dueno de cancha
Hola [Nombre], para conectar tus pagos con ChileAirsoft sin cambiar como cobras hoy, necesito:
1. Acceso de lectura al panel TUU (o export de pagos).
2. Contacto de soporte TUU o de quien te configuro el link.
3. Confirmar si cada pago tiene numero de operacion.
Con eso partimos piloto en pocos dias.

## Paso 2: mensaje tecnico a soporte TUU
Asunto: Consulta integracion pagos TUU para sincronizacion operativa

Hola equipo TUU,
queremos sincronizar pagos de comercio a un sistema externo (ChileAirsoft) para automatizar registro de asistentes.

Podrian confirmar por favor:
1. Si disponen de webhook/callback por pago confirmado.
2. Si existe API para consultar pagos por payment_id, external_order_id o rango de fechas.
3. Si las notificaciones incluyen firma (HMAC o equivalente).
4. Campos disponibles: payment_id, order_id, status, amount, currency, paid_at, metadata.
5. Politica de reintentos y codigos de error.
6. Entorno sandbox o credenciales de prueba.

Gracias.

## Paso 3: arbol de decision
1. Si TUU responde "si hay webhook/API":
- Activar integracion automatica con endpoint payment-webhook.
- Mapear estados TUU en payment_provider_status_map.
- Correr prueba idempotencia.

2. Si TUU responde "no hay webhook pero si export":
- Activar fase semiautomatica.
- Importar pagos diarios desde CSV/Excel.
- Marcar paid en lote y continuar flujo present/assigned.

3. Si TUU responde "solo panel manual":
- Definir formato de conciliacion diaria (monto, fecha/hora, nro operacion, referencia jugador).
- Operar manual asistido mientras se evalua cambio de medio de pago.

## Paso 4: datos minimos que debes exigir (innegociables)
1. Identificador unico de operacion.
2. Estado del pago.
3. Monto y moneda.
4. Fecha/hora.
5. Referencia para identificar jugador/evento.

## Paso 5: plan de contingencia
Si TUU no tiene integracion tecnica suficiente:
1. Mantener TUU para cobrar.
2. Conciliar por reportes.
3. Proponer a futuro medio con webhook nativo para automatizar 100%.

## Checklist de cierre de fase
1. Confirmacion oficial de capacidades TUU.
2. Ruta elegida: automatica o semiautomatica.
3. Primer piloto ejecutado con Fusterland.
4. Resultado medido: tiempo desde pago a registro operativo.
