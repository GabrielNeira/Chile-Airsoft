-- Hotfix: revocacion robusta de roles en esquemas mixtos (role/user_role/...)
-- Caso objetivo: permitir revocar super_admin (Admin GOD) cuando existan columnas legacy.

create or replace function public.revoke_role(
  p_user_email text,
  p_role text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(coalesce(p_user_email, '')));
  v_role text := public.normalize_field_user_role_input(p_role);
  v_target_user_id uuid;
  v_role_columns text[] := array[]::text[];
  v_role_match_condition text := '';
  v_super_admin_condition text := '';
  v_known_columns text;
  v_applied integer := 0;
  v_super_admin_count integer := 0;
  v_executed_by uuid := auth.uid();
  v_executed_by_email text := null;
begin
  if not public.can_manage_roles() then
    raise exception 'Only super_admin can manage roles';
  end if;

  if v_email = '' then
    raise exception 'p_user_email is required';
  end if;

  select u.id
  into v_target_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_target_user_id is null then
    raise exception 'User not found for email: %', v_email;
  end if;

  if v_executed_by is not null then
    select u.email
    into v_executed_by_email
    from auth.users u
    where u.id = v_executed_by
    limit 1;
  else
    v_executed_by_email := current_user;
  end if;

  select coalesce(array_agg(c.column_name order by
    case
      when c.column_name = 'role' then 1
      when c.column_name = 'user_role' then 2
      when c.column_name = 'field_user_role' then 3
      when c.column_name = 'app_role' then 4
      else 10
    end,
    c.ordinal_position), array[]::text[])
  into v_role_columns
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'user_roles'
    and c.column_name not in ('id', 'user_id', 'created_at', 'updated_at')
    and (
      c.column_name in ('role', 'user_role', 'field_user_role', 'app_role')
      or c.column_name ilike '%role%'
    );

  if coalesce(array_length(v_role_columns, 1), 0) = 0 then
    select string_agg(c.column_name, ', ' order by c.ordinal_position)
    into v_known_columns
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'user_roles';

    raise exception 'user_roles table does not contain a supported role column. Columns: %', coalesce(v_known_columns, '(none)');
  end if;

  select string_agg(
    format('lower(trim(coalesce(ur.%I::text, ''''))) = %L', col, 'super_admin'),
    ' or '
  )
  into v_super_admin_condition
  from unnest(v_role_columns) as col;

  if v_role = 'super_admin' then
    if auth.uid() is not null and auth.uid() = v_target_user_id then
      raise exception 'Cannot self-revoke super_admin';
    end if;

    execute format(
      'select count(distinct ur.user_id)
       from public.user_roles ur
       where %s',
      v_super_admin_condition
    )
    into v_super_admin_count;

    if v_super_admin_count <= 1 then
      raise exception 'Cannot revoke last super_admin';
    end if;
  end if;

  select string_agg(
    format('lower(trim(coalesce(%I::text, ''''))) = lower(trim(%L))', col, v_role),
    ' or '
  )
  into v_role_match_condition
  from unnest(v_role_columns) as col;

  execute format(
    'delete from public.user_roles
     where user_id = $1
       and (%s)',
    v_role_match_condition
  )
  using v_target_user_id;

  get diagnostics v_applied = row_count;

  insert into public.role_admin_audit (
    target_user_id,
    target_email,
    role_text,
    action,
    reason,
    executed_by,
    executed_by_email
  )
  values (
    v_target_user_id,
    v_email,
    v_role,
    'revoke',
    p_reason,
    v_executed_by,
    v_executed_by_email
  );

  if v_applied = 0 then
    return jsonb_build_object(
      'status', 'not_assigned',
      'email', v_email,
      'role', v_role,
      'user_id', v_target_user_id
    );
  end if;

  return jsonb_build_object(
    'status', 'revoked',
    'email', v_email,
    'role', v_role,
    'user_id', v_target_user_id,
    'rows_affected', v_applied
  );
end;
$$;

grant execute on function public.revoke_role(text, text, text) to authenticated;
grant execute on function public.revoke_role(text, text, text) to service_role;

-- Verificacion sugerida:
-- select public.revoke_role('correo@ejemplo.cl', 'super_admin', 'Revocacion desde Admin GOD');
