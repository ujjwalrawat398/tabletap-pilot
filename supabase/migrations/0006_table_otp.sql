-- 0006_table_otp.sql
-- Waiter-issued table code (OTP).
--
-- A photographed QR/NFC sticker must no longer grant a session by itself. A scan
-- only *raises* a code that is displayed on staff screens; the guest proves they
-- are physically at the table by typing it. Two clocks:
--
--   code     : life = code_window_minutes (default 10), reused by everyone at the
--              table, dies on 5 wrong guesses / dismiss / regenerate / table close
--   session  : life = idle timeout (90 min, slid by activity) and hard cap (4 h),
--              dies when the waiter closes the table
--
-- The code is stored in plain text on purpose: a waiter has to read it off the
-- screen. It is never logged, never sent to a customer endpoint, and the cron job
-- deletes rows 24 h after the window closed.

-- ---------- settings (admin editable, validated in the app) --------------
alter table restaurants add column if not exists otp_length smallint not null default 4;
alter table restaurants add column if not exists otp_window_minutes integer not null default 10;
alter table restaurants add column if not exists otp_max_attempts integer not null default 5;
alter table restaurants add column if not exists otp_reissue_cooldown_seconds integer not null default 60;
alter table restaurants add column if not exists max_devices_per_session integer not null default 12;
alter table restaurants add column if not exists session_idle_minutes integer not null default 90;
alter table restaurants add column if not exists session_max_hours integer not null default 4;
alter table restaurants add column if not exists auto_confirm_orders boolean not null default false;
alter table restaurants add column if not exists menu_preview_before_code boolean not null default true;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_otp_length_check') then
    alter table restaurants
      add constraint restaurants_otp_length_check check (otp_length between 4 and 6),
      add constraint restaurants_otp_window_check check (otp_window_minutes between 3 and 30),
      add constraint restaurants_otp_attempts_check check (otp_max_attempts between 3 and 10),
      add constraint restaurants_otp_cooldown_check check (otp_reissue_cooldown_seconds between 0 and 300),
      add constraint restaurants_devices_check check (max_devices_per_session between 4 and 20),
      add constraint restaurants_idle_check check (session_idle_minutes between 30 and 240),
      add constraint restaurants_max_hours_check check (session_max_hours between 1 and 8);
  end if;
end
$do$;

-- ---------- live codes ---------------------------------------------------
create table if not exists table_otps (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  -- plain text: the waiter has to read it. Never audited, never exported.
  code text not null,
  attempts integer not null default 0,
  -- set the first time a correct code admits a guest: distinguishes "a card nobody
  -- has read out yet" from "these phones joined with it"
  verified_at timestamptz,
  expires_at timestamptz not null,
  invalidated_at timestamptz,
  invalidated_reason text,
  requested_from_ip text,
  -- the staff_profiles row of whoever dismissed it (no FK: profiles are deleted by
  -- the admin screen, and a dead code must never block a staff deletion)
  dismissed_by uuid,
  -- the visit this code opened, once a guest verifies (used by "new party")
  session_id uuid references table_sessions(id) on delete set null,
  created_at timestamptz not null default now()
);

-- one live code per table at a time
create unique index if not exists table_otps_one_live_per_table
  on table_otps (table_id)
  where invalidated_at is null;

create index if not exists table_otps_table_created_idx on table_otps (table_id, created_at desc);
-- cleanup scan for the cron job
create index if not exists table_otps_expiry_idx on table_otps (expires_at);

alter table table_otps enable row level security;
-- staff of the owning restaurant may read/write through the API role only
drop policy if exists table_otps_staff on table_otps;
create policy table_otps_staff on table_otps
  for all
  using (restaurant_id = auth_restaurant_id())
  with check (restaurant_id = auth_restaurant_id());
revoke all on table_otps from anon;

-- staff heartbeat: lets the guest screen say "please call a staff member" when no
-- waiter device has polled for a minute (test E8)
alter table staff_profiles add column if not exists last_seen_at timestamptz not null default now();

-- ---------- session bookkeeping for the two clocks ----------------------
alter table table_sessions add column if not exists last_activity_at timestamptz not null default now();
alter table table_sessions add column if not exists hard_expires_at timestamptz;
-- the code that opened this visit (nullable for pre-existing rows)
alter table table_sessions add column if not exists otp_id uuid references table_otps(id) on delete set null;

-- backfill the hard cap for rows created before this migration
update table_sessions set hard_expires_at = created_at + interval '4 hours' where hard_expires_at is null;
