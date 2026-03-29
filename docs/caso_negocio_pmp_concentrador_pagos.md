# Caso de negocio PMP: Concentrador de pagos sin custodia

## 1. Resumen ejecutivo
Proyecto para implementar ChileAirsoft como concentrador de pagos sin custodia de fondos:
1. El jugador paga en checkout de la cancha.
2. El dinero liquida directo a la cuenta de la cancha.
3. ChileAirsoft concentra confirmaciones, operacion de evento y notificaciones.

Propuesta de valor:
1. Menos friccion operativa en cancha.
2. Mayor trazabilidad comercial y deportiva.
3. Menor riesgo regulatorio para ChileAirsoft por no custodiar fondos.

## 2. Problema y oportunidad
Problema actual:
1. Pagos fragmentados por cancha sin integracion operacional.
2. Registro manual de asistentes y demoras en inicio de partidas.
3. Baja visibilidad en tiempo real de pagos confirmados.

Oportunidad:
1. Estandarizar captura de pagos para canchas heterogeneas.
2. Convertir pago confirmado en estado operativo: paid -> present -> assigned.
3. Crear base de datos confiable para metricas, retencion y monetizacion B2B.

## 3. Objetivos del proyecto (SMART)
1. Integrar al menos 1 cancha en piloto en 30 dias calendario.
2. Reducir tiempo de registro pre-partida en al menos 40% en piloto.
3. Lograr >= 98% de pagos conciliados sin intervencion manual al dia 60.
4. Mantener duplicados por idempotencia en 0 casos en produccion.
5. Habilitar notificacion de pago confirmado en menos de 60 segundos.

## 4. Alineacion estrategica
1. Eje producto: plataforma central de operaciones airsoft Chile.
2. Eje negocio: modelo SaaS B2B para canchas.
3. Eje datos: estandarizacion para score, nivel y BI comercial.

## 5. Opciones evaluadas
Opcion A: Operacion manual total (sin API)
1. Costo bajo inicial.
2. Escalabilidad baja.
3. Alto error humano.

Opcion B: Integracion semiautomatica (export CSV/Excel)
1. Costo medio.
2. Tiempo de salida rapido.
3. Automatizacion parcial.

Opcion C: Integracion automatica por webhook/API (recomendada)
1. Costo inicial mayor.
2. Escalabilidad alta.
3. Mejor experiencia y trazabilidad en tiempo real.

## 6. Recomendacion
Adoptar estrategia por fases:
1. Fase 1: semiautomatica para onboarding rapido.
2. Fase 2: webhook/API por proveedor priorizado.
3. Fase 3: multi-cancha y multi-proveedor estandarizado.

## 7. Alcance
En alcance:
1. Modelo de pagos, idempotencia, webhook central.
2. Estado operativo en consola: paid -> present -> assigned.
3. Auditoria consolidada de pagos.
4. Notificaciones al dueno de cancha y organizador.

Fuera de alcance:
1. Custodia de fondos.
2. Reemplazo completo de checkout de cada cancha.
3. Integraciones contables avanzadas ERP en fase inicial.

## 8. Entregables
1. Backend de procesamiento webhook y mapeo de estados.
2. Consola operativa con pipeline de pagos.
3. Kit comercial-tecnico para onboarding de canchas.
4. Reporteria de auditoria y conciliacion.
5. Documentacion de operacion y soporte.

## 9. Beneficios esperados
Beneficios cuantitativos:
1. Menor tiempo de check-in pre-partida.
2. Menos errores de asignacion de pagos a eventos.
3. Mayor conversion de pagos a asistencia efectiva.

Beneficios cualitativos:
1. Confianza del dueno de cancha al recibir fondos directo.
2. Experiencia de organizador mas predecible.
3. Base de crecimiento comercial de la plataforma.

## 10. Desbeneficios y trade-offs
1. Dependencia de capacidades tecnicas de cada proveedor.
2. Mayor complejidad de soporte multi-proveedor.
3. Necesidad de gobierno de cambios por APIs externas.

## 11. Supuestos, restricciones y dependencias
Supuestos:
1. Al menos un proveedor soporta webhook o export consistente.
2. Canchas aceptan incluir referencia de evento/jugador en pago.

Restricciones:
1. No custodia de fondos.
2. Recursos limitados de integracion en canchas pequenas.

Dependencias:
1. Acceso a credenciales y/o panel de proveedor.
2. Definicion de formato de referencia de pago.

## 12. Enfoque PMP por areas
1. Integracion: control de cambios en contrato de payload canonico.
2. Alcance: baseline de entregables por fase.
3. Cronograma: hitos por gates de integracion.
4. Costo: presupuesto por fase y soporte.
5. Calidad: criterios de aceptacion webhook e idempotencia.
6. Recursos: Product Owner, Tech Lead, Integraciones, Operaciones.
7. Comunicaciones: rituales semanales con canchas piloto.
8. Riesgos: registro vivo con planes de respuesta.
9. Adquisiciones: acuerdos con PSP/proveedores.
10. Stakeholders: mapa poder-interes y estrategia de engagement.

## 13. Matriz de stakeholders (poder/interes)
| Stakeholder | Poder | Interes | Estrategia |
|---|---:|---:|---|
| Dueno de cancha piloto | Alto | Alto | Gestion cercana semanal |
| Organizador de eventos | Medio | Alto | Capacitacion y feedback continuo |
| Proveedor de pagos | Alto | Medio | Gestion contractual y tecnica |
| Jugadores | Bajo | Alto | Comunicacion de beneficios y UX |
| Equipo ChileAirsoft | Alto | Alto | Gobernanza quincenal |

## 14. Matriz RACI (macro)
          | Entregable | Sponsor | PM | Tech Lead | Dev Backend | Dev Frontend | Operaciones |
|---|---|---|---|---|---|---|
| Contrato integracion proveedor   | A | R | C | C | I | C |
| Webhook + idempotencia           | I | C | A | R | I | C |
| Pipeline paid->present->assigned | I | C | A | C | R | C |
| Pruebas piloto                   | I | A | C | R | R | R |
| Go-live cancha                   | A | R | C | C | C | R |

## 15. Matriz de riesgos (probabilidad x impacto)
| ID | Riesgo | Probabilidad | Impacto | Severidad | Respuesta |
|---|---|---|---|---|---|
| R1 | Proveedor sin webhook/API | Alta | Alta | Critica | Ruta semiautomatica CSV |
| R2 | Payload incompleto | Media | Alta | Alta | Validaciones obligatorias + rechazo |
| R3 | Duplicacion por reintentos | Media | Alta | Alta | Idempotency key + unique constraints |
| R4 | Caida endpoint webhook | Baja | Alta | Media | Monitor + retry policy |
| R5 | Baja adopcion en cancha | Media | Media | Media | Capacitacion y onboarding guiado |

## 16. Matriz de decision de proveedor (ponderada)
Escala 1-5. Peso total 100.

| Criterio | Peso | Mercado Pago | Flow | Stripe | TUU (a confirmar) |
|---|---:|---:|---:|---:|---:|
| Webhook firmado | 25 | 5 | 4 | 5 | 2 |
| API consulta estado | 20 | 5 | 4 | 5 | 2 |
| Cobertura Chile | 20 | 5 | 5 | 3 | 5 |
| Facilidad onboarding cancha | 15 | 4 | 4 | 3 | 4 |
| Costo/commission relativa | 10 | 3 | 3 | 3 | 4 |
| Soporte/documentacion | 10 | 4 | 4 | 5 | 3 |
| Puntaje ponderado | 100 | 4.5 | 4.2 | 4.1 | 3.1 |

Recomendacion inicial:
1. Proveedor primario piloto: Mercado Pago.
2. Proveedor secundario: Flow.

## 17. Matriz de beneficios (benefit realization)
| Beneficio | KPI | Baseline | Meta | Fecha objetivo | Responsable |
|---|---|---:|---:|---|---|
| Menor tiempo de registro | Minutos pre-partida | 45 | 25 | +60 dias | Operaciones |
| Menor error conciliacion | % pagos mal asignados | 12% | <2% | +60 dias | PM |
| Mayor conversion pago->asistencia | % asistencia/pago | 70% | 85% | +90 dias | Producto |
| Menor carga manual | Horas semanales | 12h | 4h | +60 dias | Cancha + Ops |

## 18. Cronograma de alto nivel
1. Semana 1: discovery tecnico/proveedor + setup entorno.
2. Semana 2: integracion piloto y pruebas E2E.
3. Semana 3: piloto controlado en cancha.
4. Semana 4: ajuste, retrospectiva y decision de escalamiento.

## 19. Presupuesto referencial (CLP)
| Item | Costo estimado |
|---|---:|
| Desarrollo/ajustes integracion | 1,800,000 |
| QA y pruebas piloto | 450,000 |
| Soporte onboarding cancha | 350,000 |
| Contingencia 15% | 390,000 |
| Total estimado | 2,990,000 |

## 20. Criterios de exito y gates
Gate 1 (tecnico):
1. Webhook approved procesa orden/transaccion/inscripcion.
2. Idempotencia valida sin duplicados.

Gate 2 (operacional):
1. Pipeline paid->present->assigned usable en evento real.
2. Notificacion de pago en menos de 60 segundos.

Gate 3 (negocio):
1. KPI de registro y conciliacion cumplen meta minima del piloto.
2. Sponsor aprueba escalamiento a siguiente cancha.

## 21. Recomendacion final para decision
Aprobar el proyecto con enfoque por fases y gate reviews quincenales.
Justificacion:
1. Maximiza probabilidad de adopcion en canchas no tecnicas.
2. Reduce riesgo regulatorio al no custodiar fondos.
3. Permite escalar desde quick wins hacia automatizacion total.
