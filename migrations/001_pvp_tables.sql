-- =============================================================================
-- PVP Game Mode Database Migration
-- =============================================================================
-- Run this migration against your Supabase project to enable PVP features.
-- This creates the matches table with room-based lobby support and adds
-- PVP rating to the existing users table.
--
-- IMPORTANT: Run this BEFORE deploying the PVP code to production.
-- =============================================================================

-- 1. Add pvp_rating column to existing users table (default 1000 ELO)
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS pvp_rating INTEGER DEFAULT 1000;

-- Index for efficient matchmaking queries by rating
CREATE INDEX IF NOT EXISTS idx_users_pvp_rating ON public.users (pvp_rating);

-- 2. Create PVP matches table (also used as rooms when status = 'waiting')
-- When player1 creates a room, player2_id is NULL and status is 'waiting'.
-- When player2 joins, player2_id is set and status becomes 'active'.
CREATE TABLE IF NOT EXISTS public.pvp_matches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player1_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player2_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'finished', 'abandoned')),
  room_code TEXT NOT NULL,
  winner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  game_seed TEXT NOT NULL,
  turn_number INTEGER DEFAULT 0,
  game_state JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,

  -- Prevent a player from matching against themselves
  CONSTRAINT no_self_match CHECK (player1_id != player2_id OR player2_id IS NULL)
);

-- Indexes for match/room queries
CREATE INDEX IF NOT EXISTS idx_matches_player1 ON public.pvp_matches (player1_id);
CREATE INDEX IF NOT EXISTS idx_matches_player2 ON public.pvp_matches (player2_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON public.pvp_matches (status);
CREATE INDEX IF NOT EXISTS idx_matches_created_at ON public.pvp_matches (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_room_code ON public.pvp_matches (room_code);

-- Unique room codes for active/waiting rooms
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_room_code
  ON public.pvp_matches (room_code)
  WHERE status IN ('waiting', 'active');

-- Partial unique index: prevent duplicate active matches between the same pair.
-- Uses LEAST/GREATEST so (A,B) and (B,A) are treated as the same pair.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_match_pair
  ON public.pvp_matches (LEAST(player1_id, player2_id), GREATEST(player1_id, player2_id))
  WHERE status = 'active';

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.pvp_matches ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for matches/rooms
-- Players can view matches they are part of
CREATE POLICY "Players can view their own matches"
  ON public.pvp_matches
  FOR SELECT
  USING (auth.uid() = player1_id OR auth.uid() = player2_id);

-- Anyone can view waiting rooms (for lobby browsing)
CREATE POLICY "Anyone can view waiting rooms"
  ON public.pvp_matches
  FOR SELECT
  USING (status = 'waiting');

-- Only the server (service role) creates and updates matches
-- Client-side users cannot directly modify match state

-- 5. Enable Realtime for pvp_matches table (for live game updates)
-- Note: This needs to be enabled in the Supabase Dashboard under
-- Database > Replication > Tables, or via the following:
ALTER PUBLICATION supabase_realtime ADD TABLE public.pvp_matches;

-- 6. Auto-cleanup: Abandon waiting rooms older than 5 minutes
-- Uncomment below if pg_cron is enabled:
--
-- SELECT cron.schedule(
--   'cleanup-stale-pvp-rooms',
--   '*/2 * * * *',  -- Every 2 minutes
--   $$UPDATE public.pvp_matches SET status = 'abandoned' WHERE status = 'waiting' AND created_at < now() - interval '5 minutes'$$
-- );

-- 7. Auto-abandon matches that have been active for too long (30 min)
-- Uncomment below if pg_cron is enabled:
--
-- SELECT cron.schedule(
--   'abandon-stale-pvp-matches',
--   '*/5 * * * *',  -- Every 5 minutes
--   $$UPDATE public.pvp_matches SET status = 'abandoned' WHERE status = 'active' AND created_at < now() - interval '30 minutes'$$
-- );
