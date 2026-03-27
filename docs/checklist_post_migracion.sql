-- Post-migration checklist queries
-- Run in Supabase SQL Editor after all migration steps.

-- 1) Confirm critical tables exist
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'operator_profiles',
    'operator_progression',
    'player_metric_events',
    'operator_metric_scores',
    'operator_profile_edit_audit'
  )
order by table_name;

-- 2) Confirm key views exist
select table_name
from information_schema.views
where table_schema = 'public'
  and table_name in ('v_operator_id_metrics', 'v_operator_directory_admin')
order by table_name;

-- 3) Confirm credential_code is present and unique
select column_name, is_nullable, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'operator_profiles'
  and column_name = 'credential_code';

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'operator_profiles'
  and indexname = 'idx_operator_profiles_credential_code';

-- 4) Confirm functions for editing profiles exist
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'update_my_operator_profile',
    'admin_update_operator_profile',
    'calculate_operator_metric_scores',
    'register_my_operator_profile',
    'admin_review_operator_identity'
  )
order by routine_name;

-- 5) Confirm identity-hardening columns exist
select column_name, is_nullable, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'operator_profiles'
  and column_name in (
    'rut_fingerprint',
    'id_card_photo_url',
    'identity_verification_status',
    'identity_verification_note',
    'identity_verified_at',
    'identity_verified_by'
  )
order by column_name;

-- 6) Confirm unique index for rut_fingerprint exists
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'operator_profiles'
  and indexname = 'idx_operator_profiles_rut_fingerprint';

-- 7) Confirm nickname is NOT unique and has non-unique index
select conname, contype
from pg_constraint
where conrelid = 'public.operator_profiles'::regclass
  and conname = 'operator_profiles_nickname_key';

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'operator_profiles'
  and indexname = 'idx_operator_profiles_nickname';
