-- Team logo support for operator IDs
-- Run after db/supabase_schema.sql

alter table public.operator_profiles
  add column if not exists team_logo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'operator-team-logos',
  'operator-team-logos',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
on conflict (id) do nothing;

drop policy if exists team_logo_insert_own on storage.objects;
create policy team_logo_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'operator-team-logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists team_logo_update_own on storage.objects;
create policy team_logo_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'operator-team-logos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'operator-team-logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists team_logo_read_public on storage.objects;
create policy team_logo_read_public
on storage.objects
for select
to public
using (bucket_id = 'operator-team-logos');
