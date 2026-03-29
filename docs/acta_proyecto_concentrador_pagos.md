# Acta de proyecto: Concentrador de pagos sin custodia

## 1. Informacion general
- Nombre del proyecto: Concentrador de pagos ChileAirsoft
- Patrocinador (Sponsor): [Completar]
- Project Manager: [Completar]
- Fecha de emision: [Completar]
- Version: 1.0

## 2. Proposito
Implementar un modelo donde ChileAirsoft concentre confirmaciones de pago y operacion de evento, mientras los fondos se liquidan directamente a la cuenta de cada cancha.

## 3. Objetivos del proyecto
1. Integrar 1 cancha piloto en 30 dias.
2. Habilitar procesamiento de pago con idempotencia en ambiente productivo.
3. Reducir tiempo de registro pre-partida en al menos 40%.
4. Lograr >= 98% de conciliacion correcta en piloto.

## 4. Alcance de alto nivel
Incluye:
1. Integracion webhook/API o semiautomatica (segun capacidad proveedor).
2. Persistencia de pagos y auditoria.
3. Pipeline operativo paid -> present -> assigned.
4. Notificaciones de pago confirmado.

Excluye:
1. Custodia de fondos.
2. Reemplazo del checkout de la cancha.
3. Integracion contable ERP avanzada.

## 5. Entregables
1. Modelo de datos de pagos y auditoria.
2. Funciones de procesamiento webhook con idempotencia.
3. Consola operativa con flujo de estados.
4. Kit comercial-tecnico para onboarding de canchas.
5. Informe de resultados de piloto.

## 6. Requisitos de alto nivel
1. Soporte de identificador unico de pago por proveedor.
2. Capacidad de reconciliar estado de pago.
3. Seguridad de webhook por firma.
4. Trazabilidad completa por evento.

## 7. Riesgos principales
1. Proveedor sin webhook/API (mitigacion: fase semiautomatica).
2. Datos incompletos en pago (mitigacion: validaciones y rechazo controlado).
3. Baja adopcion operativa en cancha (mitigacion: onboarding guiado).

## 8. Supuestos y restricciones
Supuestos:
1. Existira al menos una cancha dispuesta a piloto.
2. Habra acceso a panel o soporte del proveedor.

Restricciones:
1. No custodiar fondos.
2. Presupuesto y capacidad de equipo acotados.

## 9. Hitos
1. H1: Aprobacion de alcance y acta (semana 1).
2. H2: Integracion tecnica lista (semana 2).
3. H3: Piloto en cancha ejecutado (semana 3).
4. H4: Decision de escalamiento (semana 4).

## 10. Presupuesto resumido (CLP)
- Desarrollo e integracion: 1,800,000
- QA y piloto: 450,000
- Onboarding y soporte: 350,000
- Contingencia: 390,000
- Total: 2,990,000

## 11. Gobernanza
Comite de proyecto:
1. Sponsor
2. PM
3. Tech Lead
4. Responsable Operaciones

Cadencia:
1. Seguimiento semanal operativo.
2. Revision quincenal de riesgos.
3. Gate review al cierre de cada fase.

## 12. Criterios de aceptacion
1. Pago approved crea orden/transaccion/inscripcion correctamente.
2. Reintentos no duplican por idempotencia.
3. Flujo paid -> present -> assigned operativo en evento real.
4. KPI de piloto en rango objetivo.

## 13. Matriz de aprobaciones
| Rol | Nombre | Firma | Fecha |
|---|---|---|---|
| Sponsor | [Completar] | [Completar] | [Completar] |
| PM | [Completar] | [Completar] | [Completar] |
| Tech Lead | [Completar] | [Completar] | [Completar] |
| Operaciones | [Completar] | [Completar] | [Completar] |

## 14. Referencias
1. docs/caso_negocio_pmp_concentrador_pagos.md
2. docs/checklist_despliegue_webhook_pagos.md
3. docs/anexo_tecnico_webhook_pago.md
4. docs/plantilla_acuerdo_integracion.md
