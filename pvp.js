// pvp.js - PVP Game Mode Client Module
//
// Handles real-time PVP gameplay using Supabase Realtime channels.
// Reuses existing card system, animations, and UI from the AI game mode.
//
// Architecture:
//   - Client sends action intents to server API for validation
//   - Supabase Realtime channels broadcast state updates to both players
//   - Card resolution logic mirrors game.js but uses server-validated data
//   - Opponent hand is NEVER visible (server filters state)

import { Card, cardSets } from './cards.js';
import { shuffle } from './utils.js';
import { toast } from './toast.js';
import { scene, camera, renderer } from './threeSetup.js';
import {
  animationManager,
  Easing,
  animateCardDraw,
  animateCardPlay,
  animateCardHover,
  animateCardFlip,
  screenShake,
  createDamageNumber,
  createRoundSummary,
  ParticleSystem,
  createVictoryEffect,
  createDefeatEffect,
  animateHealthBar
} from './animations.js';
import { updateUI, log, hideGameUI } from './ui.js';
import { supabase } from './supabaseClient.js';
import { getUserStats, updateUserStats, ensureUserInDB } from './auth.js';
import { memeToken } from './cards.js';
import { GAME_CONFIG, gameState, drawCards, updateBoard, playCard, resolveTurn, animate } from './game.js';

// ============================================================================
// PVP STATE
// ============================================================================

// Guard flag to prevent resolving the same turn multiple times
// (multiple paths can trigger resolution: end_turn response, Realtime, polling, timer)
let isResolving = false;

export const pvpState = {
  isActive: false,           // Whether PVP mode is currently active
  matchId: null,             // Current match ID
  isPlayer1: false,          // Whether this client is player 1
  opponentName: 'Opponent',  // Opponent's display name
  opponentRating: 1000,      // Opponent's ELO rating
  channel: null,             // Supabase Realtime channel reference
  pollInterval: null,        // Polling interval for match state
  reconnectAttempts: 0,      // Track reconnection attempts
  maxReconnectAttempts: 5,   // Max reconnection attempts before auto-forfeit
  turnEndTime: null,         // When the current turn expires
  lastServerState: null,     // Cache of last received server state
  missedTurns: 0,            // Consecutive missed turns (no cards queued)
  MAX_MISSED_TURNS: 3,       // Auto-forfeit after this many missed turns
};

// ============================================================================
// MATCH LIFECYCLE
// ============================================================================

// Initialize a PVP match after matchmaking succeeds
export async function initializePvpMatch(matchData) {
  console.log('[PVP] Initializing match:', matchData.id);

  pvpState.isActive = true;
  pvpState.matchId = matchData.id;
  pvpState.isPlayer1 = matchData.is_player1 !== undefined
    ? matchData.is_player1
    : matchData.player1_id === gameState.userId;
  pvpState.reconnectAttempts = 0;

  // Set PVP mode flag on gameState so game.js/ui.js use PVP logic paths
  gameState.pvpMode = true;

  // Fetch opponent info
  const opponentId = pvpState.isPlayer1 ? matchData.player2_id : matchData.player1_id;
  const { data: opponentData } = await supabase
    .from('users')
    .select('username, pvp_rating')
    .eq('id', opponentId)
    .single();

  if (opponentData) {
    pvpState.opponentName = opponentData.username || 'Anon';
    pvpState.opponentRating = opponentData.pvp_rating || 1000;
  }

  // Update UI with opponent info
  updatePvpUI();

  // Subscribe to Realtime channel for this match
  subscribeToMatch(matchData.id);

  // Initialize game with the shared seed for fair deck generation
  await initializePvpGame(matchData.game_seed);

  log(`PVP Match started against ${pvpState.opponentName} (Rating: ${pvpState.opponentRating})`);
  toast.info(`Matched against ${pvpState.opponentName}!`);
}

// Initialize game state for PVP (uses shared seed for deterministic deck)
async function initializePvpGame(gameSeed) {
  const loadingScreen = document.getElementById("loadingScreen");
  loadingScreen.style.display = "flex";

  // Clear any existing game state
  clearPvpState();

  // Initialize particle system
  gameState.particleSystem = new ParticleSystem(scene);

  // Ensure userId is set
  const user = await supabase.auth.getUser();
  if (user.data.user) {
    gameState.userId = user.data.user.id;
  }

  // PVP uses ALL card sets for both players to ensure identical deck pools
  // (Owned sets only apply to AI mode — PVP must be deterministic from the shared seed)
  const availableCards = cardSets.flatMap(set => set.cards);

  // Create weighted deck using shared seed for fairness
  // Both players use the same card pool but get different shuffles
  const weightedDeck = [];
  availableCards.forEach(card => {
    for (let i = 0; i < card.weight; i++) {
      weightedDeck.push({ ...card });
    }
  });

  // Use seeded shuffle for deterministic deck generation
  const seededDeck = seededShuffle(weightedDeck, gameSeed);

  // Player gets first half, opponent gets second half
  const playerDeckData = pvpState.isPlayer1
    ? seededDeck.slice(0, GAME_CONFIG.MAX_DECK_SIZE)
    : seededDeck.slice(GAME_CONFIG.MAX_DECK_SIZE, GAME_CONFIG.MAX_DECK_SIZE * 2);

  // Create opponent deck (face-down cards - we don't know their actual cards)
  const opponentDeckData = pvpState.isPlayer1
    ? seededDeck.slice(GAME_CONFIG.MAX_DECK_SIZE, GAME_CONFIG.MAX_DECK_SIZE * 2)
    : seededDeck.slice(0, GAME_CONFIG.MAX_DECK_SIZE);

  gameState.player.deck = playerDeckData.map(data => new Card(data, true));
  gameState.opponent.deck = opponentDeckData.map(data => new Card(data, false));

  // Reset game state
  gameState.player.health = GAME_CONFIG.STARTING_HEALTH;
  gameState.player.maxHealth = GAME_CONFIG.STARTING_HEALTH;
  gameState.player.mana = GAME_CONFIG.STARTING_MANA;
  gameState.player.maxMana = GAME_CONFIG.STARTING_MANA;
  gameState.player.hand = [];
  gameState.player.queuedCards = [];
  gameState.player.playedCards = [];
  gameState.player.drawCount = 0;

  gameState.opponent.health = GAME_CONFIG.STARTING_HEALTH;
  gameState.opponent.maxHealth = GAME_CONFIG.STARTING_HEALTH;
  gameState.opponent.mana = GAME_CONFIG.STARTING_MANA;
  gameState.opponent.maxMana = GAME_CONFIG.STARTING_MANA;
  gameState.opponent.hand = [];
  gameState.opponent.queuedCards = [];
  gameState.opponent.playedCards = [];

  gameState.lastAbilityUsed = null;
  gameState.isTurnActive = false;

  // Draw initial hands
  drawCards(gameState.player, GAME_CONFIG.INITIAL_DRAW_COUNT);
  drawCards(gameState.opponent, GAME_CONFIG.INITIAL_DRAW_COUNT);

  updateBoard();
  updateUI();

  loadingScreen.style.display = "none";

  // Start countdown then begin PVP turn loop
  await pvpCountdown();

  log("PVP match initialized, starting first turn");
  startPvpTurnTimer();
  animate();
}

// Countdown before PVP match starts
async function pvpCountdown() {
  const countdownDiv = document.createElement('div');
  countdownDiv.id = 'countdownScreen';
  countdownDiv.className = 'countdown-screen';
  document.body.appendChild(countdownDiv);

  let countdown = 3;
  countdownDiv.textContent = countdown;

  return new Promise((resolve) => {
    const countdownTimer = setInterval(() => {
      countdown--;
      countdownDiv.textContent = countdown;
      if (countdown <= 0) {
        clearInterval(countdownTimer);
        document.body.removeChild(countdownDiv);
        resolve();
      }
    }, 1000);
  });
}

// ============================================================================
// PVP TURN MANAGEMENT
// ============================================================================

// Start PVP turn timer (replaces AI opponent logic with waiting for real opponent)
export function startPvpTurnTimer() {
  if (gameState.isPaused || !pvpState.isActive) return;

  // Reset resolution guard for new turn
  isResolving = false;

  clearInterval(gameState.turnTimer);
  // No opponent queue timer in PVP - opponent is a real player
  clearInterval(gameState.opponentQueueTimer);
  gameState.opponentQueueTimer = null;

  gameState.turnTimeLeft = GAME_CONFIG.TURN_DURATION;
  gameState.isTurnActive = true;
  gameState.playerReady = false;
  gameState.computerReady = false; // Reused as "opponentReady" in PVP

  // Snapshot mana at start of turn (used by Masquerade Inu)
  gameState.playerTurnStartMana = gameState.player.mana;
  gameState.opponentTurnStartMana = gameState.opponent.mana;

  // Apply lingering DoT damage
  applyDotDamage();

  const turnTimerElement = document.getElementById('turnTimer');
  turnTimerElement.style.display = 'block';

  updateUI();
  log(`Turn ${(gameState.turnTimeLeft)} - Queue your cards!`);

  // Turn countdown
  gameState.turnTimer = setInterval(() => {
    if (!gameState.isPaused && pvpState.isActive) {
      gameState.turnTimeLeft--;
      updateUI();

      if (gameState.turnTimeLeft <= 0) {
        // Timer expired — auto-end turn
        clearInterval(gameState.turnTimer);

        // Track missed turn (no cards queued = missed)
        if (gameState.player.queuedCards.length === 0) {
          pvpState.missedTurns++;
          log(`Turn missed! (${pvpState.missedTurns}/${pvpState.MAX_MISSED_TURNS})`);

          if (pvpState.missedTurns >= pvpState.MAX_MISSED_TURNS) {
            log("Too many missed turns — auto-forfeiting!");
            toast.error("You missed 3 turns in a row. Match forfeited.");
            pvpForfeit();
            return;
          }
        } else {
          // Player queued cards this turn — reset missed counter
          pvpState.missedTurns = 0;
        }

        pvpEndTurn();
      }

      if (gameState.playerReady && gameState.computerReady) {
        clearInterval(gameState.turnTimer);
        // Resolve with no IDs — pvpResolveTurn will fetch them from server
        pvpResolveTurn();
      }
    }
  }, 1000);

  // Start polling for opponent readiness
  startOpponentPolling();
}

// Apply DoT damage at turn start (Masquerade Labubu)
function applyDotDamage() {
  if (gameState.playerDotTurns > 0 && gameState.playerDotDamage > 0) {
    gameState.player.health -= gameState.playerDotDamage;
    gameState.playerDotTurns -= 1;
    log(`Lingering pain hits you for ${gameState.playerDotDamage} (Health: ${gameState.player.health})`);
    if (gameState.playerDotTurns <= 0) {
      gameState.playerDotDamage = 0;
      log("The lingering pain on you fades.");
    }
  }

  if (gameState.opponentDotTurns > 0 && gameState.opponentDotDamage > 0) {
    gameState.opponent.health -= gameState.opponentDotDamage;
    gameState.opponentDotTurns -= 1;
    log(`Lingering pain hits opponent for ${gameState.opponentDotDamage} (Health: ${gameState.opponent.health})`);
    if (gameState.opponentDotTurns <= 0) {
      gameState.opponentDotDamage = 0;
      log("The lingering pain on opponent fades.");
    }
  }
}

// Player ends their turn in PVP
export async function pvpEndTurn() {
  if (!pvpState.isActive || !pvpState.matchId) return;

  // If player manually ends turn with queued cards, reset missed counter
  if (gameState.player.queuedCards.length > 0) {
    pvpState.missedTurns = 0;
  }

  gameState.playerReady = true;
  log("You are ready. Waiting for opponent...");

  // Send queued card IDs to server for validation
  const queuedCardIds = gameState.player.queuedCards.map(card => card.data.id);

  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;

    if (!token) {
      toast.error("Session expired. Please re-login.");
      return;
    }

    // Send cards to server
    await fetch('/api/pvp/match-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'queue_cards',
        match_id: pvpState.matchId,
        payload: { card_ids: queuedCardIds }
      })
    });

    // Signal end turn
    const response = await fetch('/api/pvp/match-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'end_turn',
        match_id: pvpState.matchId
      })
    });

    const result = await response.json();

    if (result.both_ready) {
      // Both players ready - resolve with opponent's card IDs from response
      gameState.computerReady = true;
      pvpResolveTurn(result.opponent_card_ids);
    } else {
      log("Waiting for opponent to finish their turn...");
      // Show waiting indicator
      showWaitingIndicator(true);
    }
  } catch (err) {
    console.error('[PVP] End turn error:', err);
    toast.error("Network error. Retrying...");
  }
}

// Resolve the PVP turn - fetches opponent's cards then resolves both together
export async function pvpResolveTurn(opponentCardIds) {
  // Guard against double resolution from multiple trigger paths
  if (isResolving) return;
  isResolving = true;

  log("Both players ready! Resolving turn...");
  showWaitingIndicator(false);
  stopOpponentPolling();

  // Fetch opponent's card IDs from server if not provided
  if (!opponentCardIds || opponentCardIds.length === 0) {
    opponentCardIds = await fetchOpponentCardIds();
  }

  // Populate gameState.opponent.queuedCards from server card IDs
  prepareOpponentCards(opponentCardIds || []);

  // Now both player's and opponent's queued cards are populated
  // Capture count before resolveTurn clears them
  const opponentCardCount = gameState.opponent.queuedCards.length;

  // Resolve the turn using existing game.js logic (handles effects, damage, combos)
  resolveTurn();

  // Schedule post-resolution sync after resolveTurn's internal timeouts complete
  const revealDelay = opponentCardCount * (GAME_CONFIG.CARD_REVEAL_DELAY + 200);
  const totalDelay = revealDelay + GAME_CONFIG.TURN_RESOLVE_DELAY + 1500;
  setTimeout(() => pvpPostResolution(), totalDelay);
}

// Fetch opponent's queued card IDs from server
async function fetchOpponentCardIds() {
  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) return [];

    const response = await fetch('/api/pvp/match-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'get_state',
        match_id: pvpState.matchId
      })
    });

    const result = await response.json();
    return result.opponent_card_ids || [];
  } catch (err) {
    console.error('[PVP] Error fetching opponent cards:', err);
    return [];
  }
}

// Populate opponent's queued cards from server-provided card IDs
function prepareOpponentCards(cardIds) {
  if (!cardIds || cardIds.length === 0) {
    log("Opponent queued no cards this turn.");
    return;
  }

  // Build a lookup of all card data by ID
  const allCardData = cardSets.flatMap(set => set.cards);
  const cardDataById = {};
  allCardData.forEach(c => { cardDataById[c.id] = c; });

  cardIds.forEach(id => {
    // Try to find matching card in opponent's local hand (maintained by seeded deck)
    const handIndex = gameState.opponent.hand.findIndex(c => c.data.id === id);
    if (handIndex !== -1) {
      const card = gameState.opponent.hand.splice(handIndex, 1)[0];
      gameState.opponent.mana -= card.data.cost;
      gameState.opponent.queuedCards.push(card);
    } else {
      // Fallback: create card from database if hand state drifted
      const cardData = cardDataById[id];
      if (cardData) {
        const card = new Card(cardData, false);
        card.mesh.visible = true;
        gameState.opponent.queuedCards.push(card);
        console.warn(`[PVP] Card ${id} (${cardData.name}) not in opponent hand, created from DB`);
      }
    }
  });

  updateBoard();
}

// Post-resolution: P1 syncs authoritative state to server, P2 fetches and corrects
async function pvpPostResolution() {
  if (!pvpState.isActive) return;

  if (pvpState.isPlayer1) {
    // P1's resolution is AUTHORITATIVE — sync to server first
    await syncStateToServer();

    // Then check game over with P1's canonical state
    if (gameState.player.health <= 0 || gameState.opponent.health <= 0) {
      const playerWon = gameState.opponent.health <= 0 && gameState.player.health > 0;
      await reportPvpGameOver(playerWon);
      return;
    }
  } else {
    // P2 fetches P1's authoritative state and corrects local values
    // Wait for P1's sync to reach the server
    await new Promise(r => setTimeout(r, 2000));
    await fetchAndApplyAuthoritativeState();

    // Check game over with corrected (authoritative) state
    if (gameState.player.health <= 0 || gameState.opponent.health <= 0) {
      const playerWon = gameState.opponent.health <= 0 && gameState.player.health > 0;
      await reportPvpGameOver(playerWon);
      return;
    }
  }

  // Reset resolution guard for next turn
  isResolving = false;
}

// P1 syncs authoritative game state to server after resolution
async function syncStateToServer() {
  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) return;

    // P1 sends BOTH players' state (P1's resolution is canonical)
    await fetch('/api/pvp/match-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'sync_state',
        match_id: pvpState.matchId,
        payload: {
          player1: {
            health: gameState.player.health,
            maxHealth: gameState.player.maxHealth,
            mana: gameState.player.mana,
            maxMana: gameState.player.maxMana,
            handSize: gameState.player.hand.length,
            deckSize: gameState.player.deck.length,
          },
          player2: {
            health: gameState.opponent.health,
            maxHealth: gameState.opponent.maxHealth,
            mana: gameState.opponent.mana,
            maxMana: gameState.opponent.maxMana,
            handSize: gameState.opponent.hand.length,
            deckSize: gameState.opponent.deck.length,
          }
        }
      })
    });
    console.log('[PVP] P1 synced authoritative state to server');
  } catch (err) {
    console.warn('[PVP] State sync error:', err);
  }
}

// P2 fetches P1's authoritative state and corrects local values
async function fetchAndApplyAuthoritativeState() {
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return;

      const response = await fetch('/api/pvp/match-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'get_state',
          match_id: pvpState.matchId
        })
      });

      const result = await response.json();
      if (!result || result.status === 'finished') return;

      // If P1 hasn't synced yet (still in resolution phase), retry
      if (result.phase === 'resolution' && attempt < MAX_RETRIES - 1) {
        console.log('[PVP] P1 sync not ready yet, retrying...');
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      // Apply authoritative values from P1's resolution
      // get_state returns 'player' = P2's data, 'opponent' = P1's data (relative to requester)
      if (result.player?.health !== undefined) {
        const oldHealth = gameState.player.health;
        gameState.player.health = result.player.health;
        gameState.player.maxHealth = result.player.maxHealth ?? gameState.player.maxHealth;
        gameState.player.mana = result.player.mana ?? gameState.player.mana;
        gameState.player.maxMana = result.player.maxMana ?? gameState.player.maxMana;
        if (oldHealth !== result.player.health) {
          console.log(`[PVP] Corrected player health: ${oldHealth} → ${result.player.health}`);
        }
      }
      if (result.opponent?.health !== undefined) {
        const oldHealth = gameState.opponent.health;
        gameState.opponent.health = result.opponent.health;
        gameState.opponent.maxHealth = result.opponent.maxHealth ?? gameState.opponent.maxHealth;
        gameState.opponent.mana = result.opponent.mana ?? gameState.opponent.mana;
        gameState.opponent.maxMana = result.opponent.maxMana ?? gameState.opponent.maxMana;
        if (oldHealth !== result.opponent.health) {
          console.log(`[PVP] Corrected opponent health: ${oldHealth} → ${result.opponent.health}`);
        }
      }

      updateUI();
      console.log('[PVP] Applied authoritative state from server');
      return;
    } catch (err) {
      console.warn('[PVP] Authoritative state fetch error:', err);
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
}

// Report game over to server
async function reportPvpGameOver(playerWon) {
  pvpState.isActive = false;
  stopOpponentPolling();
  clearInterval(gameState.turnTimer);

  // Determine winner in server terms (player1 or player2)
  let winner;
  if (gameState.player.health <= 0 && gameState.opponent.health <= 0) {
    // Both dead — opponent wins (current player forfeited effectively)
    winner = pvpState.isPlayer1 ? 'player2' : 'player1';
  } else if (playerWon) {
    winner = pvpState.isPlayer1 ? 'player1' : 'player2';
  } else {
    winner = pvpState.isPlayer1 ? 'player2' : 'player1';
  }

  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (token) {
      await fetch('/api/pvp/match-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'report_game_over',
          match_id: pvpState.matchId,
          payload: { winner }
        })
      });
    }
  } catch (err) {
    console.error('[PVP] Report game over error:', err);
  }

  // Show PVP game over screen
  if (playerWon) {
    log("You win the PVP match!");
    gameState.player.winStreak += 1;
    gameState.player.totalWins += 1;
    createVictoryEffect(scene);
  } else {
    log("You lost the PVP match.");
    gameState.player.winStreak = 0;
    gameState.player.totalLosses += 1;
    createDefeatEffect(scene);
    screenShake(camera, 0.5, 500);
  }

  setTimeout(() => showPvpGameOverScreen(playerWon), 2500);
}

// ============================================================================
// REALTIME COMMUNICATION
// ============================================================================

// Subscribe to Supabase Realtime channel for this match
function subscribeToMatch(matchId) {
  // Clean up any existing channel
  if (pvpState.channel) {
    supabase.removeChannel(pvpState.channel);
  }

  // Subscribe to match updates via Realtime
  pvpState.channel = supabase
    .channel(`pvp-match-${matchId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'pvp_matches',
      filter: `id=eq.${matchId}`
    }, (payload) => {
      handleMatchUpdate(payload.new);
    })
    .subscribe((status) => {
      console.log('[PVP Realtime] Channel status:', status);
      if (status === 'SUBSCRIBED') {
        log("Connected to match channel");
        pvpState.reconnectAttempts = 0;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        handleRealtimeError();
      }
    });
}

// Handle incoming match state updates from Realtime
function handleMatchUpdate(matchData) {
  if (!pvpState.isActive) return;

  console.log('[PVP] Match update received:', matchData.status);
  pvpState.lastServerState = matchData;

  const state = matchData.game_state || {};

  // Check if match is finished
  if (matchData.status === 'finished') {
    handleMatchEnd(matchData);
    return;
  }

  // Update opponent ready state
  const opponentReadyKey = pvpState.isPlayer1 ? 'player2Ready' : 'player1Ready';
  const opponentKey = pvpState.isPlayer1 ? 'player2' : 'player1';

  if (state[opponentReadyKey]) {
    gameState.computerReady = true;
    log("Opponent is ready!");

    // If we're also ready, resolve with opponent's card IDs from Realtime payload
    if (gameState.playerReady) {
      const opponentCardIds = state[opponentKey]?.queuedCardIds || [];
      pvpResolveTurn(opponentCardIds);
    }
  }
}

// Handle Realtime connection errors with reconnection
function handleRealtimeError() {
  pvpState.reconnectAttempts++;
  console.warn(`[PVP] Realtime error. Attempt ${pvpState.reconnectAttempts}/${pvpState.maxReconnectAttempts}`);

  if (pvpState.reconnectAttempts >= pvpState.maxReconnectAttempts) {
    toast.error("Connection lost. The match will be forfeited.");
    pvpForfeit();
    return;
  }

  // Exponential backoff reconnection
  const delay = Math.min(1000 * Math.pow(2, pvpState.reconnectAttempts), 16000);
  toast.warning(`Connection issue. Reconnecting in ${delay / 1000}s...`);

  setTimeout(() => {
    if (pvpState.isActive && pvpState.matchId) {
      subscribeToMatch(pvpState.matchId);
    }
  }, delay);
}

// Poll server for opponent state (fallback for Realtime)
function startOpponentPolling() {
  stopOpponentPolling();

  pvpState.pollInterval = setInterval(async () => {
    if (!pvpState.isActive || !pvpState.matchId) {
      stopOpponentPolling();
      return;
    }

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return;

      const response = await fetch('/api/pvp/match-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'get_state',
          match_id: pvpState.matchId
        })
      });

      const result = await response.json();

      if (result.status === 'finished') {
        handleMatchEnd(result);
        return;
      }

      // Check if opponent ended their turn
      if (result.opponent_ready && !gameState.computerReady) {
        gameState.computerReady = true;
        log("Opponent is ready!");

        if (gameState.playerReady) {
          pvpResolveTurn(result.opponent_card_ids);
        }
      }
    } catch (err) {
      // Silently handle polling errors (Realtime is primary)
      console.warn('[PVP] Polling error:', err.message);
    }
  }, 2000); // Poll every 2 seconds
}

function stopOpponentPolling() {
  if (pvpState.pollInterval) {
    clearInterval(pvpState.pollInterval);
    pvpState.pollInterval = null;
  }
}

// ============================================================================
// MATCH END
// ============================================================================

// Handle match completion (from Realtime or forfeit)
function handleMatchEnd(matchData) {
  if (!pvpState.isActive) return; // Already handled

  pvpState.isActive = false;
  isResolving = false;
  stopOpponentPolling();

  if (pvpState.channel) {
    supabase.removeChannel(pvpState.channel);
    pvpState.channel = null;
  }

  clearInterval(gameState.turnTimer);
  clearInterval(gameState.opponentQueueTimer);

  const playerWon = matchData.winner_id === gameState.userId;

  if (playerWon) {
    log("You win the PVP match!");
    gameState.player.winStreak += 1;
    gameState.player.totalWins += 1;
    createVictoryEffect(scene);
  } else {
    log("You lost the PVP match.");
    gameState.player.winStreak = 0;
    gameState.player.totalLosses += 1;
    createDefeatEffect(scene);
    screenShake(camera, 0.5, 500);
  }

  // Show PVP-specific game over screen
  setTimeout(() => showPvpGameOverScreen(playerWon), 2500);
}

// PVP-specific game over screen with rating change
function showPvpGameOverScreen(playerWon) {
  const gameOverDiv = document.createElement('div');
  gameOverDiv.id = 'gameOverScreen';
  gameOverDiv.className = 'game-over-screen';

  // Sanitize opponent name to prevent XSS
  const safeName = document.createElement('span');
  safeName.textContent = pvpState.opponentName;

  gameOverDiv.innerHTML = `
    <h2>${playerWon ? 'Victory!' : 'Defeat!'}</h2>
    <p>${playerWon
      ? `You defeated <strong>${safeName.textContent}</strong>!`
      : `<strong>${safeName.textContent}</strong> has bested you.`
    }</p>
    <p class="pvp-rating-change">${playerWon ? 'Rating increased' : 'Rating decreased'}</p>
    <button id="pvpNewGameBtn">Find New Match</button>
    <button id="pvpEndGameBtn">Return to Menu</button>
  `;
  document.body.appendChild(gameOverDiv);

  gameState.isPaused = true;
  document.getElementById('gameUI').style.display = 'none';

  document.getElementById('pvpNewGameBtn').addEventListener('click', () => {
    document.body.removeChild(gameOverDiv);
    cleanupPvpMatch();
    // Return to post-login to queue again
    document.getElementById('postLogin').style.display = 'flex';
    document.getElementById('header').style.display = 'flex';
    document.getElementById('gameCanvas').style.display = 'none';
  });

  document.getElementById('pvpEndGameBtn').addEventListener('click', () => {
    document.body.removeChild(gameOverDiv);
    cleanupPvpMatch();
    returnToPvpMenu();
  });
}

// Forfeit the current match
export async function pvpForfeit() {
  if (!pvpState.isActive || !pvpState.matchId) return;

  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) return;

    await fetch('/api/pvp/match-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'forfeit',
        match_id: pvpState.matchId
      })
    });
  } catch (err) {
    console.error('[PVP] Forfeit error:', err);
  }

  // Handle match end locally
  handleMatchEnd({
    winner_id: pvpState.isPlayer1 ? 'player2' : 'player1',
    status: 'finished'
  });
}

// ============================================================================
// CLEANUP
// ============================================================================

// Clean up PVP state and resources
export function cleanupPvpMatch() {
  pvpState.isActive = false;
  pvpState.matchId = null;
  pvpState.opponentName = 'Opponent';
  pvpState.opponentRating = 1000;
  pvpState.lastServerState = null;
  pvpState.missedTurns = 0;
  isResolving = false;

  // Clear PVP mode flag so game.js reverts to AI mode behavior
  gameState.pvpMode = false;

  stopOpponentPolling();

  if (pvpState.channel) {
    supabase.removeChannel(pvpState.channel);
    pvpState.channel = null;
  }

  clearInterval(gameState.turnTimer);
  clearInterval(gameState.opponentQueueTimer);

  // Reset game state
  gameState.isPaused = false;
  gameState.isTurnActive = false;

  // Hide waiting indicator
  showWaitingIndicator(false);

  // Remove PVP-specific UI elements
  const pvpIndicator = document.getElementById('pvpModeIndicator');
  if (pvpIndicator) pvpIndicator.style.display = 'none';
}

function returnToPvpMenu() {
  cleanupPvpMatch();

  document.body.style.background = "#000";
  document.getElementById('gameUI').style.display = 'none';
  document.getElementById('gameCanvas').style.display = 'none';
  document.getElementById('postLogin').style.display = 'flex';
  document.getElementById('header').style.display = 'flex';
  log("Returned to main menu");
}

// Clear scene and state for PVP initialization
function clearPvpState() {
  const objectsToRemove = [];
  scene.children.forEach(child => {
    if (child.userData instanceof Card || child.type === "Mesh") {
      objectsToRemove.push(child);
    }
  });
  objectsToRemove.forEach(obj => {
    scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(mat => mat.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });

  if (gameState.particleSystem && gameState.particleSystem.dispose) {
    gameState.particleSystem.dispose();
  }

  const logDiv = document.getElementById('gameLog');
  if (logDiv) logDiv.innerHTML = '';
}

// ============================================================================
// UI HELPERS
// ============================================================================

// Update PVP-specific UI elements
function updatePvpUI() {
  // Update opponent label to show real player name
  const opponentInfo = document.querySelector('.opponent-info');
  if (opponentInfo) {
    // Find or create the opponent name display
    let nameDisplay = document.getElementById('pvpOpponentName');
    if (!nameDisplay) {
      nameDisplay = document.createElement('div');
      nameDisplay.id = 'pvpOpponentName';
      nameDisplay.style.cssText = 'font-family: Orbitron, sans-serif; font-size: 12px; color: #FFD700; margin-bottom: 5px;';
      opponentInfo.insertBefore(nameDisplay, opponentInfo.firstChild);
    }
    nameDisplay.textContent = `${pvpState.opponentName} (${pvpState.opponentRating})`;
  }

  // Show PVP mode indicator
  let pvpIndicator = document.getElementById('pvpModeIndicator');
  if (!pvpIndicator) {
    pvpIndicator = document.createElement('div');
    pvpIndicator.id = 'pvpModeIndicator';
    pvpIndicator.className = 'pvp-mode-indicator';
    pvpIndicator.textContent = 'PVP';
    document.querySelector('.ui-overlay')?.appendChild(pvpIndicator);
  }
  pvpIndicator.style.display = 'block';
}

// Show/hide "Waiting for opponent" indicator
function showWaitingIndicator(show) {
  let indicator = document.getElementById('pvpWaitingIndicator');

  if (show) {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'pvpWaitingIndicator';
      indicator.className = 'pvp-waiting-indicator';
      indicator.innerHTML = '<span class="pvp-waiting-dots">Waiting for opponent</span>';
      document.querySelector('.ui-overlay')?.appendChild(indicator);
    }
    indicator.style.display = 'block';
  } else if (indicator) {
    indicator.style.display = 'none';
  }
}

// ============================================================================
// SEEDED RANDOM (for deterministic deck generation)
// ============================================================================

// Simple seeded PRNG (Mulberry32) for deterministic shuffling
function mulberry32(seed) {
  let a = seed;
  return function() {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Convert hex seed string to numeric seed
function seedFromHex(hexString) {
  let hash = 0;
  for (let i = 0; i < hexString.length; i++) {
    const char = hexString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// Seeded Fisher-Yates shuffle for deterministic deck order
function seededShuffle(array, hexSeed) {
  const rng = mulberry32(seedFromHex(hexSeed));
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
