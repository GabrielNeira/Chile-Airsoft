-- ChileAirsoft / Hotfix de Políticas RLS para Superadmins
-- Objetivo: permitir a los Superadministradores actualizar cualquier perfil de operador y administrar asignaciones de canchas directamente.

-- 1) Habilitar actualización de cualquier perfil de operador por parte de Superadmins
drop policy if exists operator_profiles_update_admin on public.operator_profiles;
create policy operator_profiles_update_admin
on public.operator_profiles
for update
using (public.can_manage_roles())
with check (public.can_manage_roles());

-- 2) Habilitar consulta de asignaciones de administrador de cancha
drop policy if exists field_admins_select_admin on public.field_admins;
create policy field_admins_select_admin
on public.field_admins
for select
using (public.can_manage_field_admins_by_email() or user_id = auth.uid());

-- 3) Habilitar modificación total de asignaciones de cancha por parte de Superadmins
drop policy if exists field_admins_write_admin on public.field_admins;
create policy field_admins_write_admin
on public.field_admins
for all
using (public.can_manage_field_admins_by_email())
with check (public.can_manage_field_admins_by_email());
