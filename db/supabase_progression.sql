-- ChileAirsoft / Long-term progression system
-- Add-on schema for missions, cosmetics, achievements, and store.
-- Run after base schema in db/supabase_schema.sql

create type public.mission_frequency as enum ('daily', 'weekly', 'seasonal', 'career');
create type public.mission_kind as enum ('attendance', 'fair_play', 'chrono', 'objective', 'community');
create type public.store_item_type as enum ('skin', 'animation', 'badge', 'bundle');
create type public.currency_type as enum ('soft_token', 'premium_token');

create table public.operator_progression (
  operator_user_id uuid primary key references public.operator_profiles (user_id) on delete cascade,
  xp_total integer not null default 0,
  level integer not null default 1,
  rank_title text not null default 'Recruit',
  soft_tokens integer not null default 0,
  premium_tokens integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (xp_total >= 0),
  check (level >= 1),
  check (soft_tokens >= 0),
  check (premium_tokens >= 0)
);

create table public.missions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text not null,
  frequency public.mission_frequency not null,
  mission_kind public.mission_kind not null,
  target_value integer not null check (target_value > 0),
  xp_reward integer not null default 0 check (xp_reward >= 0),
  soft_token_reward integer not null default 0 check (soft_token_reward >= 0),
  premium_token_reward integer not null default 0 check (premium_token_reward >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.operator_mission_progress (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null references public.operator_profiles (user_id) on delete cascade,
  mission_id uuid not null references public.missions (id) on delete cascade,
  progress_value integer not null default 0 check (progress_value >= 0),
  completed_at timestamptz,
  rewarded_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (operator_user_id, mission_id)
);

create table public.id_cosmetics (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  item_type public.store_item_type not null,
  rarity text not null,
  preview_url text,
  is_tradeable boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.id_animations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  css_preset text not null,
  rarity text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.operator_inventory (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null references public.operator_profiles (user_id) on delete cascade,
  cosmetic_id uuid references public.id_cosmetics (id) on delete cascade,
  animation_id uuid references public.id_animations (id) on delete cascade,
  granted_by text not null default 'system',
  granted_at timestamptz not null default now(),
  equipped boolean not null default false,
  check (
    (cosmetic_id is not null and animation_id is null)
    or (cosmetic_id is null and animation_id is not null)
  )
);

create table public.operator_id_loadout (
  operator_user_id uuid primary key references public.operator_profiles (user_id) on delete cascade,
  equipped_skin_code text,
  equipped_animation_code text,
  equipped_badge_code text,
  updated_at timestamptz not null default now()
);

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text not null,
  icon_url text,
  rarity text not null,
  created_at timestamptz not null default now()
);

create table public.operator_achievements (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null references public.operator_profiles (user_id) on delete cascade,
  achievement_id uuid not null references public.achievements (id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  source_event_id uuid references public.events (id) on delete set null,
  unique (operator_user_id, achievement_id)
);

create table public.store_catalog (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  title text not null,
  description text,
  item_type public.store_item_type not null,
  cosmetic_id uuid references public.id_cosmetics (id) on delete set null,
  animation_id uuid references public.id_animations (id) on delete set null,
  soft_token_price integer not null default 0 check (soft_token_price >= 0),
  premium_token_price integer not null default 0 check (premium_token_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (
    (cosmetic_id is not null and animation_id is null)
    or (cosmetic_id is null and animation_id is not null)
  )
);

create table public.store_purchases (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null references public.operator_profiles (user_id) on delete cascade,
  store_item_id uuid not null references public.store_catalog (id) on delete restrict,
  paid_soft_tokens integer not null default 0,
  paid_premium_tokens integer not null default 0,
  purchased_at timestamptz not null default now(),
  processed_by uuid references auth.users (id) on delete set null,
  check (paid_soft_tokens >= 0),
  check (paid_premium_tokens >= 0)
);

create or replace function public.tg_progression_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_operator_progression_updated_at
before update on public.operator_progression
for each row execute function public.tg_progression_updated_at();

create trigger trg_operator_mission_progress_updated_at
before update on public.operator_mission_progress
for each row execute function public.tg_progression_updated_at();

create trigger trg_operator_id_loadout_updated_at
before update on public.operator_id_loadout
for each row execute function public.tg_progression_updated_at();

create or replace function public.sync_progression_from_mission_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_xp integer;
  v_soft integer;
  v_premium integer;
begin
  if new.completed_at is not null and old.completed_at is null and new.rewarded_at is null then
    select m.xp_reward, m.soft_token_reward, m.premium_token_reward
    into v_xp, v_soft, v_premium
    from public.missions m
    where m.id = new.mission_id;

    insert into public.operator_progression (operator_user_id, xp_total, soft_tokens, premium_tokens)
    values (new.operator_user_id, coalesce(v_xp, 0), coalesce(v_soft, 0), coalesce(v_premium, 0))
    on conflict (operator_user_id) do update
    set
      xp_total = public.operator_progression.xp_total + coalesce(v_xp, 0),
      soft_tokens = public.operator_progression.soft_tokens + coalesce(v_soft, 0),
      premium_tokens = public.operator_progression.premium_tokens + coalesce(v_premium, 0),
      level = greatest(1, floor((public.operator_progression.xp_total + coalesce(v_xp, 0)) / 1000) + 1),
      updated_at = now();

    new.rewarded_at = now();
  end if;

  return new;
end;
$$;

create trigger trg_reward_mission_completion
before update on public.operator_mission_progress
for each row execute function public.sync_progression_from_mission_completion();

create or replace function public.purchase_store_item(target_store_item uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operator uuid := auth.uid();
  v_store public.store_catalog%rowtype;
  v_purchase_id uuid := gen_random_uuid();
begin
  if v_operator is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_store
  from public.store_catalog
  where id = target_store_item
    and is_active = true;

  if v_store.id is null then
    raise exception 'Store item not found';
  end if;

  update public.operator_progression op
  set
    soft_tokens = op.soft_tokens - v_store.soft_token_price,
    premium_tokens = op.premium_tokens - v_store.premium_token_price,
    updated_at = now()
  where op.operator_user_id = v_operator
    and op.soft_tokens >= v_store.soft_token_price
    and op.premium_tokens >= v_store.premium_token_price;

  if not found then
    raise exception 'Insufficient balance';
  end if;

  insert into public.store_purchases (
    id,
    operator_user_id,
    store_item_id,
    paid_soft_tokens,
    paid_premium_tokens
  )
  values (
    v_purchase_id,
    v_operator,
    v_store.id,
    v_store.soft_token_price,
    v_store.premium_token_price
  );

  insert into public.operator_inventory (
    operator_user_id,
    cosmetic_id,
    animation_id,
    granted_by,
    equipped
  )
  values (
    v_operator,
    v_store.cosmetic_id,
    v_store.animation_id,
    'store_purchase',
    false
  );

  return v_purchase_id;
end;
$$;

alter table public.operator_progression enable row level security;
alter table public.missions enable row level security;
alter table public.operator_mission_progress enable row level security;
alter table public.id_cosmetics enable row level security;
alter table public.id_animations enable row level security;
alter table public.operator_inventory enable row level security;
alter table public.operator_id_loadout enable row level security;
alter table public.achievements enable row level security;
alter table public.operator_achievements enable row level security;
alter table public.store_catalog enable row level security;
alter table public.store_purchases enable row level security;

create policy progression_read_own
on public.operator_progression
for select
using (operator_user_id = auth.uid() or public.is_super_admin());

create policy progression_insert_own
on public.operator_progression
for insert
with check (operator_user_id = auth.uid() or public.is_super_admin());

create policy progression_update_admin_only
on public.operator_progression
for update
using (public.is_super_admin())
with check (public.is_super_admin());

create policy missions_read_all
on public.missions
for select
using (is_active = true or public.is_super_admin());

create policy missions_manage_admin
on public.missions
for all
using (public.is_super_admin())
with check (public.is_super_admin());

create policy mission_progress_read_own
on public.operator_mission_progress
for select
using (operator_user_id = auth.uid() or public.is_super_admin());

create policy mission_progress_write_system
on public.operator_mission_progress
for all
using (public.is_super_admin())
with check (public.is_super_admin());

create policy cosmetics_read_all
on public.id_cosmetics
for select
using (is_active = true or public.is_super_admin());

create policy animations_read_all
on public.id_animations
for select
using (is_active = true or public.is_super_admin());

create policy inventory_read_own
on public.operator_inventory
for select
using (operator_user_id = auth.uid() or public.is_super_admin());

create policy inventory_manage_admin
on public.operator_inventory
for all
using (public.is_super_admin())
with check (public.is_super_admin());

create policy loadout_read_own
on public.operator_id_loadout
for select
using (operator_user_id = auth.uid() or public.is_super_admin());

create policy loadout_write_own
on public.operator_id_loadout
for all
using (operator_user_id = auth.uid())
with check (operator_user_id = auth.uid());

create policy achievements_read_all
on public.achievements
for select
using (true);

create policy operator_achievements_read_own
on public.operator_achievements
for select
using (operator_user_id = auth.uid() or public.is_super_admin());

create policy operator_achievements_manage_admin
on public.operator_achievements
for all
using (public.is_super_admin())
with check (public.is_super_admin());

create policy store_catalog_read_all
on public.store_catalog
for select
using (is_active = true or public.is_super_admin());

create policy store_catalog_manage_admin
on public.store_catalog
for all
using (public.is_super_admin())
with check (public.is_super_admin());

create policy purchases_read_own
on public.store_purchases
for select
using (operator_user_id = auth.uid() or public.is_super_admin());

create policy purchases_insert_own
on public.store_purchases
for insert
with check (operator_user_id = auth.uid() or public.is_super_admin());

create index idx_missions_frequency on public.missions (frequency, is_active);
create index idx_operator_mission_progress_operator on public.operator_mission_progress (operator_user_id, mission_id);
create index idx_inventory_operator on public.operator_inventory (operator_user_id, granted_at desc);
create index idx_store_catalog_active on public.store_catalog (is_active, item_type);
create index idx_store_purchases_operator on public.store_purchases (operator_user_id, purchased_at desc);
