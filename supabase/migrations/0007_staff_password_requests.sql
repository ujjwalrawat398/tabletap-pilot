-- =====================================================================
-- TableTap — 0007 staff password-change requests
-- Waiter / kitchen staff cannot change their own password directly: they
-- file a request, an admin approves or rejects it. The requested password
-- is stored ENCRYPTED (AES-256-GCM, key derived from SESSION_SECRET) only
-- until the admin decides, then the column is wiped.
-- Idempotent. Safe to re-run.
-- =====================================================================
create table if not exists staff_password_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  staff_id uuid not null references staff_profiles(id) on delete cascade,
  new_password_enc text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  decided_at timestamptz,
  -- staff_profiles.id of the admin (no FK: admins can be deleted later)
  decided_by uuid,
  decision_note text,
  requested_from_ip text
);

-- one open request per person; a new one replaces the old
create unique index if not exists staff_password_one_pending
  on staff_password_requests (staff_id) where status = 'pending';

create index if not exists staff_password_requests_restaurant_idx
  on staff_password_requests (restaurant_id, status, requested_at desc);

-- holds an encrypted secret: API role (service) only, never anon / authenticated
alter table staff_password_requests enable row level security;
revoke all on staff_password_requests from anon, authenticated;
