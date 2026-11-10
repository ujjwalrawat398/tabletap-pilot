-- =====================================================================
-- TableTap — 0009 admin-started restaurant games
-- The whole-restaurant game is no longer scheduled every 5 minutes. The admin
-- starts it; it is cancelled by itself if fewer than two tables join.
--   game_rounds.cancel_reason  : why a round never ran ('not_enough_tables', 'admin')
--   game_scores.prize_given_at : the admin ticked "prize given" for that table's result
-- Idempotent. Safe to re-run.
-- =====================================================================
alter table game_rounds add column if not exists cancel_reason text;
alter table game_scores add column if not exists prize_given_at timestamptz;
