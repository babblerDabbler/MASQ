-- =============================================================================
-- PVP Game Mode Database Migration
-- =============================================================================
-- Run this migration against your Supabase project to enable PVP features.
-- This creates the matchmaking queue, matches table, and adds PVP rating
-- to the existing users table.
--
-- IMPORTANT: Run this BEFORE deploying the PVP code to production.
-- =============================================================================

-- 1. Add pvp_rating column to existing users table (default 1000 ELO)
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS pvp_rating INTEGER DEFAULT 1000;

-- Index for efficient matchmaking queries by rating
CREATE INDEX IF NOT EXISTS idx_users_pvp_rating ON public.users (pvp_rating);

-- 2. Create PVP matchmaking queue table
CREATE TABLE IF NOT EXISTS public.pvp_matchmaking_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL DEFAULT 1000,
  username TEXT NOT NULL DEFAULT 'Anon',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Ensure a user can only be in the queue once
  CONSTRAINT unique_user_in_queue UNIQUE (user_id)
);

-- Index for efficient rating-range queries during matchmaking
CREATE INDEX IF NOT EXISTS idx_queue_rating ON public.pvp_matchmaking_queue (rating);
CREATE INDEX IF NOT EXISTS idx_queue_joined_at ON public.pvp_matchmaking_queue (joined_at);

-- 3. Create PVP matches table
CREATE TABLE IF NOT EXISTS public.pvp_matches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player1_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player2_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('waiting', 'active', 'finished', 'abandoned')),
  winner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  game_seed TEXT NOT NULL,
  turn_number INTEGER DEFAULT 0,
  game_state JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,

  -- Prevent a player from matching against themselves
  CONSTRAINT no_self_match CHECK (player1_id != player2_id)
);

-- Indexes for match queries
CREATE INDEX IF NOT EXISTS idx_matches_player1 ON public.pvp_matches (player1_id);
CREATE INDEX IF NOT EXISTS idx_matches_player2 ON public.pvp_matches (player2_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON public.pvp_matches (status);
CREATE INDEX IF NOT EXISTS idx_matches_created_at ON public.pvp_matches (created_at DESC);

-- 4. Enable Row Level Security (RLS) on new tables
ALTER TABLE public.pvp_matchmaking_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pvp_matches ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for matchmaking queue
-- Users can only see and manage their own queue entries
CREATE POLICY "Users can view their own queue entry"
  ON public.pvp_matchmaking_queue
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own queue entry"
  ON public.pvp_matchmaking_queue
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own queue entry"
  ON public.pvp_matchmaking_queue
  FOR DELETE
  USING (auth.uid() = user_id);

-- Service role (server-side API) can manage all queue entries
-- This is handled automatically by using the service role key in API endpoints

-- 6. RLS Policies for matches
-- Players can view matches they are part of
CREATE POLICY "Players can view their own matches"
  ON public.pvp_matches
  FOR SELECT
  USING (auth.uid() = player1_id OR auth.uid() = player2_id);

-- Only the server (service role) creates and updates matches
-- Client-side users cannot directly modify match state

-- 7. Enable Realtime for pvp_matches table (for live game updates)
-- Note: This needs to be enabled in the Supabase Dashboard under
-- Database > Replication > Tables, or via the following:
ALTER PUBLICATION supabase_realtime ADD TABLE public.pvp_matches;

-- 8. Auto-cleanup: Remove stale queue entries older than 5 minutes
-- This can be run as a scheduled Supabase cron job (pg_cron)
-- Uncomment below if pg_cron is enabled:
--
-- SELECT cron.schedule(
--   'cleanup-stale-pvp-queue',
--   '*/2 * * * *',  -- Every 2 minutes
--   $$DELETE FROM public.pvp_matchmaking_queue WHERE joined_at < now() - interval '5 minutes'$$
-- );

-- 9. Auto-abandon matches that have been active for too long (30 min)
-- Uncomment below if pg_cron is enabled:
--
-- SELECT cron.schedule(
--   'abandon-stale-pvp-matches',
--   '*/5 * * * *',  -- Every 5 minutes
--   $$UPDATE public.pvp_matches SET status = 'abandoned' WHERE status = 'active' AND created_at < now() - interval '30 minutes'$$
-- );
