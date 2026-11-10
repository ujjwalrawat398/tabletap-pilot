-- =====================================================================
-- TableTap — 0001 initial schema
-- Portable PostgreSQL (works on Supabase, plain Postgres, and PGlite).
-- Every restaurant-scoped table carries restaurant_id => multi-tenant ready.
-- =====================================================================

-- gen_random_uuid() is built into PostgreSQL 13+, no extension required.
do $do$ begin
  begin
    create extension if not exists pgcrypto;
  exception when others then
    raise notice 'pgcrypto unavailable, using built-in gen_random_uuid()';
  end;
end $do$;

-- ---------- helpers -------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Effective selling price: offer price wins only while active and lower.
create or replace function effective_price(
  p_price numeric, p_offer numeric, p_start timestamptz, p_end timestamptz
) returns numeric language sql immutable as $$
  select coalesce(
    case
      when p_offer is not null
       and p_offer < p_price
       and (p_start is null or p_start <= now())
       and (p_end   is null or p_end   >= now())
      then p_offer
    end,
    p_price
  );
$$;

-- ---------- enums ---------------------------------------------------
create type staff_role      as enum ('admin', 'waiter', 'kitchen');
create type table_status    as enum ('free', 'occupied');
create type order_status    as enum ('pending', 'confirmed', 'rejected', 'preparing', 'ready', 'served', 'cancelled');
create type waiter_call_type as enum ('call', 'bill');
create type waiter_call_status as enum ('open', 'handled');
create type feedback_status as enum ('new', 'read', 'resolved');
create type game_mode       as enum ('solo', 'table', 'restaurant');
create type game_round_status as enum ('lobby', 'active', 'finished');

-- ---------- restaurants ---------------------------------------------
create table restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  accent_color text not null default '#e85d2a',
  currency text not null default 'INR',
  timezone text not null default 'Asia/Kolkata',
  -- contact / marketing
  phone text,
  address text,
  -- wifi card
  wifi_ssid text,
  wifi_password text,
  wifi_security text default 'WPA',
  -- review routing
  google_review_url text,
  instagram_url text,
  facebook_url text,
  website_url text,
  -- billing
  tax_percent numeric(5,2) not null default 0,
  service_charge_percent numeric(5,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger restaurants_updated before update on restaurants
  for each row execute function set_updated_at();

-- ---------- staff ---------------------------------------------------
-- NOTE: on Supabase, user_id references auth.users(id) — see 0002_supabase_auth.sql
create table staff_profiles (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  user_id uuid not null unique,
  email text not null,
  full_name text not null,
  role staff_role not null default 'waiter',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index staff_profiles_restaurant_idx on staff_profiles(restaurant_id);
create unique index staff_profiles_restaurant_email_idx on staff_profiles(restaurant_id, lower(email));
create trigger staff_profiles_updated before update on staff_profiles
  for each row execute function set_updated_at();

-- ---------- tables --------------------------------------------------
create table tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  number integer not null,
  label text,
  seats integer not null default 4,
  zone text,
  -- long random public code printed on the tag / QR (never the number)
  table_code text not null unique,
  status table_status not null default 'free',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index tables_restaurant_number_idx on tables(restaurant_id, number);
create trigger tables_updated before update on tables
  for each row execute function set_updated_at();

-- ---------- table sessions ------------------------------------------
create table table_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  -- ONLY the sha256 hash of the token is ever stored
  token_hash text not null unique,
  expires_at timestamptz not null,
  closed_at timestamptz,
  closed_reason text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index table_sessions_table_idx on table_sessions(table_id);
create index table_sessions_open_idx on table_sessions(table_id) where closed_at is null;

-- ---------- menu ----------------------------------------------------
create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name text not null,
  description text,
  emoji text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index menu_categories_restaurant_idx on menu_categories(restaurant_id);
create trigger menu_categories_updated before update on menu_categories
  for each row execute function set_updated_at();

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  category_id uuid not null references menu_categories(id) on delete cascade,
  name text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  offer_price numeric(10,2) check (offer_price is null or offer_price >= 0),
  offer_start timestamptz,
  offer_end timestamptz,
  is_available boolean not null default true,   -- sold-out toggle
  is_veg boolean not null default true,
  image_url text,
  spice_level smallint not null default 0,
  prep_minutes integer not null default 10,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index menu_items_restaurant_idx on menu_items(restaurant_id);
create index menu_items_category_idx on menu_items(category_id);
create trigger menu_items_updated before update on menu_items
  for each row execute function set_updated_at();

-- public projection with the server-side offer logic baked in
create view menu_items_public as
select
  i.id, i.restaurant_id, i.category_id, i.name, i.description,
  i.price, i.offer_price, i.offer_start, i.offer_end,
  i.is_available, i.is_veg, i.image_url, i.spice_level, i.sort_order,
  effective_price(i.price, i.offer_price, i.offer_start, i.offer_end) as effective_price,
  (i.offer_price is not null and i.offer_price < i.price
    and (i.offer_start is null or i.offer_start <= now())
    and (i.offer_end   is null or i.offer_end   >= now())) as offer_active
from menu_items i;

-- ---------- cart (shared per table session) -------------------------
create table carts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  session_id uuid not null unique references table_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger carts_updated before update on carts
  for each row execute function set_updated_at();

create table cart_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  cart_id uuid not null references carts(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  qty integer not null check (qty between 1 and 50),
  notes text,
  added_by_guest integer not null default 1,
  created_at timestamptz not null default now()
);
create index cart_items_cart_idx on cart_items(cart_id);

-- ---------- orders --------------------------------------------------
create table orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  session_id uuid not null references table_sessions(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  batch_no integer not null default 1,
  status order_status not null default 'pending',
  subtotal numeric(10,2) not null default 0,
  tax numeric(10,2) not null default 0,
  service_charge numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  notes text,
  placed_by_guest integer not null default 1,
  confirmed_by uuid,
  confirmed_at timestamptz,
  rejected_reason text,
  preparing_at timestamptz,
  ready_at timestamptz,
  served_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_restaurant_created_idx on orders(restaurant_id, created_at desc);
create index orders_session_idx on orders(session_id);
create index orders_status_idx on orders(restaurant_id, status);
create trigger orders_updated before update on orders
  for each row execute function set_updated_at();

create table order_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id),
  name_snapshot text not null,
  qty integer not null check (qty > 0),
  base_price numeric(10,2) not null,
  unit_price numeric(10,2) not null,      -- server-computed effective price
  offer_applied boolean not null default false,
  notes text,
  added_by_guest integer not null default 1,
  created_at timestamptz not null default now()
);
create index order_items_order_idx on order_items(order_id);

-- ---------- waiter calls --------------------------------------------
create table waiter_calls (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  session_id uuid not null references table_sessions(id) on delete cascade,
  type waiter_call_type not null default 'call',
  status waiter_call_status not null default 'open',
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index waiter_calls_open_idx on waiter_calls(restaurant_id, status, created_at desc);

-- ---------- reviews & feedback --------------------------------------
create table reviews (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  session_id uuid not null unique references table_sessions(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  routed_to text not null,              -- 'google' | 'private'
  created_at timestamptz not null default now()
);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  session_id uuid references table_sessions(id) on delete set null,
  table_id uuid references tables(id) on delete set null,
  rating smallint check (rating between 1 and 5),
  message text not null,
  contact text,
  status feedback_status not null default 'new',
  created_at timestamptz not null default now()
);
create index feedback_restaurant_idx on feedback(restaurant_id, created_at desc);

-- ---------- quizzes & games -----------------------------------------
create table quiz_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name text not null,
  slug text not null,
  emoji text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index quiz_categories_slug_idx on quiz_categories(restaurant_id, slug);

create table quiz_questions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  category_id uuid not null references quiz_categories(id) on delete cascade,
  question text not null,
  options jsonb not null,               -- ["a","b","c","d"]
  correct_index smallint not null check (correct_index between 0 and 3),
  explanation text,
  difficulty smallint not null default 1 check (difficulty between 1 and 3),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint quiz_questions_four_options check (jsonb_array_length(options) = 4)
);
create index quiz_questions_category_idx on quiz_questions(category_id);

create table game_rounds (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  mode game_mode not null,
  status game_round_status not null default 'lobby',
  session_id uuid references table_sessions(id) on delete cascade,   -- table mode
  category_id uuid references quiz_categories(id),
  question_ids uuid[] not null default '{}',
  question_count integer not null default 10,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
create index game_rounds_restaurant_idx on game_rounds(restaurant_id, mode, status);
create unique index game_rounds_lobby_restaurant_idx
  on game_rounds(restaurant_id) where mode = 'restaurant' and status = 'lobby';

create table game_players (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  round_id uuid not null references game_rounds(id) on delete cascade,
  session_id uuid references table_sessions(id) on delete cascade,
  table_id uuid references tables(id) on delete set null,
  guest_no integer not null default 1,
  display_name text not null,
  score integer not null default 0,
  correct_count integer not null default 0,
  answered_count integer not null default 0,
  total_ms integer not null default 0,
  joined_at timestamptz not null default now(),
  unique (round_id, session_id, guest_no)
);
create index game_players_round_idx on game_players(round_id, score desc);

create table game_answers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  round_id uuid not null references game_rounds(id) on delete cascade,
  player_id uuid not null references game_players(id) on delete cascade,
  question_index integer not null,
  question_id uuid not null references quiz_questions(id),
  selected_index smallint not null,
  is_correct boolean not null,
  ms_taken integer not null default 0,
  points integer not null default 0,
  created_at timestamptz not null default now(),
  unique (player_id, question_index)
);
create index game_answers_round_idx on game_answers(round_id, question_index);

-- daily leaderboard rows (table points summed per day, reset daily)
create table game_scores (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  round_id uuid not null references game_rounds(id) on delete cascade,
  session_id uuid references table_sessions(id) on delete set null,
  table_id uuid not null references tables(id) on delete cascade,
  mode game_mode not null,
  points integer not null default 0,
  correct_count integer not null default 0,
  play_date date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);
create index game_scores_daily_idx on game_scores(restaurant_id, play_date desc);

create table prizes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  rank smallint not null check (rank between 1 and 20),
  title text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- settings (key/value per restaurant) ---------------------
create table settings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (restaurant_id, key)
);

-- ---------- audit log -----------------------------------------------
create table audit_log (
  id bigserial primary key,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  actor_id uuid,
  actor_email text,
  action text not null,
  entity text,
  entity_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_restaurant_idx on audit_log(restaurant_id, created_at desc);

-- ---------- push subscriptions --------------------------------------
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  staff_user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- ---------- rate limiting -------------------------------------------
create table rate_limits (
  key text primary key,
  hits integer not null default 0,
  window_start timestamptz not null default now()
);

-- ---------- reports helper view -------------------------------------
create view order_facts as
select
  o.id, o.restaurant_id, o.table_id, o.session_id, o.status,
  o.total, o.subtotal, o.created_at, o.confirmed_at, o.ready_at,
  t.number as table_number,
  (o.created_at at time zone 'Asia/Kolkata')::date as business_date,
  extract(hour from (o.created_at at time zone 'Asia/Kolkata'))::int as hour_of_day
from orders o
join tables t on t.id = o.table_id;

-- ---------- RLS -----------------------------------------------------
alter table restaurants        enable row level security;
alter table staff_profiles     enable row level security;
alter table tables             enable row level security;
alter table table_sessions     enable row level security;
alter table menu_categories    enable row level security;
alter table menu_items         enable row level security;
alter table carts              enable row level security;
alter table cart_items         enable row level security;
alter table orders             enable row level security;
alter table order_items        enable row level security;
alter table waiter_calls       enable row level security;
alter table reviews            enable row level security;
alter table feedback           enable row level security;
alter table quiz_categories    enable row level security;
alter table quiz_questions     enable row level security;
alter table game_rounds        enable row level security;
alter table game_players       enable row level security;
alter table game_answers       enable row level security;
alter table game_scores        enable row level security;
alter table prizes             enable row level security;
alter table settings           enable row level security;
alter table audit_log          enable row level security;
alter table push_subscriptions enable row level security;
alter table rate_limits        enable row level security;

-- helper: restaurant of the signed-in staff user (null when anonymous)
create or replace function auth_restaurant_id() returns uuid
language sql stable security definer set search_path = public as $$
  select restaurant_id from staff_profiles
   where user_id = auth.uid() and is_active limit 1;
$$;

create or replace function auth_staff_role() returns staff_role
language sql stable security definer set search_path = public as $$
  select role from staff_profiles
   where user_id = auth.uid() and is_active limit 1;
$$;

-- Staff read policy applied to every restaurant-scoped table.
do $do$
declare t text;
begin
  foreach t in array array[
    'restaurants','staff_profiles','tables','table_sessions','menu_categories','menu_items',
    'carts','cart_items','orders','order_items','waiter_calls','reviews','feedback',
    'quiz_categories','quiz_questions','game_rounds','game_players','game_answers',
    'game_scores','prizes','settings','audit_log','push_subscriptions'
  ] loop
    if t = 'restaurants' then
      execute format($f$create policy %I on %I for select to authenticated
        using (id = auth_restaurant_id());$f$, t || '_staff_read', t);
    else
      execute format($f$create policy %I on %I for select to authenticated
        using (restaurant_id = auth_restaurant_id());$f$, t || '_staff_read', t);
    end if;
  end loop;
end $do$;

-- writes: admin everywhere, waiter/kitchen on operational tables only
do $do$
declare t text;
begin
  foreach t in array array[
    'menu_categories','menu_items','tables','staff_profiles','prizes','settings',
    'reviews','feedback','push_subscriptions'
  ] loop
    execute format($f$create policy %I on %I for all to authenticated
      using (restaurant_id = auth_restaurant_id() and auth_staff_role() = 'admin')
      with check (restaurant_id = auth_restaurant_id() and auth_staff_role() = 'admin');$f$,
      t || '_admin_write', t);
  end loop;
end $do$;

-- operational tables: waiter + kitchen + admin may write
do $do$
declare t text;
begin
  foreach t in array array[
    'table_sessions','carts','cart_items','orders','order_items','waiter_calls',
    'game_rounds','game_players','game_answers','game_scores'
  ] loop
    execute format($f$create policy %I on %I for all to authenticated
      using (restaurant_id = auth_restaurant_id())
      with check (restaurant_id = auth_restaurant_id());$f$, t || '_staff_write', t);
  end loop;
end $do$;

-- audit_log: append-only, admins read, nobody updates/deletes
create policy audit_log_insert on audit_log for insert to authenticated
  with check (restaurant_id = auth_restaurant_id());
create policy audit_log_delete_block on audit_log for delete to authenticated using (false);

-- ANON: no direct access to any table. Customers only use server endpoints.
revoke all on all tables in schema public from anon;

-- authenticated staff also must not touch rate_limits directly
revoke all on rate_limits from anon, authenticated;

-- ---------- Realtime publication (Supabase) -------------------------
-- Staff devices may subscribe to these tables (RLS still applies).
-- Run on Supabase only (guarded so local PGlite install works):
do $do$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table orders, order_items, waiter_calls, table_sessions, tables, carts, cart_items';
  end if;
exception when others then
  raise notice 'realtime publication skipped: %', sqlerrm;
end $do$;
