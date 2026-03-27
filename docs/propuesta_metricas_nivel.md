# Propuesta de diseno: Nivel de Jugador basado en metricas

## Objetivo
Calcular el nivel de cada operador con evidencia captada desde cancha y tambien desde el propio jugador, manteniendo trazabilidad y control anti-fraude.

## Fuentes de datos
1. Cancha (alta confianza)
- check-in validado por admin de campo
- crono validado por organizador
- fair play emitido por organizador

2. Jugador (baja confianza hasta verificacion)
- reporte de entrenamiento propio
- se guarda como pendiente y solo impacta fuerte al ser verificado por admin

## Modelo implementado
Archivo SQL: db/supabase_player_metrics.sql

Tablas clave:
- player_metric_events: ledger de eventos metricos (inmutable por diseno de flujo)
- player_level_snapshots: historial de nivel/xp para auditoria

Enums clave:
- metric_event_type
- metric_capture_channel
- metric_verification_state

Funciones clave:
- metric_default_weight: define pesos por tipo de evento
- compute_operator_level: transforma score confiable -> xp -> level -> rank
- refresh_operator_level_from_metrics: sincroniza tabla operator_progression
- player_report_training_session: captura metrica desde jugador (pendiente)
- verify_player_metric_event: valida/rechaza eventos de jugador (admin)

Triggers automaticos:
- event_checkins -> attendance_validated
- chrono_validations -> chrono_validated
- fair_play_reports -> fair_play_green/yellow/red
- player_metric_events cambios -> recalculo nivel

## Formula de nivel implementada
Score confiable:
- suma de pesos de eventos verificados

XP:
- xp_total = max(0, trusted_score * 10)

Nivel:
- level = min(50, floor(sqrt(xp_total / 120)) + 1)

Rango:
- 1-9 Recruit
- 10-19 Field Ready
- 20-29 Advanced
- 30-39 Veteran
- 40+ Tier 1 Operator

## Metricas recomendadas para tablero
1. Operativas
- asistencias validadas (30d / temporada)
- cronos validados y tendencia
- ratio fair play: verde/amarillo/rojo

2. Progresion
- xp total
- nivel y rango
- velocidad de progreso semanal

3. Confiabilidad
- porcentaje de metricas verificadas
- metricas autodeclaradas pendientes
- tiempo promedio de verificacion por admins

## Criterios anti-manipulacion
1. El jugador solo inserta training_self_report pendiente.
2. Solo admin verifica y convierte en impacto fuerte.
3. Eventos de cancha entran verificados automaticamente.
4. Snapshot historico para auditoria y deteccion de outliers.

## Siguiente paso sugerido
Conectar estas funciones a RPC de Supabase y construir dashboard en tiempo real para canchas y operador.
