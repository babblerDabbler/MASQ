// matchmaking.js - PVP Room Lobby Module
//
// Handles PVP room creation, browsing, and joining.
//
// Flow:
//   1. Player clicks "PVP Match" → lobby overlay opens
//   2. Lobby shows list of available rooms + "Create Room" button
//   3. Create Room: creates a room, shows room code, polls for opponent
//   4. Join Room: clicks a room → joins it → match starts for both
//   5. Lobby auto-refreshes room list every 3 seconds

import { supabase } from './supabaseClient.js';
import { toast } from './toast.js';
import { gameState } from './game.js';
import { initializePvpMatch } from './pvp.js';

// ============================================================================
// LOBBY STATE
// ============================================================================

const lobbyState = {
  isOpen: false,
  refreshInterval: null,
  checkInterval: null,    // Polls for opponent joining your room
  currentRoomCode: null,  // Room code if you created a room
  overlay: null,
};

// ============================================================================
// PUBLIC API
// ============================================================================

// Open the PVP lobby
export async function openPvpLobby() {
  if (lobbyState.isOpen) return;

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

  lobbyState.isOpen = true;
  showLobbyOverlay(token);
  refreshRoomList(token);

  // Auto-refresh room list every 3 seconds
  lobbyState.refreshInterval = setInterval(() => refreshRoomList(token), 3000);
}

// Close the PVP lobby
export function closePvpLobby() {
  lobbyState.isOpen = false;
  stopPolling();
  hideLobbyOverlay();
}

// ============================================================================
// ROOM ACTIONS
// ============================================================================

// Create a new room
async function createRoom(token) {
  try {
    const response = await fetch('/api/pvp/matchmaking', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action: 'create_room' })
    });

    const result = await response.json();

    if (result.error) {
      // If already in a room, show it
      if (response.status === 409 && result.room_code) {
        lobbyState.currentRoomCode = result.room_code;
        if (result.status === 'active') {
          // Already matched — go straight to game
          toast.info("Reconnecting to active match...");
          await checkRoomAndStart(token);
          return;
        }
        showWaitingState(result.room_code);
        startRoomPolling(token, result.room_code);
        return;
      }
      toast.error(result.error);
      return;
    }

    lobbyState.currentRoomCode = result.room_code;
    showWaitingState(result.room_code);
    startRoomPolling(token, result.room_code);
    toast.info(`Room ${result.room_code} created! Waiting for opponent...`);

  } catch (err) {
    console.error('[Lobby] Create room error:', err);
    toast.error("Failed to create room: " + err.message);
  }
}

// Join an existing room
async function joinRoom(token, roomCode) {
  try {
    const response = await fetch('/api/pvp/matchmaking', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action: 'join_room', room_code: roomCode })
    });

    const result = await response.json();

    if (result.error) {
      toast.error(result.error);
      refreshRoomList(token); // Refresh in case room is gone
      return;
    }

    if (result.status === 'joined') {
      toast.success("Joined room! Starting match...");
      closePvpLobby();
      startMatch(result.match);
    }
  } catch (err) {
    console.error('[Lobby] Join room error:', err);
    toast.error("Failed to join room: " + err.message);
  }
}

// Leave your room (cancel waiting)
async function leaveRoom(token) {
  if (!lobbyState.currentRoomCode) return;

  try {
    await fetch('/api/pvp/matchmaking', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action: 'leave_room', room_code: lobbyState.currentRoomCode })
    });
  } catch (err) {
    console.warn('[Lobby] Leave room error:', err);
  }

  lobbyState.currentRoomCode = null;
  stopRoomPolling();
  showBrowseState(token);
  toast.info("Room closed.");
}

// ============================================================================
// ROOM POLLING (creator waits for opponent to join)
// ============================================================================

function startRoomPolling(token, roomCode) {
  stopRoomPolling();

  lobbyState.checkInterval = setInterval(async () => {
    try {
      const response = await fetch('/api/pvp/matchmaking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'check_room', room_code: roomCode })
      });

      const result = await response.json();

      if (result.status === 'active' && result.match) {
        // Opponent joined! Start the match
        stopRoomPolling();
        closePvpLobby();
        toast.success("Opponent joined! Starting match...");
        startMatch(result.match);
      } else if (result.status === 'abandoned') {
        stopRoomPolling();
        lobbyState.currentRoomCode = null;
        showBrowseState(token);
        toast.warning("Room expired.");
      }
    } catch (err) {
      console.warn('[Lobby] Room poll error:', err);
    }
  }, 2000);
}

function stopRoomPolling() {
  if (lobbyState.checkInterval) {
    clearInterval(lobbyState.checkInterval);
    lobbyState.checkInterval = null;
  }
}

function stopPolling() {
  stopRoomPolling();
  if (lobbyState.refreshInterval) {
    clearInterval(lobbyState.refreshInterval);
    lobbyState.refreshInterval = null;
  }
}

// Check room status and start match if active
async function checkRoomAndStart(token) {
  try {
    const response = await fetch('/api/pvp/matchmaking', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action: 'check_room', room_code: lobbyState.currentRoomCode })
    });
    const result = await response.json();
    if (result.status === 'active' && result.match) {
      closePvpLobby();
      startMatch(result.match);
    }
  } catch (err) {
    console.error('[Lobby] Check room error:', err);
  }
}

// ============================================================================
// MATCH TRANSITION
// ============================================================================

async function startMatch(matchData) {
  const isPlayer1 = matchData.player1_id === gameState.userId;

  // Switch from post-login to game view
  document.getElementById("postLogin").style.display = "none";
  document.getElementById("gameUI").style.display = "block";
  document.getElementById("gameCanvas").style.display = "block";
  document.getElementById("header").style.display = "none";
  window.history.pushState({}, '', '/pvp');

  await initializePvpMatch({
    ...matchData,
    is_player1: isPlayer1
  });
}

// ============================================================================
// ROOM LIST REFRESH
// ============================================================================

async function refreshRoomList(token) {
  if (!lobbyState.isOpen) return;

  try {
    const response = await fetch('/api/pvp/matchmaking', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action: 'list_rooms' })
    });

    const result = await response.json();

    if (result.user_match && result.user_match.status === 'active') {
      // User already has an active match — redirect to it
      closePvpLobby();
      toast.info("Reconnecting to active match...");
      lobbyState.currentRoomCode = result.user_match.room_code;
      await checkRoomAndStart(token);
      return;
    }

    renderRoomList(result.rooms || [], token);
  } catch (err) {
    console.warn('[Lobby] Refresh error:', err);
  }
}

// ============================================================================
// UI: LOBBY OVERLAY
// ============================================================================

function showLobbyOverlay(token) {
  hideLobbyOverlay();

  const overlay = document.createElement('div');
  overlay.id = 'pvpLobbyOverlay';
  overlay.className = 'pvp-lobby-overlay';

  overlay.innerHTML = `
    <div class="pvp-lobby-content">
      <div class="pvp-lobby-header">
        <h2 class="pvp-lobby-title">PVP Arena</h2>
        <button class="pvp-lobby-close-btn" id="lobbyCloseBtn">&times;</button>
      </div>
      <div class="pvp-lobby-body">
        <div class="pvp-lobby-actions">
          <button class="pvp-create-room-btn" id="createRoomBtn">Create Room</button>
        </div>
        <div class="pvp-lobby-rooms" id="lobbyRoomList">
          <div class="pvp-lobby-loading">Loading rooms...</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  lobbyState.overlay = overlay;

  document.getElementById('lobbyCloseBtn').addEventListener('click', () => closePvpLobby());
  document.getElementById('createRoomBtn').addEventListener('click', () => createRoom(token));
}

function hideLobbyOverlay() {
  const overlay = document.getElementById('pvpLobbyOverlay');
  if (overlay) {
    overlay.classList.add('fade-out');
    setTimeout(() => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 300);
  }
  lobbyState.overlay = null;
}

// Show "waiting for opponent" state within the lobby
function showWaitingState(roomCode) {
  const body = document.querySelector('.pvp-lobby-body');
  if (!body) return;

  body.innerHTML = `
    <div class="pvp-waiting-room">
      <div class="pvp-room-code-display">
        <span class="pvp-room-code-label">Room Code</span>
        <span class="pvp-room-code-value">${roomCode}</span>
      </div>
      <div class="pvp-waiting-spinner"></div>
      <p class="pvp-waiting-text">Waiting for opponent to join...</p>
      <button class="pvp-cancel-room-btn" id="cancelRoomBtn">Cancel Room</button>
    </div>
  `;

  document.getElementById('cancelRoomBtn').addEventListener('click', async () => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (token) leaveRoom(token);
  });
}

// Show "browse rooms" state (back from waiting)
async function showBrowseState(token) {
  const body = document.querySelector('.pvp-lobby-body');
  if (!body) return;

  body.innerHTML = `
    <div class="pvp-lobby-actions">
      <button class="pvp-create-room-btn" id="createRoomBtn">Create Room</button>
    </div>
    <div class="pvp-lobby-rooms" id="lobbyRoomList">
      <div class="pvp-lobby-loading">Loading rooms...</div>
    </div>
  `;

  document.getElementById('createRoomBtn').addEventListener('click', () => createRoom(token));
  refreshRoomList(token);
}

// Render the room list in the lobby
function renderRoomList(rooms, token) {
  const container = document.getElementById('lobbyRoomList');
  if (!container) return;

  if (rooms.length === 0) {
    container.innerHTML = `
      <div class="pvp-lobby-empty">
        <p>No rooms available</p>
        <p class="pvp-lobby-empty-hint">Create a room and wait for an opponent!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = rooms.map(room => {
    const timeAgo = getTimeAgo(room.created_at);
    const tier = getPvpRankTier(room.creator_rating);

    return `
      <div class="pvp-room-card ${room.is_own ? 'pvp-room-own' : ''}" data-room-code="${room.room_code}">
        <div class="pvp-room-info">
          <span class="pvp-room-code">${room.room_code}</span>
          <span class="pvp-room-creator">${escapeHtml(room.creator_name)}</span>
        </div>
        <div class="pvp-room-meta">
          <span class="pvp-room-rating" style="color:${tier.color}">${tier.icon} ${room.creator_rating}</span>
          <span class="pvp-room-time">${timeAgo}</span>
        </div>
        ${room.is_own
          ? '<span class="pvp-room-yours">Your Room</span>'
          : `<button class="pvp-join-btn" data-code="${room.room_code}">Join</button>`
        }
      </div>
    `;
  }).join('');

  // Attach join handlers
  container.querySelectorAll('.pvp-join-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const code = e.target.getAttribute('data-code');
      joinRoom(token, code);
    });
  });
}

// ============================================================================
// HELPERS
// ============================================================================

function getTimeAgo(dateString) {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

// XSS-safe string escaping for display
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Get PVP rank tier based on rating
export function getPvpRankTier(rating) {
  if (rating >= 2000) return { name: 'MASQ Legend', color: '#FFD700', icon: '👑' };
  if (rating >= 1600) return { name: 'Diamond', color: '#B9F2FF', icon: '💎' };
  if (rating >= 1400) return { name: 'Gold', color: '#FFD700', icon: '🥇' };
  if (rating >= 1200) return { name: 'Silver', color: '#C0C0C0', icon: '🥈' };
  return { name: 'Bronze', color: '#CD7F32', icon: '🥉' };
}

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
