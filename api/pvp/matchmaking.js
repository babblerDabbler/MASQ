// api/pvp/matchmaking.js
// Server-side PVP room/lobby matchmaking endpoint
//
// Room-based flow:
//   1. Player A clicks "PVP Match" → creates a room with a short code (e.g. MASQ-A7B2)
//   2. Room appears in the lobby for all players to see
//   3. Player B browses lobby, clicks on Player A's room → joins it
//   4. Match starts immediately for both players
//
// Actions: create_room, list_rooms, join_room, leave_room
//
// Security: All operations authenticated via Supabase JWT.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Rooms expire after 5 minutes of waiting
const ROOM_EXPIRY_SECONDS = 300;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[PVP Matchmaking] Missing env vars:', {
      hasUrl: !!SUPABASE_URL,
      hasServiceKey: !!SUPABASE_SERVICE_KEY
    });
    return res.status(500).json({ error: 'Server configuration error: missing environment variables' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Authenticate user
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing auth token' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized: invalid token' });
  }

  const { action } = req.body;

  try {
    switch (action) {
      case 'create_room':
        return await handleCreateRoom(supabase, user, res);
      case 'list_rooms':
        return await handleListRooms(supabase, user, res);
      case 'join_room':
        return await handleJoinRoom(supabase, user, req.body, res);
      case 'leave_room':
        return await handleLeaveRoom(supabase, user, req.body, res);
      case 'check_room':
        return await handleCheckRoom(supabase, user, req.body, res);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (err) {
    console.error('[PVP Matchmaking] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Create a new PVP room and wait for an opponent
async function handleCreateRoom(supabase, user, res) {
  const userId = user.id;

  // Get user's PVP rating and username
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('pvp_rating, username')
    .eq('id', userId)
    .single();

  if (userError) {
    return res.status(500).json({ error: 'Failed to fetch user data' });
  }

  // Check if user already has an active match
  const { data: activeMatch } = await supabase
    .from('pvp_matches')
    .select('id, room_code, status')
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
    .in('status', ['active', 'waiting'])
    .maybeSingle();

  if (activeMatch) {
    // Return existing room/match info
    return res.status(409).json({
      error: 'Already in a room or match',
      match_id: activeMatch.id,
      room_code: activeMatch.room_code,
      status: activeMatch.status
    });
  }

  // Generate a short, readable room code (e.g. MASQ-A7B2)
  const roomCode = generateRoomCode();

  // Create room as a pvp_matches row with status 'waiting'
  const { data: room, error: createError } = await supabase
    .from('pvp_matches')
    .insert({
      player1_id: userId,
      player2_id: null,
      status: 'waiting',
      room_code: roomCode,
      game_seed: generateGameSeed(),
      turn_number: 0,
      game_state: createInitialGameState(userData?.username || 'Anon'),
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (createError) {
    console.error('[PVP Matchmaking] Room creation error:', createError);
    return res.status(500).json({ error: 'Failed to create room' });
  }

  console.log(`[PVP] Room created: ${roomCode} by ${userData?.username || userId}`);

  return res.status(200).json({
    status: 'room_created',
    room_code: roomCode,
    match_id: room.id,
    creator: userData?.username || 'Anon',
    rating: userData?.pvp_rating || 1000
  });
}

// List all available rooms (status = 'waiting')
async function handleListRooms(supabase, user, res) {
  // Clean up expired rooms first (older than ROOM_EXPIRY_SECONDS)
  const expiryTime = new Date(Date.now() - ROOM_EXPIRY_SECONDS * 1000).toISOString();
  await supabase
    .from('pvp_matches')
    .update({ status: 'abandoned' })
    .eq('status', 'waiting')
    .lt('created_at', expiryTime);

  // Fetch all waiting rooms
  const { data: rooms, error } = await supabase
    .from('pvp_matches')
    .select('id, room_code, player1_id, game_state, created_at')
    .eq('status', 'waiting')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch rooms' });
  }

  // Format rooms for display (include creator name + rating from game_state)
  const formattedRooms = rooms.map(room => ({
    match_id: room.id,
    room_code: room.room_code,
    creator_name: room.game_state?.creator_name || 'Anon',
    creator_rating: room.game_state?.creator_rating || 1000,
    created_at: room.created_at,
    is_own: room.player1_id === user.id
  }));

  // Also check if user has an active match or room
  const { data: userMatch } = await supabase
    .from('pvp_matches')
    .select('id, room_code, status, player1_id, player2_id')
    .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
    .in('status', ['active', 'waiting'])
    .maybeSingle();

  return res.status(200).json({
    status: 'ok',
    rooms: formattedRooms,
    user_match: userMatch ? {
      match_id: userMatch.id,
      room_code: userMatch.room_code,
      status: userMatch.status,
      is_creator: userMatch.player1_id === user.id
    } : null
  });
}

// Join an existing room
async function handleJoinRoom(supabase, user, body, res) {
  const userId = user.id;
  const { room_code } = body;

  if (!room_code) {
    return res.status(400).json({ error: 'Missing room_code' });
  }

  // Get joiner's info
  const { data: userData } = await supabase
    .from('users')
    .select('pvp_rating, username')
    .eq('id', userId)
    .single();

  // Check if user already has an active match
  const { data: existingMatch } = await supabase
    .from('pvp_matches')
    .select('id, room_code, status')
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
    .in('status', ['active', 'waiting'])
    .maybeSingle();

  if (existingMatch) {
    return res.status(409).json({
      error: 'Already in a room or match',
      match_id: existingMatch.id,
      room_code: existingMatch.room_code,
      status: existingMatch.status
    });
  }

  // Find the room
  const { data: room, error: findError } = await supabase
    .from('pvp_matches')
    .select('*')
    .eq('room_code', room_code.toUpperCase())
    .eq('status', 'waiting')
    .maybeSingle();

  if (findError || !room) {
    return res.status(404).json({ error: 'Room not found or already started' });
  }

  // Can't join your own room
  if (room.player1_id === userId) {
    return res.status(400).json({ error: 'Cannot join your own room' });
  }

  // Atomically update the room: set player2 and change status to 'active'
  // The eq on status='waiting' prevents double-joins (if already active, 0 rows updated)
  const { data: updatedMatch, error: joinError } = await supabase
    .from('pvp_matches')
    .update({
      player2_id: userId,
      status: 'active',
      game_state: {
        ...room.game_state,
        joiner_name: userData?.username || 'Anon',
        joiner_rating: userData?.pvp_rating || 1000,
      }
    })
    .eq('id', room.id)
    .eq('status', 'waiting') // Atomic guard: only join if still waiting
    .select()
    .single();

  if (joinError || !updatedMatch) {
    return res.status(409).json({ error: 'Room is no longer available' });
  }

  console.log(`[PVP] ${userData?.username || userId} joined room ${room_code}`);

  return res.status(200).json({
    status: 'joined',
    match_id: updatedMatch.id,
    room_code: updatedMatch.room_code,
    match: updatedMatch
  });
}

// Leave/delete a room (only the creator, before match starts)
async function handleLeaveRoom(supabase, user, body, res) {
  const userId = user.id;
  const { room_code } = body;

  if (!room_code) {
    return res.status(400).json({ error: 'Missing room_code' });
  }

  // Only allow deleting if user is the creator and room is still waiting
  const { data: deleted, error } = await supabase
    .from('pvp_matches')
    .update({ status: 'abandoned' })
    .eq('room_code', room_code.toUpperCase())
    .eq('player1_id', userId)
    .eq('status', 'waiting')
    .select();

  if (error || !deleted || deleted.length === 0) {
    return res.status(404).json({ error: 'Room not found or already started' });
  }

  return res.status(200).json({ status: 'room_closed' });
}

// Check status of a specific room (for polling by the creator)
async function handleCheckRoom(supabase, user, body, res) {
  const { room_code } = body;

  if (!room_code) {
    return res.status(400).json({ error: 'Missing room_code' });
  }

  const { data: match, error } = await supabase
    .from('pvp_matches')
    .select('id, room_code, status, player1_id, player2_id, game_seed, game_state')
    .eq('room_code', room_code.toUpperCase())
    .maybeSingle();

  if (error || !match) {
    return res.status(404).json({ error: 'Room not found' });
  }

  // Verify user is in this room
  const isPlayer1 = match.player1_id === user.id;
  const isPlayer2 = match.player2_id === user.id;
  if (!isPlayer1 && !isPlayer2) {
    return res.status(403).json({ error: 'Not a participant in this room' });
  }

  return res.status(200).json({
    status: match.status,
    match_id: match.id,
    room_code: match.room_code,
    match: match.status === 'active' ? match : undefined
  });
}

// Generate a short readable room code (e.g. MASQ-A7B2)
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
  let code = '';
  const bytes = new Uint8Array(4);
  crypto.randomFillSync(bytes);
  for (let i = 0; i < 4; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return `MASQ-${code}`;
}

// Generate a cryptographically secure seed for fair deck generation
function generateGameSeed() {
  const bytes = new Uint8Array(16);
  crypto.randomFillSync(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Create the initial server-authoritative game state
function createInitialGameState(creatorName, creatorRating) {
  return {
    creator_name: creatorName || 'Anon',
    creator_rating: creatorRating || 1000,
    player1: {
      health: 30, maxHealth: 30,
      mana: 1, maxMana: 1,
      deckSize: 35, handSize: 0,
      queuedCardCount: 0, dotDamage: 0, dotTurns: 0, drawCount: 0,
    },
    player2: {
      health: 30, maxHealth: 30,
      mana: 1, maxMana: 1,
      deckSize: 35, handSize: 0,
      queuedCardCount: 0, dotDamage: 0, dotTurns: 0, drawCount: 0,
    },
    turnNumber: 0,
    phase: 'starting',
    turnStartTime: null,
    player1Ready: false,
    player2Ready: false,
    player1MissedTurns: 0,
    player2MissedTurns: 0,
  };
}
