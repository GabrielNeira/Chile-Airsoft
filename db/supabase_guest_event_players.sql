create table if not exists public.event_guest_players (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  nickname text not null,
  rut text,
  blood_group text,
  team_hint text,
  is_minor boolean not null default false,
  note text,
  registered_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.event_guest_team_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  guest_player_id uuid not null references public.event_guest_players (id) on delete cascade,
  team_slot public.team_slot not null default 'reserve',
  day_role text,
  assignment_note text,
  is_active boolean not null default true,
  assigned_by uuid not null references auth.users (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  unique (event_id, guest_player_id)
);

create table if not exists public.event_guest_match_participants (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.event_matches (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  guest_player_id uuid not null references public.event_guest_players (id) on delete cascade,
  team_slot public.team_slot not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  play_seconds integer,
  unique (match_id, guest_player_id),
  check (play_seconds is null or play_seconds >= 0)
);

create table if not exists public.event_guest_conduct_cards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  match_id uuid references public.event_matches (id) on delete set null,
  guest_player_id uuid not null references public.event_guest_players (id) on delete cascade,
  card_type public.fair_play_status not null,
  detail text not null,
  issued_by uuid not null references auth.users (id) on delete restrict,
  issued_at timestamptz not null default now()
);

create index if not exists idx_event_guest_players_event on public.event_guest_players (event_id, created_at desc);
create unique index if not exists idx_event_guest_players_event_rut
  on public.event_guest_players (event_id, rut)
  where rut is not null;
create index if not exists idx_event_guest_players_event_nickname on public.event_guest_players (event_id, nickname);
create index if not exists idx_event_guest_assignments_event_team
  on public.event_guest_team_assignments (event_id, team_slot);
create index if not exists idx_event_guest_match_participants_guest
  on public.event_guest_match_participants (guest_player_id, match_id);
create index if not exists idx_event_guest_conduct_cards_guest_issued
  on public.event_guest_conduct_cards (guest_player_id, issued_at desc);

alter table public.event_guest_players enable row level security;
alter table public.event_guest_team_assignments enable row level security;
alter table public.event_guest_match_participants enable row level security;
alter table public.event_guest_conduct_cards enable row level security;

drop policy if exists event_guest_players_read on public.event_guest_players;
create policy event_guest_players_read
on public.event_guest_players
for select
using (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
);

drop policy if exists event_guest_players_write on public.event_guest_players;
create policy event_guest_players_write
on public.event_guest_players
for all
using (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
)
with check (
  registered_by = auth.uid()
  and (
    public.is_super_admin()
    or public.is_organizer_for_event(event_id)
    or exists (
      select 1
      from public.events e
      where e.id = event_id
        and public.is_field_admin(e.field_id)
    )
  )
);

drop policy if exists event_guest_team_assignments_read on public.event_guest_team_assignments;
create policy event_guest_team_assignments_read
on public.event_guest_team_assignments
for select
using (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
);

drop policy if exists event_guest_team_assignments_write on public.event_guest_team_assignments;
create policy event_guest_team_assignments_write
on public.event_guest_team_assignments
for all
using (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
)
with check (
  assigned_by = auth.uid()
  and (
    public.is_super_admin()
    or public.is_organizer_for_event(event_id)
    or exists (
      select 1
      from public.events e
      where e.id = event_id
        and public.is_field_admin(e.field_id)
    )
  )
);

drop policy if exists event_guest_match_participants_read on public.event_guest_match_participants;
create policy event_guest_match_participants_read
on public.event_guest_match_participants
for select
using (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
);

drop policy if exists event_guest_match_participants_write on public.event_guest_match_participants;
create policy event_guest_match_participants_write
on public.event_guest_match_participants
for all
using (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
)
with check (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
);

drop policy if exists event_guest_conduct_cards_read on public.event_guest_conduct_cards;
create policy event_guest_conduct_cards_read
on public.event_guest_conduct_cards
for select
using (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
);

drop policy if exists event_guest_conduct_cards_write on public.event_guest_conduct_cards;
create policy event_guest_conduct_cards_write
on public.event_guest_conduct_cards
for all
using (
  public.is_super_admin()
  or public.is_organizer_for_event(event_id)
  or exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_field_admin(e.field_id)
  )
)
with check (
  issued_by = auth.uid()
  and (
    public.is_super_admin()
    or public.is_organizer_for_event(event_id)
    or exists (
      select 1
      from public.events e
      where e.id = event_id
        and public.is_field_admin(e.field_id)
    )
  )
);
