// ui.js
import { gameState, startTurnTimer, animate, opponentQueueCard, resolveTurn, canComputerQueueMore } from './game.js';
import { cardSets } from './cards.js';

export function updateUI() {
  if (!gameState || !document.getElementById('playerHealth')) return;

  document.getElementById('playerHealth').textContent = gameState.player.health;
  document.getElementById('playerHealthFill').style.width = `${(gameState.player.health / gameState.player.maxHealth) * 100}%`;
  document.getElementById('playerMana').textContent = gameState.player.mana;
  document.getElementById('playerMaxMana').textContent = gameState.player.maxMana;
  document.getElementById('playerManaFill').style.width = `${(gameState.player.mana / gameState.player.maxMana) * 100}%`;
  document.getElementById('winStreak').textContent = gameState.player.winStreak;
  document.getElementById('opponentHealth').textContent = gameState.opponent.health;
  document.getElementById('opponentHealthFill').style.width = `${(gameState.opponent.health / gameState.opponent.maxHealth) * 100}%`;
  document.getElementById('opponentMana').textContent = gameState.opponent.mana;
  document.getElementById('opponentMaxMana').textContent = gameState.opponent.maxMana;
  document.getElementById('opponentManaFill').style.width = `${(gameState.opponent.mana / gameState.opponent.maxMana) * 100}%`;
  document.getElementById('turnTimer').textContent = gameState.turnTimeLeft;
  document.getElementById('totalWins').textContent = gameState.player.totalWins;
  document.getElementById('totalLosses').textContent = gameState.player.totalLosses;
  document.getElementById('gameWinStreak').textContent = gameState.player.winStreak;
}

export function log(message) {
  const logDiv = document.getElementById('gameLog');
  const entry = document.createElement('div');
  entry.textContent = message;
  logDiv.appendChild(entry);
  logDiv.scrollTop = logDiv.scrollHeight;
}

export function initUIEvents() {
  document.getElementById('endTurnBtn').addEventListener('click', async () => {
    if (!gameState.isPaused && gameState.isTurnActive) {
      // In PVP mode, use PVP end turn logic (sends data to server)
      if (gameState.pvpMode) {
        const { pvpEndTurn } = await import('./pvp.js');
        pvpEndTurn();
        return;
      }
      gameState.playerReady = true;
      log("Player is ready to end turn");
    }
  });

  document.getElementById('pauseBtn').addEventListener('click', () => {
    // Disable pause in PVP mode (can't pause a real-time match)
    if (gameState.pvpMode) {
      log("Cannot pause during a PVP match");
      return;
    }

    gameState.isPaused = !gameState.isPaused;
    document.getElementById('pauseBtn').textContent = gameState.isPaused ? "Resume" : "Pause";
    log(gameState.isPaused ? "Game paused" : "Game resumed");

    if (gameState.isPaused) {
      clearInterval(gameState.turnTimer);
      clearInterval(gameState.opponentQueueTimer);
      log("Timers paused");
    } else if (gameState.isTurnActive) {
      log(`Resuming turn with ${gameState.turnTimeLeft} seconds left`);

      // Restart turn timer
      gameState.turnTimer = setInterval(() => {
        if (!gameState.isPaused) {
          gameState.turnTimeLeft--;
          updateUI();
          log(`Turn time left: ${gameState.turnTimeLeft}`);
          if (gameState.turnTimeLeft <= 0 || (gameState.playerReady && gameState.computerReady)) {
            clearInterval(gameState.turnTimer);
            clearInterval(gameState.opponentQueueTimer);
            log("Turn ending, resolving now");
            resolveTurn();
          }
        }
      }, 1000);

      gameState.opponentQueueTimer = setInterval(() => {
        if (!gameState.isPaused && gameState.isTurnActive && !gameState.computerReady) {
          log("Opponent attempting to queue a card");
          opponentQueueCard();
          if (!canComputerQueueMore()) {
            gameState.computerReady = true;
            log("Computer has finished queuing cards");
          }
        }
      }, 2000);

      animate();
    }
  });

  const howToPlayBtn = document.getElementById('howToPlayBtn');
  const howToPlayTooltip = document.getElementById('howToPlayTooltip');
  howToPlayBtn.addEventListener('mouseover', () => {
    howToPlayTooltip.textContent = `How to Play:
- Each player starts with 30 Health and 1 Mana (max 10).
- Draw 3 cards initially, then 1 per turn. Max. 10 cards at a time in hand.
- Click cards in your hand to the play area to queue them. Mana is deducted immediately.
- Press "End Turn" to apply queued cards' effects: Attack damages the opponent, Health heals you. Combo cards gain bonuses if played after specific cards.
- If you don’t press "End Turn," the turn ends after 20 seconds.
- Draw cards (e.g., Ledger Pwease Whisper) add cards to your hand.
- Win by reducing the opponent's health to 0. Win streaks increment but don’t affect mana.
- Empty deck? Fatigue deals damage each turn.`;
    howToPlayTooltip.style.display = 'block';
  });
  howToPlayBtn.addEventListener('mouseout', () => {
    howToPlayTooltip.style.display = 'none';
  });
}

initUIEvents();

export function hideGameUI() {
  document.getElementById('gameUI').style.display = 'none';
}
