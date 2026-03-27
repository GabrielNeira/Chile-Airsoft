-- Hotfix: allow editing legacy profiles without rut_fingerprint,
-- while still requiring identity fields for new inserts.

alter table public.operator_profiles
  drop constraint if exists operator_profiles_rut_fingerprint_required_chk;

alter table public.operator_profiles
  drop constraint if exists operator_profiles_id_card_photo_required_chk;

create or replace function public.tg_require_identity_on_insert()
returns trigger
language plpgsql
as $$
begin
  if new.rut_fingerprint is null then
    raise exception 'RUT fingerprint is required for new operator profile';
  end if;

  if length(trim(coalesce(new.id_card_photo_url, ''))) = 0 then
    raise exception 'ID card photo URL is required for new operator profile';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_require_identity_on_insert on public.operator_profiles;
create trigger trg_require_identity_on_insert
before insert on public.operator_profiles
for each row execute function public.tg_require_identity_on_insert();
