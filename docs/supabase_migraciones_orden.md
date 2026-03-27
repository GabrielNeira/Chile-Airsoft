# Supabase: orden de migraciones

Ejecuta en este orden para dejar el modelo consistente y normalizado:

1. db/supabase_schema.sql
2. db/supabase_progression.sql
3. db/supabase_player_metrics.sql
4. db/supabase_id_metrics_view.sql
5. db/supabase_identity_linking.sql
6. db/supabase_registration_hardening.sql
7. db/supabase_nickname_non_unique.sql
8. db/supabase_auth_rut_legal_onboarding.sql
9. db/supabase_identity_api_gateway.sql
10. db/supabase_real_name_immutable.sql

## Troubleshooting paso 1

Si viste el error `relation "public.user_roles" does not exist`, el orden del archivo antiguo estaba incorrecto.
Ya fue corregido en `db/supabase_schema.sql`.

Si tu ejecucion quedo a medias, limpia los objetos creados parcialmente y vuelve a correr el paso 1:

```sql
drop type if exists public.operator_role cascade;
drop type if exists public.blood_group cascade;
drop type if exists public.fair_play_status cascade;
drop type if exists public.field_user_role cascade;
```

Luego ejecuta nuevamente:

1. db/supabase_schema.sql
2. db/supabase_progression.sql
3. db/supabase_player_metrics.sql
4. db/supabase_id_metrics_view.sql
5. db/supabase_identity_linking.sql
6. db/supabase_registration_hardening.sql
7. db/supabase_nickname_non_unique.sql
8. db/supabase_auth_rut_legal_onboarding.sql
9. db/supabase_identity_api_gateway.sql
10. db/supabase_real_name_immutable.sql

## Variables frontend

En frontend/app crea .env.local con:

VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_ANON_KEY

## Vista para ID posterior

El frontend consulta la vista public.v_operator_id_metrics.
Esta vista entrega campos normalizados para la metrica Operador:

- operator_score
- fair_play_score
- events_experience_score
- achievements_score
- total_confirmed_events
- total_achievements_unlocked
- total_fair_play_green
- total_fair_play_yellow
- total_fair_play_red

No se usan payloads JSON para este flujo.

## Crear ID por primera vez (enlazar cuenta -> credencial)

`update_my_operator_profile(...)` solo actualiza perfiles existentes.
Para crear el primer perfil enlazado a una cuenta usa `admin_create_operator_profile(...)`
o inserta directamente en `operator_profiles`.

### Opcion recomendada (funcion)

```sql
select public.admin_create_operator_profile(
	'8b6f8f76-2d66-4f33-b9f8-83f7cc2bc90c',
	'GHOST-CL',
	'Matias Rojas',
	'12.345.678-9',
	'TU_LLAVE_RUT',
	'O+'::public.blood_group,
	'Santiago Wolves',
	'assault'::public.operator_role,
	'Camila Rojas',
	'+56 9 1234 5678',
	'https://.../avatar.png'
);
```

Importante: no ejecutes el texto `UUID_AUTH_USER` literal. Si aparece ese valor, PostgreSQL responde `22P02 invalid input syntax for type uuid`.

### Opcion segura sin copiar/pegar UUID manual

```sql
select public.admin_create_operator_profile(
	(
		select id
		from auth.users
		where email = 'usuario@correo.cl'
		limit 1
	),
	'GHOST-CL',
	'Matias Rojas',
	'12.345.678-9',
	'TU_LLAVE_RUT',
	'O+'::public.blood_group,
	'Santiago Wolves',
	'assault'::public.operator_role,
	'Camila Rojas',
	'+56 9 1234 5678',
	'https://.../avatar.png'
);
```

### Buscar UUID de cuenta

```sql
select id, email, created_at
from auth.users
order by created_at desc;
```

## Registro con usuario unico + foto de carnet obligatoria

La migracion `db/supabase_registration_hardening.sql` agrega:

- `rut_fingerprint` unico (hash del RUT normalizado con llave secreta)
- `id_card_photo_url` (foto carnet obligatoria para registrar)
- `identity_verification_status` (`pending|approved|rejected`)
- bucket privado `operator-id-documents` para almacenar imagenes de carnet

### Registro recomendado para usuario autenticado

```sql
select public.register_my_operator_profile(
	'Homura',
	'Gabriel Neira',
	'11.111.111-1',
	'TU_LLAVE_RUT',
	'O+'::public.blood_group,
	'Santiago Wolves',
	'assault'::public.operator_role,
	'Camila Rojas',
	'+56912345678',
	'https://.../avatar.png',
	'https://.../id-card.jpg'
);
```

Si intentan registrar el mismo RUT en otra cuenta, la funcion responde error.

## Regla de identidad (actual)

- `nickname` puede repetirse entre cuentas.
- La unicidad real de persona se controla por `rut_fingerprint`.
- `user_id` sigue siendo 1:1 con cuenta `auth.users.id`.

## Onboarding legal por RUT (Ley N 19.628)

La migracion `db/supabase_auth_rut_legal_onboarding.sql` agrega:

- `public.rut_identities` como registro maestro con `rut` como PK.
- Campos minimos de registro: `rut`, `email`, `age`, `legal_full_names`.
- `public.user_privacy_consents` para dejar trazabilidad de consentimientos.
- `public.rut_login_attempts` para auditoria y rate-limit de intentos de login por RUT.

### RPC de registro con checks legales

```sql
select public.register_my_identity_with_rut(
	'12.345.678-5',
	'usuario@correo.cl',
	29,
	'Gabriel Antonio Neira Soto',
	'sii_api',
	'priv-v1',
	'terms-v1',
	'dp-v1',
	true,
	true,
	true,
	null,
	null,
	null,
	false,
	null,
	'Mozilla/5.0'
);
```

### RPC de login por RUT (mensaje no enumerativo)

```sql
select *
from public.request_rut_login_hint('12.345.678-5', null, 'Mozilla/5.0');
```

Notas del flujo:

- El correo informado debe coincidir con `auth.users.email` autenticado.
- Si `age < 18`, exige datos y autorizacion del representante legal.
- Se registran versiones de consentimiento para auditoria y cumplimiento.

## Troubleshooting rapido (frontend credencial)

Si aparece `column operator_profiles.blood_group does not exist`, ejecuta nuevamente:

1. `db/supabase_schema.sql`
2. `db/supabase_auth_rut_legal_onboarding.sql`

La migracion de onboarding ahora incluye compatibilidad legacy para crear/completar `blood_group`.

Si no ves tu RUT en "Mis datos", ejecuta nuevamente `db/supabase_auth_rut_legal_onboarding.sql` para crear la RPC:

- `public.get_my_identity_summary()`

Luego refresca la sesion en frontend (cerrar sesion e ingresar nuevamente).

## Gateway protegido API identidad (recomendado)

Para no exponer API KEY en frontend, usar Edge Function `identity-lookup`.

1. Ejecuta migracion `db/supabase_identity_api_gateway.sql`.
2. Despliega funcion:

```bash
supabase functions deploy identity-lookup
```

3. Configura secretos:

```bash
supabase secrets set IDENTITY_PROVIDER_URL=https://api.boostr.cl/rut/name/{rut}.json
supabase secrets set IDENTITY_PROVIDER_API_KEY=TU_API_KEY
supabase secrets set IDENTITY_LOOKUP_LIMIT_PER_HOUR=30
supabase secrets set IDENTITY_LOOKUP_CACHE_TTL_MINUTES=1440
```

Limites por defecto implementados:

- 30 consultas por usuario por hora.

## Nombre real inmutable (backend)

La migracion `db/supabase_real_name_immutable.sql` aplica dos defensas:

- `update_my_operator_profile(...)` ya no actualiza `real_name`.
- Trigger `trg_block_real_name_self_edit` bloquea cambios directos de `real_name` para usuarios no admin.
- Cache por RUT de 24 horas (1440 minutos).

El frontend ya consume `supabase.functions.invoke('identity-lookup')`.
