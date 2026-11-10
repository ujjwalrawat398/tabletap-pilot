-- 0005_hardening.sql
-- Concurrency guards found during the pre-launch review.
--
-- 1. Two tablets can send an order in the same millisecond; batch numbers were
--    computed with `max(batch_no) + 1`, which is a read-then-write race and can
--    produce two "Batch #2" rows for one table session. A unique constraint makes
--    the database the arbiter, and the repository retries with the next number.
--
-- 2. One table session may hold a bounded number of phones. The application
--    enforces MAX_DEVICES_PER_SESSION (12) before inserting, and this index keeps
--    the guest numbers unique so a concurrent scan can never overwrite another
--    guest's device token.
--
-- Both statements are idempotent so the file can be re-run safely.

do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_session_batch_key'
  ) then
    -- de-duplicate any rows created before the constraint existed (keep the earliest)
    with ranked as (
      select id,
             row_number() over (partition by session_id, batch_no order by created_at, id) as rn
        from orders
    )
    update orders o
       set batch_no = o.batch_no + (
             select coalesce(max(batch_no), 0) from orders x where x.session_id = o.session_id
           ) * (r.rn - 1)
      from ranked r
     where r.id = o.id and r.rn > 1;

    alter table orders
      add constraint orders_session_batch_key unique (session_id, batch_no);
  end if;
end
$do$;

create unique index if not exists table_session_devices_guest_uniq
  on table_session_devices (session_id, guest_no);
