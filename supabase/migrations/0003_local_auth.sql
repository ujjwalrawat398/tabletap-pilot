-- =====================================================================
-- TableTap — 0003 local (non-Supabase) staff credentials
-- Supabase deployments use Supabase Auth instead, so this table simply
-- stays empty there. On local/self-hosted Postgres it lets the demo run
-- with hashed passwords (scrypt, done in the app — no secrets in SQL).
-- =====================================================================
create table if not exists staff_credentials (
  user_id uuid primary key references staff_profiles(id) on delete cascade,
  password_hash text not null,
  must_reset boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
alter table staff_credentials enable row level security;
revoke all on staff_credentials from anon, authenticated;
