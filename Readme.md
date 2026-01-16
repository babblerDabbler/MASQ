# the MASQuerades

> *The complete on-chain strategic collectible card game with native token integration—powered by vanilla JS, Supabase, and WebGL via Three.js.*

> [Official MASQ website](https://www.masq.club/)

![MASQ Logo](/assets/00banner11.gif)

CA: 

---

## 📌 Project Overview

**MASQ** is a free-to-play, browser-based PvP card game where players engage in on-chain battles using collectible NFT-like cards powered by the $MASQ token. It seamlessly blends strategy, lore, tokenomics, and immersive visuals into a Web3-native gaming experience.

---

## 🔥 Core Features

- 🔗 On-chain multiplayer card duels  
- 💰 Native token ($MASQ) for staking, rewards, and pack purchases  
- 🧠 Dynamic deck system with draw/play/mana mechanics  
- 🔐 Integrated Supabase backend for authentication and user tracking  
- 🖥️ HTML/CSS/JS front-end with WebGL rendering (Three.js)  

---

## Vision and Philosophy

MASQuerades champions:

- 🎯 **Fair Play**: No presales or unfair advantages.  
- 🤝 **Community Ownership**: Majority of tokens go to the community.  
- 🧠 **Dynamic Strategy**: Combos, bluffing, and skillful play.  
- 🌐 **Decentralized Governance**: Players shape the game’s future.  
- 🤖 **AI Battles**: Play against Grok AI — the first of its kind.

---

## Gameplay Overview

Turn-based battles against Grok, AI opponent powered by xAPI. Cards have attack, health, and abilities. Mana grows each turn. Win by reducing your opponent’s health to zero.

![MASQ gameplay](/assets/gameplay.png)

### Combat Mechanics

- Draw and play cards  
- Spend mana  
- Attack and defend  
- Win by reducing opponent HP to 0

**Card Types**:

- **Attackers**: Deal damage  
- **Defenders**: Absorb damage  
- **Utility**: Control the game board  

### Field Placement & Strategy

Cards are placed strategically on the field to control tempo, defense lines, and combos. Decision-making on placement is as important as the card itself.

### Combo System

**Combos** are essential to high-level play:

- **Trigger Abilities**: Activate when played after certain cards  
- **Chain Effects**: Refund mana, draw more, or boost stats  
- **Adaptive Play**: Force reactive strategies

**Example Combo**:

1. `Mana Surge Initiator` – Boost mana this turn  
2. `Whispers of the Ancients` – Draw 2 cards if mana was boosted  
3. `Overload Blast` – Spend extra mana to deal massive damage  

---

## Card Sets and Expansions

- **Core Set**: Balanced entry decks  
- **Golden Cards**: Rare and collectible; no ability but high status  
- **Expansions**: Future sets based on degen lore and meme culture  

---

## Technical Implementation

### 📂 File Structure

```
MASQ-main/
├── index.html         # Landing page and routing
├── game.js            # Core turn-based battle logic
├── cards.js           # Card database + deck builder
├── auth.js            # Supabase user logic + win/loss stats
├── buy.html           # $MASQ token-based pack purchase page
├── buy.js             # Wallet interaction + token transfer
├── cards.html         # Gallery view of all available cards
├── styles.css         # UI design, effects, layout
├── assets/            # Card art, icons, animations
├── utils.js           # Helper functions for game logic
├── threeSetup.js      # Canvas setup for effects
├── supabaseClient.js  # DB connection utility
└── api/supabaseKeys   # Serverless endpoint for secure keys
```

---

### 🔧 index.html – Landing Page

- **Fonts**: Orbitron (UI titles), Roboto (UI text), Cinzel (card flavor)  
- **Favicon**: `/assets/logomasq1-g11o.gif`  
- **Navigation**: Home → About, Cards, Buy, Play  
- **Design**: Full-page canvas layout, future shader-ready  

---

### 🎮 game.js – Core Gameplay Logic

- `gameState`: Stores health, mana, deck, hand, played cards for both players  
- **Deck Init**: Pulls from `cardLibrary`, shuffled using `utils.js`  
- **Turn Timer**: `turnTimeLeft` countdown per round  
- **Mana Curve**: Gradually increases per turn  
- **Win Condition**: Health reaches 0 → triggers endgame + updates Supabase  

---

### 🃏 cards.js – Card Library & Deck Logic

#### Total cards count during launch: 75
[View all cards](https://www.masq.club/cards)

#### 📜 Card Schema

```js
{
  id: Number,
  name: String,
  cost: Number,
  attack: Number,
  health: Number,
  texture: String,
  weight: Number,
  lore: String
}
```

#### 🔥 Sample Cards

```js
{
id: 6,
name: "Solana Chain Diviner",
cost: 3,
attack: 1,
health: 0,
ability: "Draw 3 cards", texture: "/cards/a6.webp",
weight: 2,
lore: "Sees futures in the hashes of the solana blockchain."
},
```
![MASQ#6](/cards/a6.webp)

```js
{
id: 36,
name: "Singularity Masquerade",
cost: 9,
attack: Infinity,
health: Infinity,
ability: "Win the game if your total draw count this turn is 7 or more.",
texture: "/cards/a36.webp",
weight: 0,
lore: "Forged from every chain, born of every whisper, the masked Singularity descends when probability itself is breached. One move, one revelation, all fates converge."
},
```

![MASQ#36](/cards/a36.webp)

```js
{
  id: 73,
  name: "Golden Shard Titan",
  cost: 9,
  attack: 10,
  health: 10,
  texture: "/cards/a73.png",
  weight: 0,
  lore: "A colossus of molten value, towering over the blockchain’s shifting sands."
}
```
![MASQ#73](/cards/g5.webp)
#### 🧩 Deck Logic

- Draws based on `weight` for rarity  
- Supports multiple sets (Core, Expansion)  
- **Planned Features**:  
  - Card abilities (onDraw, onDeath, etc.)  
  - Set unlocking via `ownedSets`  
  - Visual deck builder interface  

---

### 🔐 auth.js – Supabase Auth Integration

#### Functions

- `ensureUserInDB(id, email)` – Adds new player to DB if not found  
- `getUserStats(id)` – Fetches `total_wins`, `total_losses`, `win_streak`  
- `updateUserStats(id, win)` – Increments stats after match ends  

> No auth tokens are stored in local storage.  
> Stats are updated after every match via Supabase.

---

### 💸 buy.html + buy.js – $MASQ Token Pack Purchase

#### buy.html

- Connects wallet  
- Renders buy button  
- Displays animated pack graphic  

#### buy.js

- Uses `@solana/web3.js`  
- Checks for associated token account using `getAssociatedTokenAddress()`  
- Transfers $MASQ to treasury  
- Adds purchased pack to user’s DB profile  

---

### 🎴 cards.html – Card Gallery

- Loads all cards from `cards.js`  
- Shows: name, attack, health, cost, flavor text  
- Responsive mobile-friendly grid layout  
- Hover reveals stats  
- Filter and sort feature in development  

---

### 🧠 utils.js – Helper Functions

- `shuffle(array)` – Fisher-Yates randomizer  
- `getRandomInt(min, max)` – For random targeting/draws  
- `delay(ms)` – Adds artificial pacing/delay for animations  

---

### 📽 threeSetup.js – 3D/WebGL Canvas Setup

- Basic Three.js setup with:
  - `THREE.Scene`
  - `PerspectiveCamera`
  - `WebGLRenderer`

> Placeholder system – extend with:
- Card glow effects  
- Particle attack bursts  
- Environmental shaders  

---

### 🎨 styles.css – Styling & Theme

- Fonts: Orbitron, Roboto, Cinzel  
- `.card`: Red glow border on hover  
- `.about-container`, `.timeline-item`: Styled containers  
- Custom red glowing cursor  
- Responsive breakpoints for phones & tablets  
- **Color Theme**:  
  - Red `#FF0000`  
  - Gold `#FFD700`  
  - Black `#000000`  

---

### 🧬 supabaseClient.js – Secure DB Client

```js
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

- Used across `auth.js`, `buy.js`, `game.js`  
- Keys securely loaded via `/api/supabaseKeys` serverless endpoint  

---

### 🗄️ Supabase Database Schema


- `ownedSets`: Controls access to card sets  
- `win_streak`: Unlocks cosmetic or leaderboard features  

---

### 🚀 Deployment Guide

#### Tech Stack

- ✅ **Vercel** for frontend CI/CD  
- ✅ **Supabase** for auth + DB  
- ✅ **Solana Wallet** via Phantom/Helius SDK  

#### Setup Instructions

```bash
git clone https://github.com/yourhandle/masq
cd masq
yarn install
vercel deploy
```

> Ensure `.env` or serverless `/api/supabaseKeys` securely exposes Supabase URL and key.

---

### 📸 Screenshots & Visual References

All stored under `/docs/assets/`

```
docs/assets/
├── masq-banner.png
├── index-preview.png
├── game-flow.png
├── card-example.png
├── card-gallery.png
├── buy-flow.png
├── style-theme.png
├── dir-structure.png
```

---

## Art & Visuals

A unique mix of:

- ⚔️ Ancient gold and lore-inspired visuals  
- 🕶️ Degen meme culture  
- 🌌 Neon cyberpunk style  

---

## Security & Fair Play

- Immutable on-chain logic  
- Anti-cheat systems  
- Wallet verification for fair access  
- No duplicate account exploitation  

---

## 🗺️ Roadmap: Upcoming Features

### 🔐 Solana Wallet Integration  
Enable login using Solana wallets for decentralized authentication and asset access.  
*Current: Wallets are used for purchases, not login.*

### 🆚 Online Multiplayer PvP Gameplay  
Real-time ranked PvP with matchmaking, season ladders, and skill tiers.

### 🛒 $MASQ Assets Marketplace  
Trade rare cards and collectibles on-chain with full transparency.

### 🎆 Enhanced Animations & Sounds  
Add immersive card animations and battle audio effects for richer gameplay.

### 📱 Mobile App Development  
Launch on iOS and Android with touch controls, sync, and offline mode.

### 🏆 Competitive Tournaments & Leaderboards  
Global events with $MASQ prizes, badges, and elite rewards.

### 📖 Expanded Game Modes & Story  
Add lore-rich single-player campaigns and co-op battle modes.

### 🎲 Staked PvP Arenas  
Allow players to stake $MASQ in high-risk PvP. Rewards based on win streaks and player rank.

---

## Legal Framework

MASQuerades is a game for entertainment. No financial guarantees.  
*DYOR (Do Your Own Research). Play responsibly.*

---

## Call to Action

Join the MASQ rebellion.  
🎮 Play.  
💬 Govern.  
🔥 Stay degen.  
Own your destiny.

---

## Disclaimers

- Blockchain assets are volatile.  
- MASQ is not financial advice.  
- Always research before participating.  
- Game is for entertainment purposes only.  

---

## Contact

support@masq.club

---
