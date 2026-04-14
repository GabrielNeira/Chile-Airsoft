-- Reporte consolidado para el mantenedor GOD.
-- Incluye usuarios visibles por perfil/identidad/roles, roles agregados y busqueda paginada.

create or replace function public.god_user_maintainer_report(
  p_search text default null,
  p_limit integer default 500,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  email_masked text,
  nickname text,
  real_name text,
  blood_group text,
  operator_role text,
  team text,
  roles text[],
  roles_label text,
  profile_created_at timestamptz,
  identity_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role_column text;
  v_has_user_roles_table boolean := false;
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 2000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_sql text;
begin
  if not (public.can_manage_roles() or public.can_manage_field_admins_by_email()) then
    raise exception 'Only GOD administrators can view this report';
  end if;

  select exists (
    select 1
    from information_schema.tables t
    where t.table_schema = 'public'
      and t.table_name = 'user_roles'
  ) into v_has_user_roles_table;

  if v_has_user_roles_table then
    select c.column_name
    into v_role_column
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'user_roles'
      and c.column_name not in ('id', 'user_id', 'created_at', 'updated_at')
      and (
        c.column_name in ('role', 'user_role', 'field_user_role', 'app_role')
        or c.column_name ilike '%role%'
      )
    order by case
      when c.column_name = 'role' then 1
      when c.column_name = 'user_role' then 2
      when c.column_name = 'field_user_role' then 3
      when c.column_name = 'app_role' then 4
      else 10
    end,
    c.ordinal_position
    limit 1;
  end if;

  if v_role_column is not null then
    v_sql := format($fmt$
      with role_agg as (
        select
          ur.user_id,
          array_agg(distinct ur.%1$I::text order by ur.%1$I::text) as roles
        from public.user_roles ur
        group by ur.user_id
      ),
      base_users as (
        select op.user_id from public.operator_profiles op
        union
        select ri.user_id from public.rut_identities ri
        union
        select ra.user_id from role_agg ra
        union
        select au.id as user_id
        from auth.users au
      )
      select
        bu.user_id,
        coalesce(ri.email::text, lower(au.email), 'sin-email') as email,
        case
          when coalesce(ri.email::text, lower(au.email)) is null then '***@***'
          else public.mask_email(coalesce(ri.email::text, lower(au.email)))
        end as email_masked,
        coalesce(op.nickname, 'sin-nickname') as nickname,
        coalesce(op.real_name, 'sin-nombre') as real_name,
        coalesce(op.blood_group::text, 'N/D') as blood_group,
        coalesce(op.operator_role::text, 'other') as operator_role,
        coalesce(op.team, 'Sin equipo') as team,
        coalesce(ra.roles, array[]::text[]) as roles,
        case
          when coalesce(array_length(ra.roles, 1), 0) = 0 then 'sin roles'
          else array_to_string(ra.roles, ', ')
        end as roles_label,
        op.created_at as profile_created_at,
        ri.updated_at as identity_updated_at
      from base_users bu
      left join public.operator_profiles op
        on op.user_id = bu.user_id
      left join public.rut_identities ri
        on ri.user_id = bu.user_id
      left join auth.users au
        on au.id = bu.user_id
      left join role_agg ra
        on ra.user_id = bu.user_id
      where (
        $1 is null
        or coalesce(ri.email::text, lower(au.email), '') ilike '%%' || $1 || '%%'
        or coalesce(op.nickname, '') ilike '%%' || $1 || '%%'
        or coalesce(op.real_name, '') ilike '%%' || $1 || '%%'
        or bu.user_id::text ilike '%%' || $1 || '%%'
        or exists (
          select 1
          from unnest(coalesce(ra.roles, array[]::text[])) as role_item
          where role_item ilike '%%' || $1 || '%%'
        )
      )
      order by coalesce(op.created_at, ri.updated_at, now()) desc, bu.user_id
      limit $2
      offset $3
    $fmt$, v_role_column);
  else
    v_sql := $sql$
      with role_agg as (
        select null::uuid as user_id, array[]::text[] as roles
        where false
      ),
      base_users as (
        select op.user_id from public.operator_profiles op
        union
        select ri.user_id from public.rut_identities ri
        union
        select au.id as user_id
        from auth.users au
      )
      select
        bu.user_id,
        coalesce(ri.email::text, lower(au.email), 'sin-email') as email,
        case
          when coalesce(ri.email::text, lower(au.email)) is null then '***@***'
          else public.mask_email(coalesce(ri.email::text, lower(au.email)))
        end as email_masked,
        coalesce(op.nickname, 'sin-nickname') as nickname,
        coalesce(op.real_name, 'sin-nombre') as real_name,
        coalesce(op.blood_group::text, 'N/D') as blood_group,
        coalesce(op.operator_role::text, 'other') as operator_role,
        coalesce(op.team, 'Sin equipo') as team,
        array[]::text[] as roles,
        'sin roles' as roles_label,
        op.created_at as profile_created_at,
        ri.updated_at as identity_updated_at
      from base_users bu
      left join public.operator_profiles op
        on op.user_id = bu.user_id
      left join public.rut_identities ri
        on ri.user_id = bu.user_id
      left join auth.users au
        on au.id = bu.user_id
      where (
        $1 is null
        or coalesce(ri.email::text, lower(au.email), '') ilike '%' || $1 || '%'
        or coalesce(op.nickname, '') ilike '%' || $1 || '%'
        or coalesce(op.real_name, '') ilike '%' || $1 || '%'
        or bu.user_id::text ilike '%' || $1 || '%'
      )
      order by coalesce(op.created_at, ri.updated_at, now()) desc, bu.user_id
      limit $2
      offset $3
    $sql$;
  end if;

  return query execute v_sql using v_search, v_limit, v_offset;
end;
$$;

grant execute on function public.god_user_maintainer_report(text, integer, integer) to authenticated;
grant execute on function public.god_user_maintainer_report(text, integer, integer) to service_role;

-- Ejemplos:
-- select * from public.god_user_maintainer_report();
-- select * from public.god_user_maintainer_report('homura', 50, 0);
-- select * from public.god_user_maintainer_report('field_admin', 200, 0);
