// game.js

import { Card, cardSets } from './cards.js';
import { shuffle } from './utils.js';
import { scene, camera, renderer } from './threeSetup.js';
import { updateUI, log, initUIEvents, hideGameUI } from './ui.js';
import { supabase } from './supabaseClient.js';
import { getUserStats, updateUserStats, ensureUserInDB } from './auth.js';
import { memeToken } from './cards.js';

export const gameState = {
  player: { health: 30, maxHealth: 30, mana: 1, maxMana: 1, deck: [], hand: [], queuedCards: [], playedCards: [], winStreak: 0, drawCount: 0, totalWins: 0, totalLosses: 0 },
  opponent: { health: 30, maxHealth: 30, mana: 1, maxMana: 1, deck: [], hand: [], queuedCards: [], playedCards: [], lastPlayedCard: null },
  selectedCard: null,
  draggingCard: null,
  turnTimeLeft: 20,
  turnTimer: null,
  opponentQueueTimer: null,
  maxHandSize: 7,
  maxDeckSize: 35,
  isPaused: false,
  isTurnActive: false,
  playerReady: false,
  computerReady: false,
  userId: null,
  lastAbilityUsed: null,
};


async function getUserProfile(userId) {
  const { data, error } = await supabase.from('users').select('owned_sets').eq('id', userId).single();
  if (error) {
    console.error("Error fetching user profile:", error);
    return { owned_sets: [1] }; 
  }
  return data;
}

async function preloadImages(images) {
  const loadImage = (src) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = src;
      img.onload = resolve;
      img.onerror = reject;
    });
  };
  try {
    await Promise.all(images.map(src => loadImage(src)));
    log("All images preloaded successfully");
  } catch (error) {
    console.error("Error preloading images:", error);
    log("Some images failed to preload");
  }
}


async function startCountdown() {
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

async function fetchGrokResponse(prompt) {
  console.log("[Grok API] Sending prompt to /api/grok:", prompt);

  try {
    const response = await fetch('/api/grok', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    if (!response.ok) throw new Error(`Grok API error: ${response.status}`);

    const data = await response.json();
    console.log("[Grok API] Response data:", data);
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error('[Grok API] Fetch failed:', error);
    return null; 
  }
}


export async function initializeGame() {
  const loadingScreen = document.getElementById("loadingScreen");
  const muteToggle = document.getElementById("muteToggle");
  muteToggle.style.display = "none";
  loadingScreen.style.display = "flex";

  clearSceneAndState();
  
  let ownedSetIds = [1]; // default to core set

  const user = await supabase.auth.getUser();
  if (user.data.user) {
    gameState.userId = user.data.user.id;
    await ensureUserInDB(gameState.userId, user.data.user.email);
    const stats = await getUserStats(gameState.userId);
    const userProfile = await getUserProfile(gameState.userId);
    ownedSetIds = userProfile.owned_sets || [1];
    log(`User has sets: ${ownedSetIds.join(', ')}`);
    console.log("Owned sets fetched:", ownedSetIds);

    gameState.player.totalWins = stats.total_wins;
    gameState.player.totalLosses = stats.total_losses;
    gameState.player.winStreak = stats.win_streak;
    log(`User stats loaded: Wins=${stats.total_wins}, Losses=${stats.total_losses}, Streak=${stats.win_streak}`);
  } else {
    gameState.userId = null;
    gameState.player.totalWins = 0;
    gameState.player.totalLosses = 0;
    gameState.player.winStreak = 0;
    log("Playing as guest, stats will not be saved.");
  }
  
   const availableCards = cardSets
    .filter(set => ownedSetIds.includes(set.id))
    .flatMap(set => set.cards);
  
  const imagesToLoad = [
    '/assets/back1.png',
    '/assets/bgbg2.png',
    '/assets//bgbg1.png',
    ...availableCards.map(card => card.texture)
  ];

  await preloadImages(imagesToLoad);
  loadingScreen.style.display = "none";

  const weightedDeck = [];
  availableCards.forEach(card => {
    for (let i = 0; i < card.weight; i++) {
      weightedDeck.push({ ...card });
    }
  });

  const shuffledDeck = shuffle(weightedDeck);
  gameState.player.deck = shuffledDeck.slice(0, gameState.maxDeckSize).map(data => new Card(data, true));
  gameState.opponent.deck = shuffledDeck.slice(gameState.maxDeckSize, gameState.maxDeckSize * 2).map(data => new Card(data, false));

  gameState.player.hand = [];
  gameState.player.queuedCards = [];
  gameState.player.playedCards = [];
  gameState.opponent.hand = [];
  gameState.opponent.queuedCards = [];
  gameState.opponent.playedCards = [];

  gameState.player.health = 30;
  gameState.player.maxHealth = 30;
  gameState.player.mana = 1;
  gameState.player.maxMana = 1;
  gameState.opponent.health = 30;
  gameState.opponent.maxHealth = 30;
  gameState.opponent.mana = 1;
  gameState.opponent.maxMana = 1;
  gameState.player.drawCount = 0;
  gameState.lastAbilityUsed = null;

  drawCards(gameState.player, 3);
  drawCards(gameState.opponent, 3);

  updateBoard();
  updateUI();
  
  document.getElementById('turnTimer').style.display = 'none';

  log("Images loaded, starting 3-second countdown");
  await startCountdown();

  log("Game initialized, starting first turn");
  startTurnTimer();
  animate();
}

function clearSceneAndState() {
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

  gameState.player.health = 30;
  gameState.player.maxHealth = 30;
  gameState.player.mana = 1;
  gameState.player.maxMana = 1;
  gameState.player.deck = [];
  gameState.player.hand = [];
  gameState.player.queuedCards = [];
  gameState.player.playedCards = [];

  gameState.opponent.health = 30;
  gameState.opponent.maxHealth = 30;
  gameState.opponent.mana = 1;
  gameState.opponent.maxMana = 1;
  gameState.opponent.deck = [];
  gameState.opponent.hand = [];
  gameState.opponent.queuedCards = [];
  gameState.opponent.playedCards = [];
  gameState.opponent.lastPlayedCard = null;

  gameState.selectedCard = null;
  gameState.draggingCard = null;
  gameState.turnTimeLeft = 20;
  gameState.isPaused = false;
  gameState.isTurnActive = false;
  gameState.playerReady = false;
  gameState.computerReady = false;
  gameState.lastAbilityUsed = null;

  clearInterval(gameState.turnTimer);
  clearInterval(gameState.opponentQueueTimer);
  gameState.turnTimer = null;
  gameState.opponentQueueTimer = null;

  const logDiv = document.getElementById('gameLog');
  if (logDiv) logDiv.innerHTML = '';

  const tooltips = ['cardTooltip', 'howToPlayTooltip', 'loreTooltip'];
  tooltips.forEach(id => {
    const tooltip = document.getElementById(id);
    if (tooltip) {
      tooltip.style.display = 'none';
      tooltip.innerHTML = '';
    }
  });
}

export function drawCards(player, count) {
  for (let i = 0; i < count; i++) {
    if (player.deck.length === 0) {
      player.health -= 1;
      log(`${player === gameState.player ? 'Your' : 'Opponent\'s'} deck is empty! Fatigue deals 1 damage (Health: ${player.health})`);
      continue;
    }
    if (player.hand.length >= gameState.maxHandSize) {
      log(`${player === gameState.player ? 'Your' : 'Opponent\'s'} hand is full! Card discarded.`);
      player.deck.shift();
      continue;
    }
    const card = player.deck.shift();
    player.hand.push(card);
    log(`${player === gameState.player ? 'You drew ' + card.data.name : 'Opponent drew a card'}`);
    if (player === gameState.player) gameState.player.drawCount += 1;
  }
  updateBoard();
}

export function updateBoard() {
  const centerSpacing = 2;

  gameState.player.hand.forEach((card, index) => {
    card.targetPosition.set((index - (gameState.player.hand.length - 1) / 2) * centerSpacing, -5, 0.5);
    card.targetRotation.set(0, 0, 0);
    card.mesh.scale.set(1, 1, 1);
  });

  gameState.opponent.hand.forEach((card, index) => {
    card.targetPosition.set((index - (gameState.opponent.hand.length - 1) / 2) * centerSpacing, 5, 0.5);
    card.targetRotation.set(0, 0, 0);
    card.mesh.scale.set(1, 1, 1);
  });

  gameState.player.queuedCards.forEach((card, index) => {
    card.targetPosition.set((index - (gameState.player.queuedCards.length - 1) / 2) * centerSpacing, -2, 0.5);
    card.targetRotation.set(0, 0, 0);
    card.mesh.scale.set(0.8, 0.8, 0.8);
  });

  gameState.opponent.queuedCards.forEach((card, index) => {
    card.targetPosition.set((index - (gameState.opponent.queuedCards.length - 1) / 2) * centerSpacing, 2, 0.5);
    card.targetRotation.set(0, 0, 0);
    card.mesh.scale.set(0.8, 0.8, 0.8);
  });

  const sideSpacing = 0.6;
  const playerPlayed = gameState.player.playedCards.slice(-5);
  playerPlayed.forEach((card, index) => {
    card.targetPosition.set((index - (playerPlayed.length - 1) / 2) * sideSpacing + 5, -2, 0.5);
    card.targetRotation.set(0, 0, 0);
    card.mesh.scale.set(0.25, 0.25, 0.25);
  });

  const opponentPlayed = gameState.opponent.playedCards.slice(-5);
  opponentPlayed.forEach((card, index) => {
    card.targetPosition.set((index - (opponentPlayed.length - 1) / 2) * sideSpacing + 5, 2, 0.5);
    card.targetRotation.set(0, 0, 0);
    card.mesh.scale.set(0.25, 0.25, 0.25);
  });

  updateUI();
}

export function playCard(card) {
  if (gameState.player.mana < card.data.cost || !gameState.isTurnActive || gameState.isPaused) return;
  gameState.player.mana -= card.data.cost;
  gameState.player.hand.splice(gameState.player.hand.indexOf(card), 1);
  gameState.player.queuedCards.push(card);
  log(`You queued ${card.data.name}`);
  updateBoard();
}

export async function opponentQueueCard() {
  if (!gameState.isTurnActive || gameState.isPaused || gameState.opponent.mana <= 0 || gameState.opponent.hand.length === 0) {
    gameState.computerReady = true;
    log("Opponent has no viable plays");
    return;
  }

  // Construct game state prompt for Grok
  const handDescription = gameState.opponent.hand.map((card, index) => 
    `${index}: ${card.data.name} (Cost: ${card.data.cost}, Attack: ${card.data.attack || 0}, Health: ${card.data.health || 0}, Ability: ${card.data.ability || 'None'})`
  ).join('\n');
  const prompt = `Game state:
- Opponent mana: ${gameState.opponent.mana}/${gameState.opponent.maxMana}
- Opponent health: ${gameState.opponent.health}
- Player health: ${gameState.player.health}
- Opponent hand:
${handDescription}
Pick a card to queue by name or 'pass'.`;
  
  // log("[Grok API] Prompt generated for opponent turn:", prompt); 

  // Call Grok API
  const grokChoice = await fetchGrokResponse(prompt);
  
  // log("[Grok API] Grok's choice:", grokChoice); 
  
  if (grokChoice && grokChoice !== 'pass') {
    const chosenCard = gameState.opponent.hand.find(card => card.data.name.toLowerCase() === grokChoice.toLowerCase());
    if (chosenCard && chosenCard.data.cost <= gameState.opponent.mana) {
      gameState.opponent.mana -= chosenCard.data.cost;
      gameState.opponent.hand.splice(gameState.opponent.hand.indexOf(chosenCard), 1);
      gameState.opponent.queuedCards.push(chosenCard);
      log(`Opponent (Grok) queued a hidden card`);
      gameState.opponent.lastPlayedCard = chosenCard;
      updateBoard();
      return;
    } else {
      log(`Grok tried to play invalid card: ${grokChoice}`);
    }
  }

  // Fallback to original logic if Grok fails or passes
  const affordableCards = gameState.opponent.hand.filter(card => card.data.cost <= gameState.opponent.mana);
  let chosenCard = null;
  if (gameState.opponent.lastPlayedCard) {
    chosenCard = affordableCards.find(card => {
      const ability = card.data.ability || "";
      return ability.includes("Combo") && (
        (card.data.name === "Yield Nexus" && gameState.opponent.lastPlayedCard.data.name === "Quantum Seer") ||
        (card.data.name === "Immutable Citadel" && gameState.opponent.lastPlayedCard.data.name === "Hash Sentinel") ||
        (card.data.name === "Encrypted Covenant" && gameState.opponent.lastPlayedCard.data.name === "Token Wraith") ||
        (card.data.name === "Whisper Scripter") ||
        (card.data.name === "Gaslight Rogue") ||
        (card.data.name === "Rage Fury Igniter" && gameState.opponent.lastPlayedCard.data.name === "Rage Ember Wraith") ||
        (card.data.name === "Reorg Trickster" && gameState.player.playedCards.length > 0) ||
        (card.data.name === "Mnemonic Detonator") ||
        (card.data.name === "Fork Echo Walker")
      );
    });
  }

  if (!chosenCard) {
    chosenCard = affordableCards.sort((a, b) => {
      const aScore = (a.data.attack || 0) + (a.data.health || 0) + (a.data.ability?.includes("Draw") ? 1 : 0);
      const bScore = (b.data.attack || 0) + (b.data.health || 0) + (b.data.ability?.includes("Draw") ? 1 : 0);
      return bScore - aScore;
    })[0];
  }

  if (chosenCard) {
    gameState.opponent.mana -= chosenCard.data.cost;
    gameState.opponent.hand.splice(gameState.opponent.hand.indexOf(chosenCard), 1);
    gameState.opponent.queuedCards.push(chosenCard);
    log(`Opponent (Grok) queued a hidden card`);
    gameState.opponent.lastPlayedCard = chosenCard;
    updateBoard();
  } else {
    gameState.computerReady = true;
    log("Opponent has finished queuing cards");
  }
}

export function resolveTurn() {
  gameState.isTurnActive = false;
  gameState.playerReady = false;
  gameState.computerReady = false;

  let delay = 0;
  gameState.opponent.queuedCards.forEach((card, index) => {
    setTimeout(() => {
      card.reveal();
      log(`Opponent revealed ${card.data.name}`);
    }, delay);
    delay += 400;
  });

  setTimeout(async () => {
    let playerLastCard = null;
    let lastPlayerAbility = null;
    gameState.player.queuedCards.forEach(card => {
      let attack = card.data.attack || 0;
      let health = card.data.health || 0;

      if (card.data.ability?.includes("Combo") && playerLastCard) {
        if (card.data.name === "Yield Nexus" && playerLastCard.data.name === "Quantum Seer") {
          attack += 2;
          log("Combo activated: Yield Nexus gains +2 Attack!");
        }
        if (card.data.name === "Immutable Citadel" && playerLastCard.data.name === "Hash Sentinel") {
          health += 3;
          log("Combo activated: Immutable Citadel gains +3 Health!");
        }
        if (card.data.name === "Encrypted Covenant" && playerLastCard.data.name === "Token Wraith") {
          drawCards(gameState.player, 2);
          log("Combo activated: Encrypted Covenant draws 2 cards!");
        }
        if (card.data.name === "Whisper Scripter" && lastPlayerAbility) {
          if (lastPlayerAbility.includes("Draw")) {
            const drawCount = parseInt(lastPlayerAbility.match(/\d+/) || 1);
            drawCards(gameState.player, drawCount);
            log(`Whisper Scripter copies: Draw ${drawCount} cards!`);
          } else if (lastPlayerAbility.includes("gain 2 max mana")) {
            gameState.player.maxMana += 2;
            log("Whisper Scripter copies: Gain 2 max mana next turn!");
          }
        }
        if (card.data.name === "Gaslight Rogue") {
          attack += 1;
          drawCards(gameState.player, 1);
          log("Combo activated: Gaslight Rogue gains +1 Attack and draws 1 card!");
        }
        if (card.data.name === "Rage Fury Igniter" && playerLastCard.data.name === "Rage Ember Wraith") {
          attack += 2;
          log("Combo activated: Rage Fury Igniter gains +2 Attack!");
        }
        if (card.data.name === "Reorg Trickster" && gameState.opponent.playedCards.length > 0) {
          const lastOpponentCard = gameState.opponent.playedCards[gameState.opponent.playedCards.length - 1];
          const copiedCard = new Card(lastOpponentCard.data, true);
          gameState.player.queuedCards.push(copiedCard);
          log(`Reorg Trickster copies and plays ${lastOpponentCard.data.name} for 0 mana!`);
        }
        if (card.data.name === "Mnemonic Detonator") {
          gameState.opponent.hand = [];
          log("Mnemonic Detonator destroys all cards in opponent's hand!");
        }
        if (card.data.name === "Fork Echo Walker" && gameState.lastAbilityUsed) {
          if (gameState.lastAbilityUsed.includes("Draw")) {
            const drawCount = parseInt(gameState.lastAbilityUsed.match(/\d+/) || 1);
            drawCards(gameState.player, drawCount);
            log(`Fork Echo Walker replays: Draw ${drawCount} cards!`);
          } else if (gameState.lastAbilityUsed.includes("gain 2 max mana")) {
            gameState.player.maxMana += 2;
            log("Fork Echo Walker replays: Gain 2 max mana next turn!");
          }
        }
      }

      if (card.data.ability && !card.data.ability.includes("Combo")) {
        if (["Ledger Pwease Whisper", "Solana Chain Diviner", "Gas Arbitrator", "Meme Consensus"].includes(card.data.name)) {
          const drawCount = parseInt(card.data.ability.match(/\d+/) || 1);
          drawCards(gameState.player, drawCount);
        }
        if (card.data.name === "Silk Archivist") {
          drawCards(gameState.player, 2);
          gameState.player.maxMana += 2;
          log("Silk Archivist increases your max mana by 2 next turn!");
        }
        if (card.data.name === "Singularity Masquerade" && gameState.player.drawCount >= 7) {
          alert("You win! Singularity Masquerade triggers victory!");
          gameState.player.winStreak++;
          resetGame();
          return;
        }
        if (card.data.name === "Mnemonic Curator" && gameState.player.playedCards.length > 0) {
          const randomCard = gameState.player.playedCards[Math.floor(Math.random() * gameState.player.playedCards.length)];
          const newCard = new Card(randomCard.data, true);
          gameState.player.hand.push(newCard);
          log(`Mnemonic Curator recalls ${randomCard.data.name} to your hand!`);
        }
        if (card.data.name === "Darkpool Revenant" && gameState.opponent.hand.length > 0) {
          const stolenCard = gameState.opponent.hand.splice(Math.floor(Math.random() * gameState.opponent.hand.length), 1)[0];
          gameState.player.hand.push(new Card(stolenCard.data, true));
          log(`Darkpool Revenant steals ${stolenCard.data.name} from opponent's hand!`);
        }
        if (card.data.name === "Streak Catalyst") {
          attack += gameState.player.winStreak;
          log(`Streak Catalyst gains +${gameState.player.winStreak} Attack from your win streak!`);
        }
        if (card.data.name === "Chrono Root Singularity") {
          gameState.player.mana = gameState.player.maxMana;
          gameState.opponent.mana = gameState.opponent.maxMana;
          log("Chrono Root Singularity resets all timers and makes all cards playable!");
        }
        if (card.data.name === "Dust Indexer") {
          drawCards(gameState.player, 1);
          if (gameState.player.hand[gameState.player.hand.length - 1].data.cost === 1) {
            drawCards(gameState.player, 1);
            log("Dust Indexer draws an extra card!");
          }
        }
        if (card.data.name === "Node Librarian") {
          drawCards(gameState.player, 2);
          const lastTwoCards = gameState.player.hand.slice(-2);
          const uniqueTypes = new Set(lastTwoCards.map(c => c.data.name));
          if (uniqueTypes.size === 2) {
            gameState.player.maxMana += 1;
            log("Node Librarian grants +1 mana next turn for unique card types!");
          }
        }
        if (card.data.name === "Hyperledger Oracle") {
          drawCards(gameState.player, 3);
          const lastThreeCards = gameState.player.hand.slice(-3);
          const drawCard = lastThreeCards.find(c => c.data.ability?.includes("Draw"));
          if (drawCard) {
            const drawCount = parseInt(drawCard.data.ability.match(/\d+/) || 1);
            drawCards(gameState.player, drawCount);
            log(`Hyperledger Oracle triggers extra draw of ${drawCount} cards!`);
          }
        }
        if (card.data.name === "Bonk Pup") {
          drawCards(gameState.player, 1);
          const lastCard = gameState.player.hand[gameState.player.hand.length - 1];
          if (lastCard && lastCard.data.cost <= 2) {
            card.data.attack += 1;
            log("Bonk Pup barks! Drawn card costs 2 or less — gains +1 Attack this turn.");
          } else {
            log("Bonk Pup draws, but no bonus this time.");
          }
        }
        if (card.data.name === "Pump.fun Meme Forge") {
          for (let i = 0; i < 2; i++) {
            const memeCard = new Card({ ...memeToken }, true);
            gameState.player.queuedCards.push(memeCard);
            log("Pump.fun Meme Forge spawns a Meme Token!");
          }
        }
      }

      gameState.opponent.health -= attack;
      gameState.player.health += health;
      log(`${card.data.name}: Deals ${attack} damage to opponent (Health: ${gameState.opponent.health}), Heals you for ${health} (Health: ${gameState.player.health})`);

      playerLastCard = card;
      lastPlayerAbility = card.data.ability || null;
      gameState.player.playedCards.push(card);
      gameState.lastAbilityUsed = card.data.ability || null;

      if (gameState.player.playedCards.length > 5) {
        const oldCard = gameState.player.playedCards[gameState.player.playedCards.length - 6];
        scene.remove(oldCard.mesh);
      }
    });

    let opponentLastCard = null;
    let lastOpponentAbility = null;
    gameState.opponent.queuedCards.forEach(card => {
      let attack = card.data.attack || 0;
      let health = card.data.health || 0;

      if (card.data.ability?.includes("Combo") && opponentLastCard) {
        if (card.data.name === "Yield Nexus" && opponentLastCard.data.name === "Quantum Seer") {
          attack += 2;
          log("Opponent Combo: Yield Nexus gains +2 Attack!");
        }
        if (card.data.name === "Immutable Citadel" && opponentLastCard.data.name === "Hash Sentinel") {
          health += 3;
          log("Opponent Combo: Immutable Citadel gains +3 Health!");
        }
        if (card.data.name === "Encrypted Covenant" && opponentLastCard.data.name === "Token Wraith") {
          drawCards(gameState.opponent, 2);
          log("Opponent Combo: Encrypted Covenant draws 2 cards!");
        }
        if (card.data.name === "Whisper Scripter" && lastOpponentAbility) {
          if (lastOpponentAbility.includes("Draw")) {
            const drawCount = parseInt(lastOpponentAbility.match(/\d+/) || 1);
            drawCards(gameState.opponent, drawCount);
            log(`Opponent Whisper Scripter copies: Draw ${drawCount} cards!`);
          } else if (lastOpponentAbility.includes("gain 2 max mana")) {
            gameState.opponent.maxMana += 2;
            log("Opponent Whisper Scripter copies: Gain 2 max mana next turn!");
          }
        }
        if (card.data.name === "Gaslight Rogue") {
          attack += 1;
          drawCards(gameState.opponent, 1);
          log("Opponent Combo: Gaslight Rogue gains +1 Attack and draws 1 card!");
        }
        if (card.data.name === "Rage Fury Igniter" && opponentLastCard.data.name === "Rage Ember Wraith") {
          attack += 2;
          log("Opponent Combo: Rage Fury Igniter gains +2 Attack!");
        }
        if (card.data.name === "Reorg Trickster" && gameState.player.playedCards.length > 0) {
          const lastPlayerCard = gameState.player.playedCards[gameState.player.playedCards.length - 1];
          const copiedCard = new Card(lastPlayerCard.data, false);
          gameState.opponent.queuedCards.push(copiedCard);
          log(`Opponent Reorg Trickster copies and plays ${lastPlayerCard.data.name} for 0 mana!`);
        }
        if (card.data.name === "Mnemonic Detonator") {
          gameState.player.hand = [];
          log("Opponent Mnemonic Detonator destroys all cards in your hand!");
        }
        if (card.data.name === "Fork Echo Walker" && gameState.lastAbilityUsed) {
          if (gameState.lastAbilityUsed.includes("Draw")) {
            const drawCount = parseInt(gameState.lastAbilityUsed.match(/\d+/) || 1);
            drawCards(gameState.opponent, drawCount);
            log(`Opponent Fork Echo Walker replays: Draw ${drawCount} cards!`);
          } else if (gameState.lastAbilityUsed.includes("gain 2 max mana")) {
            gameState.opponent.maxMana += 2;
            log("Opponent Fork Echo Walker replays: Gain 2 max mana next turn!");
          }
        }
      }

      if (card.data.ability && !card.data.ability.includes("Combo")) {
        if (["Ledger Pwease Whisper", "Solana Chain Diviner", "Gas Arbitrator", "Meme Consensus"].includes(card.data.name)) {
          const drawCount = parseInt(card.data.ability.match(/\d+/) || 1);
          drawCards(gameState.opponent, drawCount);
        }
        if (card.data.name === "Silk Archivist") {
          drawCards(gameState.opponent, 2);
          gameState.opponent.maxMana += 2;
          log("Opponent’s Silk Archivist increases their max mana by 2!");
        }
        if (card.data.name === "Mnemonic Curator" && gameState.opponent.playedCards.length > 0) {
          const randomCard = gameState.opponent.playedCards[Math.floor(Math.random() * gameState.opponent.playedCards.length)];
          const newCard = new Card(randomCard.data, false);
          gameState.opponent.hand.push(newCard);
          log(`Opponent’s Mnemonic Curator recalls ${randomCard.data.name} to their hand!`);
        }
        if (card.data.name === "Darkpool Revenant" && gameState.player.hand.length > 0) {
          const stolenCard = gameState.player.hand.splice(Math.floor(Math.random() * gameState.player.hand.length), 1)[0];
          gameState.opponent.hand.push(new Card(stolenCard.data, false));
          log(`Opponent’s Darkpool Revenant steals ${stolenCard.data.name} from your hand!`);
        }
        if (card.data.name === "Streak Catalyst") {
          attack += gameState.player.winStreak;
          log(`Opponent’s Streak Catalyst gains +${gameState.player.winStreak} Attack!`);
        }
        if (card.data.name === "Chrono Root Singularity") {
          gameState.player.mana = gameState.player.maxMana;
          gameState.opponent.mana = gameState.opponent.maxMana;
          log("Opponent Chrono Root Singularity resets all timers and makes all cards playable!");
        }
        if (card.data.name === "Dust Indexer") {
          drawCards(gameState.opponent, 1);
          if (gameState.opponent.hand[gameState.opponent.hand.length - 1].data.cost === 1) {
            drawCards(gameState.opponent, 1);
            log("Opponent Dust Indexer draws an extra card!");
          }
        }
        if (card.data.name === "Node Librarian") {
          drawCards(gameState.opponent, 2);
          const lastTwoCards = gameState.opponent.hand.slice(-2);
          const uniqueTypes = new Set(lastTwoCards.map(c => c.data.name));
          if (uniqueTypes.size === 2) {
            gameState.opponent.maxMana += 1;
            log("Opponent Node Librarian grants +1 mana next turn for unique card types!");
          }
        }
        if (card.data.name === "Hyperledger Oracle") {
          drawCards(gameState.opponent, 3);
          const lastThreeCards = gameState.opponent.hand.slice(-3);
          const drawCard = lastThreeCards.find(c => c.data.ability?.includes("Draw"));
          if (drawCard) {
            const drawCount = parseInt(drawCard.data.ability.match(/\d+/) || 1);
            drawCards(gameState.opponent, drawCount);
            log(`Opponent Hyperledger Oracle triggers extra draw of ${drawCount} cards!`);
          }
        }
        if (card.data.name === "Bonk Pup") {
          drawCards(gameState.player, 1);
          const lastCard = gameState.player.hand[gameState.player.hand.length - 1];
          if (lastCard && lastCard.data.cost <= 2) {
            card.data.attack += 1;
            log("Bonk Pup barks! Drawn card costs 2 or less — gains +1 Attack this turn.");
          } else {
            log("Bonk Pup draws, but no bonus this time.");
          }
        }
        if (card.data.name === "Pump.fun Meme Forge") {
          for (let i = 0; i < 2; i++) {
            const memeCard = new Card({ ...memeToken }, false);
            gameState.opponent.queuedCards.push(memeCard);
            log("Opponent’s Pump.fun Meme Forge spawns a Meme Token!");
          }
        }
      }

      gameState.player.health -= attack;
      gameState.opponent.health += health;
      log(`${card.data.name}: Deals ${attack} damage to you (Health: ${gameState.player.health}), Heals opponent for ${health} (Health: ${gameState.opponent.health})`);

      opponentLastCard = card;
      lastOpponentAbility = card.data.ability || null;
      gameState.opponent.playedCards.push(card);
      gameState.lastAbilityUsed = card.data.ability || null;
    });

    gameState.player.queuedCards = [];
    gameState.opponent.queuedCards = [];

    gameState.player.playedCards = gameState.player.playedCards.filter(c => c.data.name !== "Meme Token");
    gameState.opponent.playedCards = gameState.opponent.playedCards.filter(c => c.data.name !== "Meme Token");

    updateBoard();
    log("Turn resolved, checking game over state");
    const isGameOver = await checkGameOver();
    if (!isGameOver) {
      log("Game continues, preparing next turn");
      setTimeout(() => {
        gameState.player.mana = Math.min(gameState.player.maxMana + 1, 10);
        gameState.opponent.mana = Math.min(gameState.opponent.maxMana + 1, 10);
        gameState.player.maxMana = Math.min(gameState.player.maxMana + 1, 10);
        gameState.opponent.maxMana = Math.min(gameState.opponent.maxMana + 1, 10);
        gameState.player.drawCount = 0;
        drawCards(gameState.player, 1);
        drawCards(gameState.opponent, 1);
        log("New turn begins");
        startTurnTimer();
      }, 1000);
    } else {
      log("Game over detected, no new turn started");
    }
  }, gameState.opponent.queuedCards.length * 400 + 3000);
}

export function startTurnTimer() {
  if (gameState.isPaused) return;
  clearInterval(gameState.turnTimer);
  clearInterval(gameState.opponentQueueTimer);
  gameState.turnTimeLeft = 20;
  gameState.isTurnActive = true;
  gameState.playerReady = false;
  gameState.computerReady = false;
  
  const turnTimerElement = document.getElementById('turnTimer');
  turnTimerElement.style.display = 'block';
  
  updateUI();
  log(`Turn timer started: ${gameState.turnTimeLeft} seconds remaining`);

  gameState.turnTimer = setInterval(() => {
    if (!gameState.isPaused) {
      gameState.turnTimeLeft--;
      updateUI();
      if (gameState.turnTimeLeft <= 0 || (gameState.playerReady && gameState.computerReady)) {
        clearInterval(gameState.turnTimer);
        clearInterval(gameState.opponentQueueTimer);
        log("Turn timer expired or both players ready, resolving turn");
        resolveTurn();
      }
    }
  }, 1000);

  gameState.opponentQueueTimer = setInterval(() => {
    if (!gameState.isPaused && gameState.isTurnActive) {
      opponentQueueCard();
      if (!canComputerQueueMore()) {
        gameState.computerReady = true;
        log("Grok has finished its turn");
      }
    }
  }, 5000);
}

export function canComputerQueueMore() {
  return gameState.opponent.hand.some(card => card.data.cost <= gameState.opponent.mana);
}

export async function checkGameOver() {
  if (gameState.player.health <= 0) {
    log("Opponent wins!");
    gameState.player.winStreak = 0;
    gameState.player.totalLosses += 1;
    if (gameState.userId && !gameState.userId.startsWith('guest_')) {
      await updateUserStats(gameState.userId, gameState.player.totalWins, gameState.player.totalLosses, gameState.player.winStreak);
      log(`Stats updated: Loss recorded (Wins: ${gameState.player.totalWins}, Losses: ${gameState.player.totalLosses}, Streak: ${gameState.player.winStreak})`);
    } else {
      log("Guest mode: Stats updated locally but not saved.");
    }
    showGameOverScreen(false);
    return true;
  } else if (gameState.opponent.health <= 0) {
    log("You win!");
    gameState.player.winStreak += 1;
    gameState.player.totalWins += 1;
    log(`Win streak increased to ${gameState.player.winStreak}!`);
    if (gameState.userId && !gameState.userId.startsWith('guest_')) {
      await updateUserStats(gameState.userId, gameState.player.totalWins, gameState.player.totalLosses, gameState.player.winStreak);
      log(`Stats updated: Win recorded (Wins: ${gameState.player.totalWins}, Losses: ${gameState.player.totalLosses}, Streak: ${gameState.player.winStreak})`);
    } else {
      log("Guest mode: Stats updated locally but not saved.");
    }
    showGameOverScreen(true);
    return true;
  }
  return false;
}

function showGameOverScreen(playerWon) {
  const gameOverDiv = document.createElement('div');
  gameOverDiv.id = 'gameOverScreen';
  gameOverDiv.className = 'game-over-screen';
  gameOverDiv.innerHTML = `
    <h2>${playerWon ? 'Victory!' : 'Defeat!'}</h2>
    <p>${playerWon ? 'You have defeated Grok!' : 'Grok has bested you.'}</p>
    <button id="newGameBtn">New Game</button>
    <button id="endGameBtn">End Game</button>
  `;
  document.body.appendChild(gameOverDiv);

  gameState.isPaused = true;
  clearInterval(gameState.turnTimer);
  clearInterval(gameState.opponentQueueTimer);
  document.getElementById('gameUI').style.display = 'none';

  document.getElementById('newGameBtn').addEventListener('click', () => {
    document.body.removeChild(gameOverDiv);
    resetGame();
  });

  document.getElementById('endGameBtn').addEventListener('click', () => {
    document.body.removeChild(gameOverDiv);
    returnToMenu();
  });
}

function returnToMenu() {
  clearSceneAndState();

  document.body.style.background = "#000";
  document.getElementById('gameUI').style.display = 'none';
  document.getElementById('gameCanvas').style.display = 'none';
  document.getElementById('postLogin').style.display = 'flex';
  document.getElementById('header').style.display = 'flex';
  log("Returned to main menu");

  setTimeout(() => {
  refreshPlayerStats();
}, 500);
  
}

export function resetGame() {
  clearSceneAndState();

  document.getElementById('pauseBtn').textContent = "Pause";
  document.getElementById('gameUI').style.display = 'block';
  document.getElementById('gameCanvas').style.display = 'block';
  
  document.getElementById('turnTimer').style.display = 'none';

  const loadingScreen = document.getElementById("loadingScreen");
  loadingScreen.style.display = "flex";
  loadingScreen.textContent = "Loading Images...";

  preloadImages().then(async () => {
    loadingScreen.style.display = "none";
    log("Images loaded, starting 3-second countdown");
    await startCountdown();
    log("Game state reset, reinitializing game");
    initializeGame();
  });
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

export function onMouseMove(event) {
  if (gameState.isPaused) return;
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(scene.children);
  const tooltip = document.getElementById('cardTooltip');

  let hovered = false;

  if (intersects.length > 0) {
    const card = intersects[0].object.userData;
    const allCards = [
      ...gameState.player.hand,
      ...gameState.player.playedCards.slice(-5),
      ...gameState.opponent.playedCards.slice(-5),
    ];

    if (card && allCards.includes(card)) {
      hovered = true;
      const isPlayedCard = gameState.player.playedCards.includes(card) || gameState.opponent.playedCards.includes(card);
      const scale = isPlayedCard ? 1 : 2;
      card.mesh.scale.set(scale, scale, scale);
      card.mesh.position.z = 2;

      const currentTexture = card.mesh.material.uniforms.cardTexture.value;
      if (card.isPlayer || (currentTexture && currentTexture.image && currentTexture.image.src === card.data.texture)) {
        tooltip.style.display = 'block';
        tooltip.style.left = `${event.clientX + 10}px`;
        tooltip.style.top = `${event.clientY - 10}px`;
        tooltip.innerHTML = `${card.data.name}<br>Cost: ${card.data.cost} | Attack: ${card.data.attack} | Health: ${card.data.health}${card.data.ability ? '<br>' + card.data.ability : ''}`;
      } else {
        tooltip.style.display = 'none';
      }
    }
  }

  if (!hovered) {
    [...gameState.player.hand, ...gameState.player.playedCards.slice(-5), ...gameState.opponent.playedCards.slice(-5)].forEach(card => {
      const isPlayedCard = gameState.player.playedCards.includes(card) || gameState.opponent.playedCards.includes(card);
      const scale = isPlayedCard ? 0.25 : 1;
      card.mesh.scale.set(scale, scale, scale);
      card.targetPosition.z = 0.5;
    });
    tooltip.style.display = 'none';
  }
}

export function onMouseDown(event) {
  if (gameState.isPaused) return;
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(scene.children);
  if (intersects.length > 0) {
    const card = intersects[0].object.userData;
    if (gameState.player.hand.includes(card)) {
      gameState.draggingCard = card;
      gameState.selectedCard = card;
    }
  }
}

export function onMouseUp(event) {
  if (gameState.isPaused || !gameState.draggingCard) return;
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  if (mouse.y < -0.2) {
    playCard(gameState.draggingCard);
  }
  gameState.draggingCard = null;
  gameState.selectedCard = null;
}

export function animate() {
  if (!gameState.isPaused) {
    requestAnimationFrame(animate);

    if (gameState.draggingCard) {
      const targetZ = gameState.draggingCard.mesh.position.z;
      gameState.draggingCard.mesh.position.set(mouse.x * 20, mouse.y * 15, targetZ + 5);
    }

    gameState.player.hand.forEach(card => card.update());
    gameState.player.queuedCards.forEach(card => card.update());
    gameState.opponent.hand.forEach(card => card.update());
    gameState.opponent.queuedCards.forEach(card => card.update());
    gameState.player.playedCards.slice(-5).forEach(card => card.update());
    gameState.opponent.playedCards.slice(-5).forEach(card => card.update());

    renderer.render(scene, camera);
  }
}


window.endTheGame = async function() {
  const confirmEnd = confirm("Are you sure you want to end the game? This will count as a loss.");
  if (!confirmEnd) return;

  console.log("Game ended. Counting as player loss.");

  // Clear the scene and stop animations/timers
  if (window.cancelAnimationFrame) window.cancelAnimationFrame(window.animationFrameId);
  if (gameState.turnTimer) clearInterval(gameState.turnTimer);
  if (gameState.opponentQueueTimer) clearTimeout(gameState.opponentQueueTimer);

  try {
    // 🟩 Dynamically get Supabase client via updated supabaseClient.js
    const { supabase } = await import('./supabaseClient.js');

    const { data: user, error: userError } = await supabase.auth.getUser();
    if (userError || !user?.user) {
      console.warn("No user session found. Stats not updated.");
    } else {
      const userId = user.user.id;

      // Update local game state
      gameState.player.winStreak = 0;
      gameState.player.totalLosses += 1;

      // Update Supabase stats
      await updateUserStats(
        userId,
        gameState.player.totalWins,
        gameState.player.totalLosses,
        gameState.player.winStreak
      );

      console.log("Loss counted in database.");
    }
  } catch (error) {
    console.error("Failed to update loss in database:", error);
  }

  // Return to the main menu
  returnToMenu();

  // Refresh the stats on the menu after a short delay
  
  setTimeout(() => {
    refreshPlayerStats();
  }, 500);
};


async function refreshPlayerStats() {
  console.log("Refreshing player stats...");

  try {
    // 🟩 Use dynamically loaded supabase client
    const { supabase } = await import('./supabaseClient.js');

    const { data: user } = await supabase.auth.getUser();
    if (!user?.user) {
      console.warn("No user session. Skipping stats refresh.");
      return;
    }

    const userId = user.user.id;
    const { data: stats, error } = await supabase.from('users').select('total_wins, total_losses, win_streak').eq('id', userId).single();
    if (error) {
      console.error("Failed to fetch updated stats:", error);
      return;
    }

    console.log("Updated stats:", stats);

    document.getElementById('totalWins').textContent = `Wins: ${stats.total_wins}`;
    document.getElementById('totalLosses').textContent = `Losses: ${stats.total_losses}`;
    document.getElementById('winStreak').textContent = `Win Streak: ${stats.win_streak}`;
    console.log("Player stats refreshed in the menu!");
  } catch (error) {
    console.error("Error refreshing stats:", error);
  }
}

function onTouchStart(event) {
  if (gameState.isPaused || !event.touches.length) return;
  const touch = event.touches[0];
  handleMouseDownLikeInput(touch.clientX, touch.clientY);
}

function onTouchMove(event) {
  if (gameState.isPaused || !event.touches.length) return;
  const touch = event.touches[0];
  handleMouseMoveLikeInput(touch.clientX, touch.clientY);
}

function onTouchEnd(event) {
  if (gameState.isPaused) return;
  handleMouseUpLikeInput();
}

function handleMouseDownLikeInput(x, y) {
  mouse.x = (x / window.innerWidth) * 2 - 1;
  mouse.y = -(y / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(scene.children);
  if (intersects.length > 0) {
    const card = intersects[0].object.userData;
    if (gameState.player.hand.includes(card)) {
      gameState.draggingCard = card;
      gameState.selectedCard = card;
    }
  }
}

function handleMouseMoveLikeInput(x, y) {
  mouse.x = (x / window.innerWidth) * 2 - 1;
  mouse.y = -(y / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const tooltip = document.getElementById('cardTooltip');
  const intersects = raycaster.intersectObjects(scene.children);

  let hovered = false;
  if (intersects.length > 0) {
    const card = intersects[0].object.userData;
    const allCards = [...gameState.player.hand, ...gameState.player.playedCards.slice(-5), ...gameState.opponent.playedCards.slice(-5)];

    if (card && allCards.includes(card)) {
      hovered = true;
      const isPlayedCard = gameState.player.playedCards.includes(card) || gameState.opponent.playedCards.includes(card);
      const scale = isPlayedCard ? 1 : 2;
      card.mesh.scale.set(scale, scale, scale);
      card.mesh.position.z = 2;

      const currentTexture = card.mesh.material?.uniforms?.cardTexture?.value;
      if (card.isPlayer || (currentTexture && currentTexture.image && currentTexture.image.src === card.data.texture)) {
        tooltip.style.display = 'block';
        tooltip.style.left = `${x + 10}px`;
        tooltip.style.top = `${y - 10}px`;
        tooltip.innerHTML = `${card.data.name}<br>Cost: ${card.data.cost} | Attack: ${card.data.attack} | Health: ${card.data.health}${card.data.ability ? '<br>' + card.data.ability : ''}`;
      } else {
        tooltip.style.display = 'none';
      }
    }
  }

  if (!hovered) {
    [...gameState.player.hand, ...gameState.player.playedCards.slice(-5), ...gameState.opponent.playedCards.slice(-5)].forEach(card => {
      const isPlayedCard = gameState.player.playedCards.includes(card) || gameState.opponent.playedCards.includes(card);
      const scale = isPlayedCard ? 0.25 : 1;
      card.mesh.scale.set(scale, scale, scale);
      card.targetPosition.z = 0.5;
    });
    tooltip.style.display = 'none';
  }
}

function handleMouseUpLikeInput() {
  if (!gameState.draggingCard) return;
  if (mouse.y < -0.2) {
    playCard(gameState.draggingCard);
  }
  gameState.draggingCard = null;
  gameState.selectedCard = null;
}



      

window.addEventListener('mousemove', onMouseMove);
window.addEventListener('mousedown', onMouseDown);
window.addEventListener('mouseup', onMouseUp);

window.addEventListener('touchstart', onTouchStart, { passive: false });
window.addEventListener('touchmove', onTouchMove, { passive: false });
window.addEventListener('touchend', onTouchEnd, { passive: false });
