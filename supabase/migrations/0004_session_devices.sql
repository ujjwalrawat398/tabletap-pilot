-- =====================================================================
-- TableTap — 0004 multi-device table sessions
-- A table visit is ONE session shared by everyone at the table, but each
-- phone needs its own credential so "join" does not kick the first guest
-- out. Each device gets its own random token; only its SHA-256 hash is
-- stored, exactly like table_sessions.token_hash.
-- =====================================================================
create table if not exists table_session_devices (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  session_id uuid not null references table_sessions(id) on delete cascade,
  token_hash text not null unique,
  guest_no integer not null check (guest_no between 1 and 50),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (session_id, guest_no)
);

create index if not exists table_session_devices_session_idx on table_session_devices(session_id);

alter table table_session_devices enable row level security;

drop policy if exists table_session_devices_staff_read on table_session_devices;
create policy table_session_devices_staff_read on table_session_devices
  for select to authenticated using (restaurant_id = auth_restaurant_id());

revoke all on table_session_devices from anon;
