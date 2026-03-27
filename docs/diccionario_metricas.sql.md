# Diccionario de datos: metricas y nivel (sin JSON)

## Tabla: public.operator_metric_scores

- operator_user_id: uuid, PK, referencia a operator_profiles.user_id.
- fair_play_score: int [0..100], score de conducta.
- events_experience_score: int [0..100], experiencia por eventos confirmados.
- achievements_score: int [0..100], progreso por logros desbloqueados.
- operator_score: int [1..100], metrica final para ID posterior.
- total_confirmed_events: int, total de asistencias validadas.
- total_achievements_unlocked: int, total de logros desbloqueados.
- total_fair_play_green: int, acumulado fair play verde.
- total_fair_play_yellow: int, acumulado fair play amarillo.
- total_fair_play_red: int, acumulado fair play rojo.
- calculated_at: timestamptz, fecha de ultimo calculo.
- updated_at: timestamptz, auditoria de actualizacion.

## Tabla: public.player_metric_events

- id: uuid, PK.
- operator_user_id: uuid, operador afectado.
- event_id: uuid nullable, evento relacionado.
- event_type: enum, tipo de metrica.
- capture_channel: enum, origen de captura.
- source_ref_id: uuid nullable, referencia de origen.
- value_numeric: numeric(10,2), valor numerico asociado.
- weight: int, peso usado en score confiable.
- verification_state: enum, pending/verified/rejected.
- captured_by: uuid, usuario que captura.
- verified_by: uuid nullable, usuario que verifica.
- verified_at: timestamptz nullable.
- note: text nullable.
- captured_at: timestamptz.
- created_at: timestamptz.

## Tabla: public.player_level_snapshots

- id: uuid, PK.
- operator_user_id: uuid.
- xp_total: int.
- level: int.
- rank_title: text.
- trusted_score: int.
- created_at: timestamptz.

## Vista: public.v_operator_id_metrics

Campos expuestos para la credencial posterior:

- operator_user_id
- nickname
- real_name
- operator_role
- team
- blood_group
- operator_score
- fair_play_score
- events_experience_score
- achievements_score
- total_confirmed_events
- total_achievements_unlocked
- total_fair_play_green
- total_fair_play_yellow
- total_fair_play_red
- metrics_updated_at
