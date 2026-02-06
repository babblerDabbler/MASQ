// api/pvp/matchmaking.js
// Server-side matchmaking endpoint for PVP
// Handles queue join, queue leave, and match pairing
//
// Security: All operations are authenticated via Supabase JWT.
// The server validates the user's identity before any matchmaking action.
//
// Race condition prevention:
//   - Only join_queue triggers match pairing (check_match is read-only)
//   - Opponent is claimed via DELETE...RETURNING (atomic removal from queue)
//   - If two requests race to claim the same opponent, only one DELETE succeeds
//   - Active match check before pairing prevents duplicate matches

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Rating range widens over time to prevent infinite queue
const INITIAL_RATING_RANGE = 200;
const RATING_RANGE_EXPANSION_PER_SECOND = 10;
const MAX_RATING_RANGE = 1000;
const MAX_QUEUE_TIME_SECONDS = 60;

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate environment
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[PVP Matchmaking] Missing env vars:', {
      hasUrl: !!SUPABASE_URL,
      hasServiceKey: !!SUPABASE_SERVICE_KEY
    });
    return res.status(500).json({ error: 'Server configuration error: missing environment variables' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Extract auth token from request
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing auth token' });
  }

  const token = authHeader.replace('Bearer ', '');

  // Verify the user's JWT
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized: invalid token' });
  }

  const { action } = req.body;

  try {
    switch (action) {
      case 'join_queue':
        return await handleJoinQueue(supabase, user, res);
      case 'leave_queue':
        return await handleLeaveQueue(supabase, user, res);
      case 'check_match':
        return await handleCheckMatch(supabase, user, res);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (err) {
    console.error('[PVP Matchmaking] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Join the matchmaking queue
async function handleJoinQueue(supabase, user, res) {
  const userId = user.id;

  // Get user's PVP rating (default 1000)
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('pvp_rating, username')
    .eq('id', userId)
    .single();

  if (userError) {
    return res.status(500).json({ error: 'Failed to fetch user data' });
  }

  const rating = userData?.pvp_rating || 1000;

  // Check if user already has an active match — prevent re-queuing
  const { data: activeMatch } = await supabase
    .from('pvp_matches')
    .select('id, player1_id, player2_id, status')
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
    .eq('status', 'active')
    .maybeSingle();

  if (activeMatch) {
    return res.status(409).json({
      error: 'Already in an active match',
      match_id: activeMatch.id,
      match: activeMatch
    });
  }

  // Upsert into queue: insert or update joined_at if already present.
  // The unique_user_in_queue constraint ensures one entry per user.
  const { error: upsertError } = await supabase
    .from('pvp_matchmaking_queue')
    .upsert({
      user_id: userId,
      rating: rating,
      username: userData?.username || 'Anon',
      joined_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

  if (upsertError) {
    console.error('[PVP Matchmaking] Upsert error:', upsertError);
    return res.status(500).json({ error: 'Failed to join queue' });
  }

  // Attempt to find and pair with an opponent atomically
  const match = await attemptMatchPairing(supabase, userId, rating);

  if (match) {
    return res.status(200).json({ status: 'matched', match });
  }

  return res.status(200).json({ status: 'queued', message: 'Waiting for opponent...' });
}

// Leave the matchmaking queue
async function handleLeaveQueue(supabase, user, res) {
  await supabase
    .from('pvp_matchmaking_queue')
    .delete()
    .eq('user_id', user.id);

  return res.status(200).json({ status: 'left_queue' });
}

// Check if a match has been found (READ-ONLY — does NOT create matches)
// This prevents race conditions from multiple concurrent pairing attempts.
// Match creation only happens in join_queue.
async function handleCheckMatch(supabase, user, res) {
  const userId = user.id;

  // Check for active/waiting match first (highest priority)
  const { data: activeMatch } = await supabase
    .from('pvp_matches')
    .select('id, player1_id, player2_id, status, game_seed')
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
    .in('status', ['active', 'waiting'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeMatch) {
    // Clean up queue entry since we have a match
    await supabase
      .from('pvp_matchmaking_queue')
      .delete()
      .eq('user_id', userId);

    return res.status(200).json({ status: 'matched', match: activeMatch });
  }

  // Check if user is still in queue
  const { data: queueEntry } = await supabase
    .from('pvp_matchmaking_queue')
    .select('id, rating, joined_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!queueEntry) {
    // Not in queue and no active match — dropped out
    return res.status(200).json({ status: 'not_in_queue' });
  }

  // Check queue timeout
  const queuedSeconds = (Date.now() - new Date(queueEntry.joined_at).getTime()) / 1000;
  if (queuedSeconds > MAX_QUEUE_TIME_SECONDS) {
    // Remove from queue on timeout
    await supabase
      .from('pvp_matchmaking_queue')
      .delete()
      .eq('user_id', userId);

    return res.status(200).json({ status: 'timeout', message: 'No opponent found' });
  }

  // Still waiting — return queue time so client can display
  // NOTE: We do NOT call attemptMatchPairing here. Only join_queue pairs.
  // This avoids race conditions from multiple concurrent pairing attempts.
  return res.status(200).json({
    status: 'waiting',
    queue_time: Math.floor(queuedSeconds)
  });
}

// Core matchmaking logic: find and claim the closest-rated opponent.
//
// Race-condition-safe approach:
//   1. Find a candidate opponent in the queue via SELECT
//   2. Atomically DELETE that opponent's queue row (claim them)
//      - If another request already claimed them, DELETE returns 0 rows → we retry
//   3. Only after successful claim, create the match and remove ourselves from queue
async function attemptMatchPairing(supabase, userId, userRating, queuedSeconds = 0) {
  // Expand rating range over time to reduce wait
  const ratingRange = Math.min(
    INITIAL_RATING_RANGE + (queuedSeconds * RATING_RANGE_EXPANSION_PER_SECOND),
    MAX_RATING_RANGE
  );

  const minRating = userRating - ratingRange;
  const maxRating = userRating + ratingRange;

  // Find candidate opponents in queue (excluding self)
  const { data: candidates, error } = await supabase
    .from('pvp_matchmaking_queue')
    .select('user_id, rating, username')
    .neq('user_id', userId)
    .gte('rating', minRating)
    .lte('rating', maxRating)
    .order('joined_at', { ascending: true })
    .limit(5); // Fetch a few candidates in case the first is already claimed

  if (error || !candidates || candidates.length === 0) {
    return null;
  }

  // Try to atomically claim an opponent by deleting their queue row.
  // If another concurrent request already claimed them, the delete
  // will affect 0 rows and we move to the next candidate.
  for (const candidate of candidates) {
    // Atomically delete the opponent from the queue — this is the "lock"
    const { data: claimed, error: claimError } = await supabase
      .from('pvp_matchmaking_queue')
      .delete()
      .eq('user_id', candidate.user_id)
      .select();

    if (claimError || !claimed || claimed.length === 0) {
      // Opponent was already claimed by another request — try next candidate
      continue;
    }

    // Double-check neither player already has an active match
    // (guards against edge case where match was created between queue join and now)
    const { data: existingMatch } = await supabase
      .from('pvp_matches')
      .select('id')
      .or(
        `and(player1_id.eq.${userId},player2_id.eq.${candidate.user_id}),` +
        `and(player1_id.eq.${candidate.user_id},player2_id.eq.${userId})`
      )
      .eq('status', 'active')
      .maybeSingle();

    if (existingMatch) {
      // Match already exists for this pair — don't create a duplicate
      // Remove ourselves from queue since we have a match
      await supabase
        .from('pvp_matchmaking_queue')
        .delete()
        .eq('user_id', userId);
      return existingMatch;
    }

    // Create the match
    const { data: match, error: matchError } = await supabase
      .from('pvp_matches')
      .insert({
        player1_id: userId,
        player2_id: candidate.user_id,
        status: 'active',
        game_seed: generateGameSeed(),
        turn_number: 0,
        game_state: createInitialGameState(),
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (matchError) {
      console.error('[PVP Matchmaking] Match creation error:', matchError);
      // Re-insert opponent back into queue since match creation failed
      await supabase
        .from('pvp_matchmaking_queue')
        .insert({
          user_id: candidate.user_id,
          rating: candidate.rating,
          username: candidate.username,
          joined_at: new Date().toISOString()
        });
      return null;
    }

    // Remove ourselves from queue (opponent was already removed above via DELETE)
    await supabase
      .from('pvp_matchmaking_queue')
      .delete()
      .eq('user_id', userId);

    console.log(`[PVP Matchmaking] Match created: ${match.id} (${userId} vs ${candidate.user_id})`);
    return match;
  }

  // No candidate could be claimed
  return null;
}

// Generate a cryptographically secure seed for fair deck generation
function generateGameSeed() {
  const bytes = new Uint8Array(16);
  crypto.randomFillSync(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Create the initial server-authoritative game state
function createInitialGameState() {
  return {
    player1: {
      health: 30,
      maxHealth: 30,
      mana: 1,
      maxMana: 1,
      deckSize: 35,
      handSize: 0,
      queuedCardCount: 0,
      dotDamage: 0,
      dotTurns: 0,
      drawCount: 0,
    },
    player2: {
      health: 30,
      maxHealth: 30,
      mana: 1,
      maxMana: 1,
      deckSize: 35,
      handSize: 0,
      queuedCardCount: 0,
      dotDamage: 0,
      dotTurns: 0,
      drawCount: 0,
    },
    turnNumber: 0,
    phase: 'starting',
    turnStartTime: null,
    player1Ready: false,
    player2Ready: false,
  };
}
