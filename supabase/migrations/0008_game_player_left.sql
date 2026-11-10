-- =====================================================================
-- TableTap — 0008 table game: a player who leaves is out of that game
-- left_at is set when a guest quits a "with my table" round. Their game is over
-- (no resuming), the other guests keep playing, and they can come back only
-- while somebody at the table is still playing (that starts them fresh).
-- Idempotent. Safe to re-run.
-- =====================================================================
alter table game_players add column if not exists left_at timestamptz;
