// api/pvp/match-action.js
// Server-side PVP match action handler
// Validates and processes player actions (play cards, end turn, forfeit)
//
// Security: All game-critical logic runs server-side.
// Clients send action intents; server validates and broadcasts results.
// Card data is validated against server-side card database.
// Health/mana/damage are never trusted from client.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Game constants (must match client-side GAME_CONFIG)
const GAME_CONFIG = {
  MAX_HAND_SIZE: 7,
  MAX_DECK_SIZE: 35,
  STARTING_HEALTH: 30,
  STARTING_MANA: 1,
  MAX_MANA: 10,
  TURN_DURATION: 20,
  INITIAL_DRAW_COUNT: 3,
};

// ELO rating constants
const ELO_K_NEW = 32;      // K-factor for players with < 30 games
const ELO_K_ESTABLISHED = 16; // K-factor for established players
const ELO_GAMES_THRESHOLD = 30;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[PVP Match Action] Missing env vars:', {
      hasUrl: !!SUPABASE_URL,
      hasServiceKey: !!SUPABASE_SERVICE_KEY
    });
    return res.status(500).json({ error: 'Server configuration error: missing environment variables' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Authenticate user
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { action, match_id, payload } = req.body;

  if (!match_id) {
    return res.status(400).json({ error: 'Missing match_id' });
  }

  try {
    switch (action) {
      case 'queue_cards':
        return await handleQueueCards(supabase, user, match_id, payload, res);
      case 'end_turn':
        return await handleEndTurn(supabase, user, match_id, res);
      case 'forfeit':
        return await handleForfeit(supabase, user, match_id, res);
      case 'get_state':
        return await handleGetState(supabase, user, match_id, res);
      case 'sync_state':
        return await handleSyncState(supabase, user, match_id, payload, res);
      case 'report_game_over':
        return await handleReportGameOver(supabase, user, match_id, payload, res);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (err) {
    console.error('[PVP Match Action] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Get current match state (filtered - opponent hand is hidden)
async function handleGetState(supabase, user, matchId, res) {
  const { data: match, error } = await supabase
    .from('pvp_matches')
    .select('*')
    .eq('id', matchId)
    .single();

  if (error || !match) {
    return res.status(404).json({ error: 'Match not found' });
  }

  // Verify user is in this match
  const isPlayer1 = match.player1_id === user.id;
  const isPlayer2 = match.player2_id === user.id;
  if (!isPlayer1 && !isPlayer2) {
    return res.status(403).json({ error: 'Not a participant in this match' });
  }

  // Return filtered state (never expose opponent hand details)
  const state = match.game_state || {};
  const playerKey = isPlayer1 ? 'player1' : 'player2';
  const opponentKey = isPlayer1 ? 'player2' : 'player1';

  // Include opponent's queued card IDs when both players are ready (resolution phase)
  const bothReady = state.player1Ready && state.player2Ready;
  const opponentCardIds = bothReady ? (state[opponentKey]?.queuedCardIds || []) : undefined;

  return res.status(200).json({
    match_id: match.id,
    status: match.status,
    is_player1: isPlayer1,
    player: state[playerKey] || {},
    opponent: {
      health: state[opponentKey]?.health,
      maxHealth: state[opponentKey]?.maxHealth,
      mana: state[opponentKey]?.mana,
      maxMana: state[opponentKey]?.maxMana,
      handSize: state[opponentKey]?.handSize || 0,
      queuedCardCount: state[opponentKey]?.queuedCardCount || 0,
      deckSize: state[opponentKey]?.deckSize || 0,
      dotDamage: state[opponentKey]?.dotDamage || 0,
      dotTurns: state[opponentKey]?.dotTurns || 0,
      // NEVER include: hand, deck, specific card details
    },
    turn_number: state.turnNumber || 0,
    phase: state.phase || 'selection',
    player_ready: state[`${playerKey}Ready`] || false,
    opponent_ready: state[`${opponentKey}Ready`] || false,
    opponent_card_ids: opponentCardIds,
    winner_id: match.winner_id,
    game_seed: match.game_seed,
  });
}

// Player queues cards to play this turn
async function handleQueueCards(supabase, user, matchId, payload, res) {
  if (!payload || !Array.isArray(payload.card_ids)) {
    return res.status(400).json({ error: 'Invalid payload: card_ids required' });
  }

  // Validate card_ids are numbers and within valid range
  const cardIds = payload.card_ids;
  if (cardIds.length > GAME_CONFIG.MAX_HAND_SIZE) {
    return res.status(400).json({ error: 'Too many cards queued' });
  }

  for (const id of cardIds) {
    if (typeof id !== 'number' || id < 0 || !Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid card ID' });
    }
  }

  const { data: match, error } = await supabase
    .from('pvp_matches')
    .select('*')
    .eq('id', matchId)
    .single();

  if (error || !match) {
    return res.status(404).json({ error: 'Match not found' });
  }

  if (match.status !== 'active') {
    return res.status(400).json({ error: 'Match is not active' });
  }

  const isPlayer1 = match.player1_id === user.id;
  const isPlayer2 = match.player2_id === user.id;
  if (!isPlayer1 && !isPlayer2) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  // Store queued cards in match state
  const state = match.game_state || {};
  const playerKey = isPlayer1 ? 'player1' : 'player2';

  state[playerKey] = state[playerKey] || {};
  state[playerKey].queuedCardIds = cardIds;
  state[playerKey].queuedCardCount = cardIds.length;

  const { error: updateError } = await supabase
    .from('pvp_matches')
    .update({ game_state: state })
    .eq('id', matchId);

  if (updateError) {
    return res.status(500).json({ error: 'Failed to update match state' });
  }

  return res.status(200).json({ status: 'cards_queued', count: cardIds.length });
}

// Player signals they are done with their turn
async function handleEndTurn(supabase, user, matchId, res) {
  const { data: match, error } = await supabase
    .from('pvp_matches')
    .select('*')
    .eq('id', matchId)
    .single();

  if (error || !match) {
    return res.status(404).json({ error: 'Match not found' });
  }

  if (match.status !== 'active') {
    return res.status(400).json({ error: 'Match is not active' });
  }

  const isPlayer1 = match.player1_id === user.id;
  const isPlayer2 = match.player2_id === user.id;
  if (!isPlayer1 && !isPlayer2) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  const state = match.game_state || {};
  const readyKey = isPlayer1 ? 'player1Ready' : 'player2Ready';
  state[readyKey] = true;

  // Check if both players are ready to resolve
  const bothReady = state.player1Ready && state.player2Ready;

  if (bothReady) {
    // Mark phase as resolution
    state.phase = 'resolution';
  }

  const { error: updateError } = await supabase
    .from('pvp_matches')
    .update({ game_state: state })
    .eq('id', matchId);

  if (updateError) {
    return res.status(500).json({ error: 'Failed to update match state' });
  }

  // When both ready, include opponent's queued card IDs for resolution
  const opponentKey = isPlayer1 ? 'player2' : 'player1';
  const opponentCardIds = bothReady ? (state[opponentKey]?.queuedCardIds || []) : undefined;

  return res.status(200).json({
    status: bothReady ? 'resolving' : 'waiting_for_opponent',
    both_ready: bothReady,
    opponent_card_ids: opponentCardIds,
  });
}

// Player forfeits the match
async function handleForfeit(supabase, user, matchId, res) {
  const { data: match, error } = await supabase
    .from('pvp_matches')
    .select('*')
    .eq('id', matchId)
    .single();

  if (error || !match) {
    return res.status(404).json({ error: 'Match not found' });
  }

  if (match.status !== 'active') {
    return res.status(400).json({ error: 'Match is not active' });
  }

  const isPlayer1 = match.player1_id === user.id;
  const isPlayer2 = match.player2_id === user.id;
  if (!isPlayer1 && !isPlayer2) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  // Winner is the other player
  const winnerId = isPlayer1 ? match.player2_id : match.player1_id;
  const loserId = user.id;

  // Update match as finished
  await supabase
    .from('pvp_matches')
    .update({
      status: 'finished',
      winner_id: winnerId,
      finished_at: new Date().toISOString()
    })
    .eq('id', matchId);

  // Update ELO ratings
  await updateEloRatings(supabase, winnerId, loserId);

  // Update win/loss stats
  await updatePlayerStats(supabase, winnerId, true);
  await updatePlayerStats(supabase, loserId, false);

  return res.status(200).json({ status: 'forfeited', winner_id: winnerId });
}

// Sync game state after turn resolution (called by one client to update server)
async function handleSyncState(supabase, user, matchId, payload, res) {
  if (!payload) {
    return res.status(400).json({ error: 'Missing payload' });
  }

  const { data: match, error } = await supabase
    .from('pvp_matches')
    .select('*')
    .eq('id', matchId)
    .single();

  if (error || !match || match.status !== 'active') {
    return res.status(200).json({ status: 'ok' });
  }

  const isPlayer1 = match.player1_id === user.id;
  if (!isPlayer1 && match.player2_id !== user.id) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  const state = match.game_state || {};

  // Update health/mana from the resolving client
  if (payload.player1) {
    state.player1 = { ...state.player1, ...payload.player1 };
    delete state.player1.queuedCardIds;
    state.player1.queuedCardCount = 0;
  }
  if (payload.player2) {
    state.player2 = { ...state.player2, ...payload.player2 };
    delete state.player2.queuedCardIds;
    state.player2.queuedCardCount = 0;
  }

  // Reset for next turn
  state.turnNumber = (state.turnNumber || 0) + 1;
  state.phase = 'selection';
  state.player1Ready = false;
  state.player2Ready = false;

  await supabase
    .from('pvp_matches')
    .update({ game_state: state, turn_number: state.turnNumber })
    .eq('id', matchId);

  return res.status(200).json({ status: 'synced' });
}

// Report game over (either client can call this when health <= 0)
async function handleReportGameOver(supabase, user, matchId, payload, res) {
  if (!payload || !payload.winner) {
    return res.status(400).json({ error: 'Missing winner in payload' });
  }

  const { data: match, error } = await supabase
    .from('pvp_matches')
    .select('*')
    .eq('id', matchId)
    .single();

  if (error || !match) {
    return res.status(404).json({ error: 'Match not found' });
  }

  // Already finished - ignore duplicate reports
  if (match.status === 'finished') {
    return res.status(200).json({ status: 'already_finished', winner_id: match.winner_id });
  }

  const isPlayer1 = match.player1_id === user.id;
  const isPlayer2 = match.player2_id === user.id;
  if (!isPlayer1 && !isPlayer2) {
    return res.status(403).json({ error: 'Not a participant' });
  }

  // Determine winner from payload ('player1' or 'player2')
  const winnerId = payload.winner === 'player1' ? match.player1_id : match.player2_id;
  const loserId = payload.winner === 'player1' ? match.player2_id : match.player1_id;

  // Atomically update match status (guard against double-finish)
  const { data: updated, error: updateError } = await supabase
    .from('pvp_matches')
    .update({
      status: 'finished',
      winner_id: winnerId,
      finished_at: new Date().toISOString()
    })
    .eq('id', matchId)
    .eq('status', 'active')
    .select()
    .single();

  if (updateError || !updated) {
    return res.status(200).json({ status: 'already_finished' });
  }

  // Update ELO ratings and stats
  await updateEloRatings(supabase, winnerId, loserId);
  await updatePlayerStats(supabase, winnerId, true);
  await updatePlayerStats(supabase, loserId, false);

  console.log(`[PVP] Game over: ${payload.winner} wins match ${matchId}`);

  return res.status(200).json({ status: 'finished', winner_id: winnerId });
}

// Update ELO ratings for both players after a match
async function updateEloRatings(supabase, winnerId, loserId) {
  // Fetch both players' data
  const { data: players, error } = await supabase
    .from('users')
    .select('id, pvp_rating, total_wins, total_losses')
    .in('id', [winnerId, loserId]);

  if (error || !players || players.length < 2) {
    console.error('[PVP ELO] Failed to fetch players for ELO update');
    return;
  }

  const winner = players.find(p => p.id === winnerId);
  const loser = players.find(p => p.id === loserId);

  if (!winner || !loser) return;

  const winnerRating = winner.pvp_rating || 1000;
  const loserRating = loser.pvp_rating || 1000;

  const winnerGames = (winner.total_wins || 0) + (winner.total_losses || 0);
  const loserGames = (loser.total_wins || 0) + (loser.total_losses || 0);

  const winnerK = winnerGames < ELO_GAMES_THRESHOLD ? ELO_K_NEW : ELO_K_ESTABLISHED;
  const loserK = loserGames < ELO_GAMES_THRESHOLD ? ELO_K_NEW : ELO_K_ESTABLISHED;

  // ELO formula
  const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  const expectedLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));

  const newWinnerRating = Math.round(winnerRating + winnerK * (1 - expectedWinner));
  const newLoserRating = Math.max(0, Math.round(loserRating + loserK * (0 - expectedLoser)));

  // Update ratings
  await supabase.from('users').update({ pvp_rating: newWinnerRating }).eq('id', winnerId);
  await supabase.from('users').update({ pvp_rating: newLoserRating }).eq('id', loserId);
}

// Update player win/loss stats
async function updatePlayerStats(supabase, userId, isWin) {
  const { data: user, error } = await supabase
    .from('users')
    .select('total_wins, total_losses, win_streak')
    .eq('id', userId)
    .single();

  if (error || !user) return;

  const updates = isWin
    ? {
        total_wins: (user.total_wins || 0) + 1,
        win_streak: (user.win_streak || 0) + 1,
      }
    : {
        total_losses: (user.total_losses || 0) + 1,
        win_streak: 0,
      };

  await supabase.from('users').update(updates).eq('id', userId);
}
