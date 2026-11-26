-- The few Supabase pieces a THE BEST backup refers to, so it can be restored into a plain, empty Postgres
-- for the monthly restore test. A real Supabase project already has all of these.
create schema if not exists auth;
create schema if not exists extensions;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

create table if not exists auth.users (id uuid primary key);
create table if not exists auth.identities (id uuid primary key, user_id uuid);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
