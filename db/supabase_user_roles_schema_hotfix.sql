-- Hotfix de esquema para public.user_roles
-- Problema observado: la tabla solo tiene (id, user_id, created_at),
-- por eso grant_role/revoke_role fallan al no encontrar columna de rol.

-- 1) Asegurar columna role utilizable por funciones admin
alter table if exists public.user_roles
  add column if not exists role text;

-- 2) Si existe columna legacy user_role, migrar datos hacia role
--    (solo donde role aun sea null/vacio)
do $$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'user_roles'
      and c.column_name = 'user_role'
  ) then
    execute $sql$
      update public.user_roles ur
      set role = case
        when lower(trim(coalesce(ur.user_role::text, ''))) in ('admin','superadmin','super_admin','platform_admin') then 'super_admin'
        when lower(trim(coalesce(ur.user_role::text, ''))) in ('organizer') then 'organizer'
        when lower(trim(coalesce(ur.user_role::text, ''))) in ('field_admin','fieldadmin') then 'field_admin'
        when lower(trim(coalesce(ur.user_role::text, ''))) in ('player') then 'player'
        else null
      end
      where (ur.role is null or trim(ur.role) = '')
    $sql$;
  end if;
end;
$$;

-- 3) Normalizar valores role existentes a los permitidos
do $$
begin
  update public.user_roles ur
  set role = case
    when lower(trim(coalesce(ur.role, ''))) in ('admin','superadmin','super_admin','platform_admin') then 'super_admin'
    when lower(trim(coalesce(ur.role, ''))) in ('organizer') then 'organizer'
    when lower(trim(coalesce(ur.role, ''))) in ('field_admin','fieldadmin') then 'field_admin'
    when lower(trim(coalesce(ur.role, ''))) in ('player') then 'player'
    else 'player'
  end;
end;
$$;

-- 4) Evitar null/empty en role
update public.user_roles
set role = 'player'
where role is null or trim(role) = '';

alter table public.user_roles
  alter column role set not null;

-- 5) Duplicados por (user_id, role): conservar el mas reciente
do $$
begin
  with ranked as (
    select
      ctid,
      row_number() over (
        partition by user_id, role
        order by created_at desc nulls last, id desc
      ) as rn
    from public.user_roles
  )
  delete from public.user_roles ur
  using ranked r
  where ur.ctid = r.ctid
    and r.rn > 1;
end;
$$;

-- 6) Restriccion de dominio y unicidad para soporte de grant/revoke
alter table public.user_roles
  drop constraint if exists user_roles_role_allowed;

alter table public.user_roles
  add constraint user_roles_role_allowed
  check (role in ('player', 'field_admin', 'organizer', 'super_admin'));

create unique index if not exists idx_user_roles_user_role_unique
  on public.user_roles (user_id, role);

-- Verificacion sugerida:
-- select column_name, data_type, udt_name
-- from information_schema.columns
-- where table_schema='public' and table_name='user_roles'
-- order by ordinal_position;
--
-- select * from public.grant_role('sebastian.andres.official@gmail.com', 'field_admin', 'Alta desde Admin GOD');
-- select * from public.revoke_role('sebastian.andres.official@gmail.com', 'field_admin', 'Revocacion de prueba');
