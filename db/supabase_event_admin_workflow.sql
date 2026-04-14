-- Extiende eventos para flujo operativo administrado por cancha.
-- Compatible con esquema existente: no elimina ni renombra columnas actuales.

alter table public.events
  add column if not exists scheduled_at timestamptz,
  add column if not exists max_players integer,
  add column if not exists registration_closed_at timestamptz;

alter table public.events
  drop constraint if exists events_max_players_positive;

alter table public.events
  add constraint events_max_players_positive
  check (max_players is null or max_players > 0);

create index if not exists idx_events_registration_closed_at
  on public.events (registration_closed_at);

create index if not exists idx_events_scheduled_at
  on public.events (scheduled_at);
