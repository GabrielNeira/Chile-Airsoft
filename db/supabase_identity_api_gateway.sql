-- Protected identity lookup gateway support tables
-- Run after db/supabase_auth_rut_legal_onboarding.sql

create table if not exists public.identity_lookup_cache (
  rut text primary key,
  full_name text not null,
  provider text not null default 'boostr',
  payload jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (public.is_valid_rut(rut))
);

create index if not exists idx_identity_lookup_cache_expires
  on public.identity_lookup_cache (expires_at);

create table if not exists public.identity_lookup_audit (
  id bigserial primary key,
  user_id uuid references auth.users (id) on delete set null,
  rut text not null,
  source_ip inet,
  user_agent text,
  provider text not null default 'boostr',
  cache_hit boolean not null default false,
  success boolean not null default false,
  failure_reason text,
  created_at timestamptz not null default now(),
  check (public.is_valid_rut(rut))
);

create index if not exists idx_identity_lookup_audit_user_time
  on public.identity_lookup_audit (user_id, created_at desc);

create index if not exists idx_identity_lookup_audit_ip_time
  on public.identity_lookup_audit (source_ip, created_at desc);

create index if not exists idx_identity_lookup_audit_rut_time
  on public.identity_lookup_audit (rut, created_at desc);

create or replace function public.tg_identity_lookup_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_identity_lookup_cache_updated_at on public.identity_lookup_cache;
create trigger trg_identity_lookup_cache_updated_at
before update on public.identity_lookup_cache
for each row execute function public.tg_identity_lookup_cache_updated_at();

alter table public.identity_lookup_cache enable row level security;
alter table public.identity_lookup_audit enable row level security;

-- No direct access from clients. Access only through Edge Function service role.
revoke all on public.identity_lookup_cache from anon, authenticated;
revoke all on public.identity_lookup_audit from anon, authenticated;
