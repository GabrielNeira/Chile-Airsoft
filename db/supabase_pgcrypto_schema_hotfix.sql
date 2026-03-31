-- Hotfix: resolve pgcrypto functions regardless of extension schema
-- Use when you get errors like:
--   function digest(...) does not exist
--   function pgp_sym_encrypt(text, text) does not exist

create extension if not exists pgcrypto;

create or replace function public.normalize_rut(p_rut text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p_rut, ''), '[^0-9kK]', '', 'g'));
$$;

create or replace function public.compute_rut_fingerprint(p_rut text, p_secret_key text)
returns text
language plpgsql
stable
as $$
declare
  v_input text := public.normalize_rut(p_rut) || ':' || p_secret_key;
  v_ext_schema text;
  v_hash text;
begin
  select n.nspname into v_ext_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto'
  limit 1;

  if v_ext_schema is null then
    raise exception 'pgcrypto extension is required';
  end if;

  execute format(
    'select encode(%I.digest($1::text, ''sha256''::text), ''hex'')',
    v_ext_schema
  ) into v_hash using v_input;

  return v_hash;
end;
$$;

create or replace function public.encrypt_rut(plain_rut text, secret_key text)
returns bytea
language plpgsql
stable
as $$
declare
  v_ext_schema text;
  v_cipher bytea;
begin
  select n.nspname into v_ext_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto'
  limit 1;

  if v_ext_schema is null then
    raise exception 'pgcrypto extension is required';
  end if;

  execute format(
    'select %I.pgp_sym_encrypt($1::text, $2::text)::bytea',
    v_ext_schema
  ) into v_cipher using plain_rut, secret_key;

  return v_cipher;
end;
$$;

create or replace function public.decrypt_rut(cipher_rut bytea, secret_key text)
returns text
language plpgsql
stable
as $$
declare
  v_ext_schema text;
  v_plain text;
begin
  select n.nspname into v_ext_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto'
  limit 1;

  if v_ext_schema is null then
    raise exception 'pgcrypto extension is required';
  end if;

  execute format(
    'select %I.pgp_sym_decrypt($1::bytea, $2::text)',
    v_ext_schema
  ) into v_plain using cipher_rut, secret_key;

  return v_plain;
end;
$$;
