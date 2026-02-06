// matchmaking.js - PVP Matchmaking UI Module
//
// Handles the matchmaking queue UI, polling for match results,
// and transitioning to PVP gameplay when a match is found.
//
// Flow:
//   1. Player clicks "PVP Match" button
//   2. Player joins matchmaking queue via server API
//   3. Client polls server every 2s for match status
//   4. When matched, transitions to PVP game mode

import { supabase } from './supabaseClient.js';
import { toast } from './toast.js';
import { gameState } from './game.js';
import { initializePvpMatch, pvpState, cleanupPvpMatch } from './pvp.js';

// ============================================================================
// MATCHMAKING STATE
// ============================================================================

const matchmakingState = {
  isSearching: false,
  pollInterval: null,
  startTime: null,
  overlay: null,
};

// ============================================================================
// PUBLIC API
// ============================================================================

// Start searching for a PVP match
export async function startMatchmaking() {
  if (matchmakingState.isSearching) {
    toast.warning("Already searching for a match!");
    return;
  }

  // Require authenticated user (not guest)
  if (!gameState.userId || gameState.userId.startsWith('guest_')) {
    toast.error("PVP requires a registered account. Please login first.");
    return;
  }

  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  if (!token) {
    toast.error("Session expired. Please re-login.");
    return;
  }

  matchmakingState.isSearching = true;
  matchmakingState.startTime = Date.now();

  // Show matchmaking overlay
  showMatchmakingOverlay();

  try {
    // Join the queue via server API
    const response = await fetch('/api/pvp/matchmaking', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action: 'join_queue' })
    });

    const result = await response.json();

    if (result.status === 'matched') {
      // Immediately matched!
      handleMatchFound(result.match, token);
      return;
    }

    if (result.error) {
      // Handle "already in active match" case
      if (response.status === 409 && result.match_id) {
        toast.info("Reconnecting to active match...");
        await reconnectToMatch(result.match_id, token);
        return;
      }
      throw new Error(result.error);
    }

    // Start polling for match
    startMatchPolling(token);
    toast.info("Searching for an opponent...");

  } catch (err) {
    console.error('[Matchmaking] Error:', err);
    toast.error("Failed to join matchmaking: " + err.message);
    cancelMatchmaking();
  }
}

// Cancel matchmaking search
export async function cancelMatchmaking() {
  if (!matchmakingState.isSearching) return;

  matchmakingState.isSearching = false;
  stopMatchPolling();
  hideMatchmakingOverlay();

  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;

    if (token) {
      await fetch('/api/pvp/matchmaking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'leave_queue' })
      });
    }
  } catch (err) {
    console.warn('[Matchmaking] Error leaving queue:', err);
  }

  toast.info("Matchmaking cancelled");
}

// ============================================================================
// MATCH POLLING
// ============================================================================

function startMatchPolling(token) {
  stopMatchPolling();

  matchmakingState.pollInterval = setInterval(async () => {
    if (!matchmakingState.isSearching) {
      stopMatchPolling();
      return;
    }

    try {
      const response = await fetch('/api/pvp/matchmaking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'check_match' })
      });

      const result = await response.json();

      switch (result.status) {
        case 'matched':
          handleMatchFound(result.match, token);
          break;

        case 'waiting':
          // Update queue time display
          updateQueueTimeDisplay(result.queue_time || 0);
          break;

        case 'timeout':
          toast.warning("No opponents found. Try again later.");
          cancelMatchmaking();
          break;

        case 'not_in_queue':
          // Player was removed from queue (possibly matched elsewhere)
          // Check for active match
          const stateResponse = await fetch('/api/pvp/matchmaking', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ action: 'check_match' })
          });
          const stateResult = await stateResponse.json();
          if (stateResult.status === 'matched') {
            handleMatchFound(stateResult.match, token);
          } else {
            cancelMatchmaking();
          }
          break;
      }
    } catch (err) {
      console.warn('[Matchmaking] Poll error:', err);
      // Don't cancel on transient errors
    }
  }, 2000); // Poll every 2 seconds
}

function stopMatchPolling() {
  if (matchmakingState.pollInterval) {
    clearInterval(matchmakingState.pollInterval);
    matchmakingState.pollInterval = null;
  }
}

// ============================================================================
// MATCH FOUND
// ============================================================================

async function handleMatchFound(matchData, token) {
  console.log('[Matchmaking] Match found!', matchData);
  matchmakingState.isSearching = false;
  stopMatchPolling();
  hideMatchmakingOverlay();

  toast.success("Match found! Preparing game...");

  // Determine player role
  const isPlayer1 = matchData.player1_id === gameState.userId;

  // Transition to game view
  document.getElementById("postLogin").style.display = "none";
  document.getElementById("gameUI").style.display = "block";
  document.getElementById("gameCanvas").style.display = "block";
  document.getElementById("header").style.display = "none";
  window.history.pushState({}, '', '/pvp');

  // Initialize PVP match
  await initializePvpMatch({
    ...matchData,
    is_player1: isPlayer1
  });
}

// Reconnect to an existing active match
async function reconnectToMatch(matchId, token) {
  hideMatchmakingOverlay();
  matchmakingState.isSearching = false;
  stopMatchPolling();

  try {
    const response = await fetch('/api/pvp/match-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'get_state',
        match_id: matchId
      })
    });

    const result = await response.json();

    if (result.match_id) {
      // Transition to game view
      document.getElementById("postLogin").style.display = "none";
      document.getElementById("gameUI").style.display = "block";
      document.getElementById("gameCanvas").style.display = "block";
      document.getElementById("header").style.display = "none";

      await initializePvpMatch({
        id: matchId,
        ...result
      });
    }
  } catch (err) {
    console.error('[Matchmaking] Reconnect error:', err);
    toast.error("Failed to reconnect to match.");
  }
}

// ============================================================================
// UI: MATCHMAKING OVERLAY
// ============================================================================

function showMatchmakingOverlay() {
  // Remove existing overlay
  hideMatchmakingOverlay();

  const overlay = document.createElement('div');
  overlay.id = 'matchmakingOverlay';
  overlay.className = 'matchmaking-overlay';

  overlay.innerHTML = `
    <div class="matchmaking-content">
      <div class="matchmaking-spinner"></div>
      <h2 class="matchmaking-title">Searching for Opponent</h2>
      <p class="matchmaking-time" id="matchmakingTime">0:00</p>
      <p class="matchmaking-status" id="matchmakingStatus">Entering the queue...</p>
      <button class="matchmaking-cancel-btn" id="matchmakingCancelBtn">Cancel</button>
    </div>
  `;

  document.body.appendChild(overlay);
  matchmakingState.overlay = overlay;

  // Cancel button handler
  document.getElementById('matchmakingCancelBtn').addEventListener('click', () => {
    cancelMatchmaking();
  });

  // Start time display update
  updateQueueTimeDisplay(0);
}

function hideMatchmakingOverlay() {
  const overlay = document.getElementById('matchmakingOverlay');
  if (overlay) {
    overlay.classList.add('fade-out');
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }, 300);
  }
  matchmakingState.overlay = null;
}

function updateQueueTimeDisplay(queueTimeSeconds) {
  const timeDisplay = document.getElementById('matchmakingTime');
  const statusDisplay = document.getElementById('matchmakingStatus');

  if (timeDisplay) {
    const elapsed = queueTimeSeconds || Math.floor((Date.now() - (matchmakingState.startTime || Date.now())) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    timeDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  if (statusDisplay) {
    if (queueTimeSeconds > 30) {
      statusDisplay.textContent = "Expanding search range...";
    } else if (queueTimeSeconds > 10) {
      statusDisplay.textContent = "Looking for a worthy opponent...";
    } else {
      statusDisplay.textContent = "Entering the queue...";
    }
  }
}

// ============================================================================
// PVP RATING DISPLAY
// ============================================================================

// Get and display user's PVP rating
export async function getUserPvpRating(userId) {
  if (!userId || userId.startsWith('guest_')) return 1000;

  const { data, error } = await supabase
    .from('users')
    .select('pvp_rating')
    .eq('id', userId)
    .single();

  if (error || !data) return 1000;
  return data.pvp_rating || 1000;
}

// Get PVP rank tier based on rating
export function getPvpRankTier(rating) {
  if (rating >= 2000) return { name: 'MASQ Legend', color: '#FFD700', icon: '👑' };
  if (rating >= 1600) return { name: 'Diamond', color: '#B9F2FF', icon: '💎' };
  if (rating >= 1400) return { name: 'Gold', color: '#FFD700', icon: '🥇' };
  if (rating >= 1200) return { name: 'Silver', color: '#C0C0C0', icon: '🥈' };
  return { name: 'Bronze', color: '#CD7F32', icon: '🥉' };
}
