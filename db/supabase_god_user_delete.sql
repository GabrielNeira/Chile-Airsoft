-- Eliminacion total de usuario para mantenedor GOD.
-- Borra referencias public.* que apuntan a auth.users(id) y luego elimina auth.users.

create or replace function public.god_delete_user_totally(
  p_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  rec record;
  v_exists boolean := false;
  v_email text := null;
  v_requester uuid := auth.uid();
  v_deleted_rows bigint := 0;
  v_deleted_rows_step bigint := 0;
  v_result jsonb;
begin
  if not (public.can_manage_roles() or public.can_manage_field_admins_by_email()) then
    raise exception 'Only GOD administrators can delete users';
  end if;

  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if v_requester is not null and v_requester = p_user_id then
    raise exception 'Cannot delete your own account from this maintainer';
  end if;

  select true, lower(coalesce(u.email, ''))
  into v_exists, v_email
  from auth.users u
  where u.id = p_user_id
  limit 1;

  if not coalesce(v_exists, false) then
    raise exception 'User not found: %', p_user_id;
  end if;

  -- Elimina en todas las tablas public.* con FK a auth.users(id), para evitar RESTRICT.
  for rec in
    select
      kcu.table_schema,
      kcu.table_name,
      kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
     and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and ccu.table_schema = 'auth'
      and ccu.table_name = 'users'
      and ccu.column_name = 'id'
      and kcu.table_schema = 'public'
  loop
    execute format(
      'delete from %I.%I where %I = $1',
      rec.table_schema,
      rec.table_name,
      rec.column_name
    )
    using p_user_id;

    get diagnostics v_deleted_rows_step = row_count;
    v_deleted_rows := v_deleted_rows + v_deleted_rows_step;
  end loop;

  delete from auth.users u
  where u.id = p_user_id;

  if not found then
    raise exception 'Failed to delete user in auth.users: %', p_user_id;
  end if;

  v_result := jsonb_build_object(
    'status', 'deleted',
    'user_id', p_user_id,
    'email', v_email,
    'deleted_public_rows', v_deleted_rows,
    'reason', p_reason
  );

  return v_result;
end;
$$;

grant execute on function public.god_delete_user_totally(uuid, text) to authenticated;
grant execute on function public.god_delete_user_totally(uuid, text) to service_role;

-- Ejemplo:
-- select public.god_delete_user_totally('00000000-0000-0000-0000-000000000000', 'Depuracion admin god');
