// auth.js

import { supabase } from './supabaseClient.js';
import { toast } from './toast.js';

// Input validation functions
export function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'Username is required' };
  }
  const trimmed = username.trim();
  if (trimmed.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  if (trimmed.length > 20) {
    return { valid: false, error: 'Username must be 20 characters or less' };
  }
  // Only allow alphanumeric characters and underscores
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return { valid: false, error: 'Username can only contain letters, numbers, and underscores' };
  }
  return { valid: true, error: null };
}

export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < 6) {
    return { valid: false, error: 'Password must be at least 6 characters' };
  }
  if (password.length > 100) {
    return { valid: false, error: 'Password must be 100 characters or less' };
  }
  return { valid: true, error: null };
}

function usernameToEmail(username) {
  return `${username.toLowerCase()}@masq.com`;
}

export async function signUp(username, password) {
  // Validate inputs
  const usernameValidation = validateUsername(username);
  if (!usernameValidation.valid) {
    toast.error(usernameValidation.error);
    return;
  }
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    toast.error(passwordValidation.error);
    return;
  }

  const email = usernameToEmail(username.trim());
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (signUpError) {
    if (signUpError.message.includes("User already registered")) {
      toast.warning("This username is already signed up. Try logging in instead.");
    } else {
      toast.error(`Signup Error: ${signUpError.message}`);
    }
    console.error(signUpError);
    return;
  }

  const user = signUpData.user;
  if (user) {
    toast.success("Signup successful! Just click on LOGIN now. GLHF anon!");
  }
}

export async function login(username, password) {
  // Validate inputs
  const usernameValidation = validateUsername(username);
  if (!usernameValidation.valid) {
    return { user: null, username: null, error: { message: usernameValidation.error } };
  }
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    return { user: null, username: null, error: { message: passwordValidation.error } };
  }

  const email = usernameToEmail(username.trim());
  const { data: loginData, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error("Login error:", error.message);
    return { user: null, username: null, error };
  }

  const user = loginData?.user || null;

  if (user) {
    await ensureUserInDB(user.id, username.trim());
    // Fetch the username from the users table
    const { data: userData, error: fetchError } = await supabase
      .from('users')
      .select('username')
      .eq('id', user.id)
      .single();

    if (fetchError) {
      console.error("Error fetching username:", fetchError.message);
      return { user, username: null, error: fetchError };
    }

    return { user, username: userData.username, error: null };
  }

  return { user: null, username: null, error: null };
}

export async function playAsGuest() {
  // Use crypto for secure random ID generation
  const randomBytes = new Uint8Array(12);
  crypto.getRandomValues(randomBytes);
  const secureId = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  const guestUser = {
    id: 'guest_' + secureId,
    email: 'guest@example.com',
  };
  console.log("Guest mode activated with ID:", guestUser.id);
  return { user: guestUser, username: 'Anon', error: null };
}

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) console.error("Logout Error:", error.message);
}

export async function getUserStats(userId) {
  console.log(`Fetching stats for user ${userId}`);
  if (userId.startsWith('guest_')) {
    return { total_wins: 0, total_losses: 0, win_streak: 0 };
  }
  const { data, error } = await supabase
    .from('users')
    .select('total_wins, total_losses, win_streak')
    .eq('id', userId);

  if (error) {
    console.error("Error fetching user stats:", error.message);
    return { total_wins: 0, total_losses: 0, win_streak: 0 };
  }

  if (!data || data.length === 0) {
    console.log(`No stats found for user ${userId}, returning defaults`);
    return { total_wins: 0, total_losses: 0, win_streak: 0 };
  }

  if (data.length > 1) {
    console.warn(`Multiple rows found for user ${userId}, using first row`);
  }

  console.log(`Stats retrieved for user ${userId}:`, data[0]);
  return data[0];
}

export async function updateUserStats(userId, wins, losses, streak) {
  console.log(`Attempting to update stats for user ${userId}: Wins=${wins}, Losses=${losses}, Streak=${streak}`);
  if (userId.startsWith('guest_')) {
    console.log("Guest mode: Stats not saved to database");
    return true;
  }
  const { data, error } = await supabase
    .from('users')
    .update({
      total_wins: wins,
      total_losses: losses,
      win_streak: streak,
    })
    .eq('id', userId)
    .select();

  if (error) {
    console.error("Error updating user stats:", error.message);
    return false;
  }

  console.log("Stats updated successfully:", data);
  return true;
}

export async function ensureUserInDB(userId, username) {
  console.log(`Checking if user ${userId} exists in DB`);
  if (userId.startsWith('guest_')) {
    console.log("Guest mode: No database entry created");
    return;
  }
  const { data: existingUser, error: selectError } = await supabase
    .from('users')
    .select('id, username')
    .eq('id', userId)
    .maybeSingle();

  if (selectError) {
    console.error("Error checking user existence:", selectError.message);
    return;
  }

  if (existingUser) {
    console.log(`User ${userId} already exists with username: ${existingUser.username}`);
    return;
  }

  const defaultUsername = username;
  console.log(`User ${userId} not found, creating with username: ${defaultUsername}`);
  const { data, error } = await supabase
    .from('users')
    .insert({
      id: userId,
      username: defaultUsername,
      total_wins: 0,
      total_losses: 0,
      win_streak: 0,
    })
    .select();

  if (error) {
    console.error("Error inserting new user:", error.message, "Details:", error.details, "Hint:", error.hint);
    return;
  }

  console.log(`User ${userId} created with username: ${data[0].username}`);
}

export async function getUserOwnedSets(userId) {
  console.log(`Fetching owned sets for user ${userId}`);
  
  // If it's a guest, return just the default Core Set (1)
  if (userId.startsWith('guest_')) {
    console.log("Guest user detected, returning default owned set: [1]");
    return [1];
  }
  
  // Query the user's owned_sets
  const { data, error } = await supabase
    .from('users')
    .select('owned_sets')
    .eq('id', userId)
    .single();
  
  if (error) {
    console.error("Error fetching owned sets:", error.message);
    return [1]; // fallback to Core Set
  }
  
  if (!data || !data.owned_sets) {
    console.log(`No owned sets found for user ${userId}, returning default: [1]`);
    return [1];
  }

  console.log(`Owned sets retrieved for user ${userId}:`, data.owned_sets);
  return data.owned_sets;
}

export async function getUserWallet(userId) {
  console.log(`Fetching wallet for user ${userId}`);

  // If it's a guest, return null or a default
  if (userId.startsWith('guest_')) {
    console.log("Guest user detected, no wallet associated.");
    return null;
  }

  const { data, error } = await supabase
    .from('users')
    .select('wallet')
    .eq('id', userId)
    .single();

  if (error) {
    console.error("Error fetching user wallet:", error.message);
    return null;
  }

  if (!data || !data.wallet) {
    console.log(`No wallet found for user ${userId}`);
    return null;
  }

  console.log(`Wallet retrieved for user ${userId}: ${data.wallet}`);
  return data.wallet;
}
