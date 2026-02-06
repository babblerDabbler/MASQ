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

  // Get user's owned sets
  let ownedSetIds = [1];
  const user = await supabase.auth.getUser();
  if (user.data.user) {
    gameState.userId = user.data.user.id;
    const { data: userProfile } = await supabase
      .from('users')
      .select('owned_sets')
      .eq('id', gameState.userId)
      .single();
    ownedSetIds = userProfile?.owned_sets || [1];
  }

  // Build card pool from owned sets
  const availableCards = cardSets
    .filter(set => ownedSetIds.includes(set.id))
    .flatMap(set => set.cards);

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
        // Auto-end turn when time expires
        clearInterval(gameState.turnTimer);
        pvpEndTurn();
      }

      if (gameState.playerReady && gameState.computerReady) {
        clearInterval(gameState.turnTimer);
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
      // Both players ready - resolve immediately
      gameState.computerReady = true;
      pvpResolveTurn();
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

// Resolve the PVP turn (reuses existing resolveTurn logic)
export function pvpResolveTurn() {
  log("Both players ready! Resolving turn...");
  showWaitingIndicator(false);

  // Stop polling during resolution
  stopOpponentPolling();

  // Use the existing resolve turn logic from game.js
  // This handles card effects, damage, combos, etc.
  resolveTurn();

  // After resolution, check for game over
  // The resolveTurn function already handles starting the next turn
  // We just need to restart our PVP-specific polling when the next turn begins
  setTimeout(() => {
    if (pvpState.isActive && gameState.player.health > 0 && gameState.opponent.health > 0) {
      // Override the AI turn timer with PVP turn timer
      clearInterval(gameState.opponentQueueTimer);
      gameState.opponentQueueTimer = null;
    }
  }, 2000);
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
  if (state[opponentReadyKey]) {
    gameState.computerReady = true;
    log("Opponent is ready!");

    // If we're also ready, resolve
    if (gameState.playerReady) {
      pvpResolveTurn();
    }
  }

  // Sync opponent health/mana from server (authoritative)
  const opponentKey = pvpState.isPlayer1 ? 'player2' : 'player1';
  if (state[opponentKey]) {
    gameState.opponent.health = state[opponentKey].health ?? gameState.opponent.health;
    gameState.opponent.mana = state[opponentKey].mana ?? gameState.opponent.mana;
    gameState.opponent.maxMana = state[opponentKey].maxMana ?? gameState.opponent.maxMana;
    updateUI();
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
          pvpResolveTurn();
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

// Handle match completion
function handleMatchEnd(matchData) {
  pvpState.isActive = false;
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
