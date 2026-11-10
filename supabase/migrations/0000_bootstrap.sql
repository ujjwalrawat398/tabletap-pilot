-- =====================================================================
-- TableTap — 0000 bootstrap
-- Creates the pieces Supabase already provides (roles, auth schema,
-- auth.uid()) so the same migrations run on plain PostgreSQL, PGlite
-- (local dev) and Supabase. Every statement is guarded, so running this
-- on Supabase is a no-op.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon noinherit nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated noinherit nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role noinherit nologin bypassrls;
  end if;
end $$;

create schema if not exists auth;

-- Local stand-in for Supabase's auth.uid(). On Supabase this already exists
-- and the block below is skipped, so real JWT claims are always used there.
do $do$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $fn$create function auth.uid() returns uuid language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid'$fn$;
    execute $fn$create function auth.role() returns text language sql stable
      as 'select coalesce(nullif(current_setting(''request.jwt.claim.role'', true), ''''), ''anon'')'$fn$;
    execute $fn$create function auth.email() returns text language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.email'', true), '''')'$fn$;
  end if;
end $do$;

grant usage on schema auth to anon, authenticated, service_role;
