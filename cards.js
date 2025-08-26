
// cards.js

import { scene, cardBackMaterial } from "./threeSetup.js";

export const cardSets = [
  {
    id: 1,
    name: "Core Set",
    cards: [
      
            { id: 1, name: "Mog Masquaredes Broker", cost: 2, attack: 2, health: 3, texture: "/cards/a1.webp", weight: 4, lore: "A shadowy figure trading secrets for bitcoin in gilded parlors." },
            { id: 2, name: "Velvet Trump Enforcer", cost: 3, attack: 3, health: 2, texture: "/cards/a2.webp", weight: 3, lore: "Old money’s muscle, enforcing debts with silk-gloved fists and a trump card." },
            { id: 3, name: "Gilded Pepe Vault", cost: 2, attack: 0, health: 5, texture: "/cards/a3.webp", weight: 3, lore: "A crypt of wealth, safeguarding fortunes in blockchain with pepe memes." },
            { id: 4, name: "Crypto AI Baron", cost: 6, attack: 5, health: 0, texture: "/cards/a4.webp", weight: 2, lore: "A lord of digital gold, ruthless in his ledgered empire powered by AI." },
            { id: 5, name: "Ledger Pwease Whisper", cost: 1, attack: 0, health: 0, ability: "Draw 2 cards", texture: "/cards/a5.webp", weight: 5, lore: "A soft voice unravels the blockchain’s secrets, saying 'pwease' to unlock." },
            { id: 6, name: "Solana Chain Diviner", cost: 3, attack: 1, health: 0, ability: "Draw 3 cards", texture: "/cards/a6.webp", weight: 2, lore: "Sees futures in the hashes of the solana blockchain." },
            { id: 7, name: "Silk Archivist", cost: 4, attack: 0, health: 2, ability: "Draw 2 cards, gain 2 max mana next turn", texture: "/cards/a7.webp", weight: 2, lore: "Chronicles wealth in velvet-bound tomes." },
            { id: 8, name: "Yield Nexus", cost: 4, attack: 2, health: 2, ability: "Combo: +2 Attack if played after Quantum Seer", texture: "/cards/a8.webp", weight: 3, lore: "A confluence of liquidity pools amplifying returns through cross-chain arbitrage." },
            { id: 9, name: "Immutable Citadel", cost: 5, attack: 0, health: 4, ability: "Combo: +3 Health if played after Hash Sentinel", texture: "/cards/a9.webp", weight: 2, lore: "An unassailable bastion forged in the crucible of zero-knowledge proofs." },
            { id: 10, name: "Encrypted Covenant", cost: 3, attack: 1, health: 1, ability: "Combo: Draw 2 cards if played after Token Wraith", texture: "/cards/a10.webp", weight: 3, lore: "A binding pact secured by homomorphic encryption, whispering futures across shards." },
            { id: 11, name: "Gas Arbitrator", cost: 2, attack: 1, health: 1, ability: "Draw 1 card", texture: "/cards/a11.webp", weight: 3, lore: "Optimizes transaction fees with surgical precision, threading the needle of layer-2 efficiency." },
            { id: 12, name: "Aurum Enclave", cost: 5, attack: 4, health: 3, texture: "/cards/a12.webp", weight: 2, lore: "A sovereign domain where tokenized gold anchors the volatility of synthetic assets." },
            { id: 13, name: "Hash Sentinel", cost: 3, attack: 2, health: 2, texture: "/cards/a13.webp", weight: 3, lore: "A vigilant guardian of consensus, its vigilance etched into the immutable ledger." },
            { id: 14, name: "Layer Phantom", cost: 4, attack: 3, health: 1, texture: "/cards/a14.webp", weight: 2, lore: "An ephemeral presence flitting between rollups, unseen yet omnipresent." },
            { id: 15, name: "Token Wraith", cost: 2, attack: 1, health: 2, texture: "/cards/a15.webp", weight: 3, lore: "A spectral entity haunting the mempool, siphoning value from unconfirmed trades." },
            { id: 16, name: "Consensus Arbiter", cost: 3, attack: 2, health: 3, texture: "/cards/a16.webp", weight: 2, lore: "Mediates disputes in the council of nodes, enforcing the will of the protocol." },
            { id: 17, name: "Staked Razor", cost: 4, attack: 4, health: 1, texture: "/cards/a17.webp", weight: 2, lore: "A precision instrument honed by proof-of-stake, slicing through inefficiency." },
            { id: 18, name: "Liquidity Veil", cost: 2, attack: 2, health: 1, texture: "/cards/a18.webp", weight: 3, lore: "A shimmering curtain of pooled assets, obscuring the depths of market intent." },
            { id: 19, name: "Shard Custodian", cost: 5, attack: 3, health: 4, texture: "/cards/a19.webp", weight: 2, lore: "Oversees the fragmented realms of a sharded blockchain, ensuring synchronicity." },
            { id: 20, name: "Oracle Striker", cost: 3, attack: 3, health: 1, texture: "/cards/a20.webp", weight: 3, lore: "Delivers truth from off-chain realms with the force of a validated prophecy." },
            { id: 21, name: "Ethereal Custody", cost: 4, attack: 2, health: 3, texture: "/cards/a21.webp", weight: 2, lore: "Holds assets in a liminal state, bridging custodial and non-custodial domains." },
            { id: 22, name: "Foresight Miner", cost: 2, attack: 1, health: 2, texture: "/cards/a22.webp", weight: 3, lore: "Extracts predictive signals from the noise of on-chain analytics." },
            { id: 23, name: "Proof Enforcer", cost: 5, attack: 4, health: 2, texture: "/cards/a23.webp", weight: 2, lore: "Upholds the integrity of the network with the weight of cryptographic certainty." },
            { id: 24, name: "DeFi Mediator", cost: 3, attack: 2, health: 2, texture: "/cards/a24.webp", weight: 3, lore: "Facilitates trustless exchanges across decentralized financial primitives." },
            { id: 25, name: "Quantum Seer", cost: 4, attack: 3, health: 3, texture: "/cards/a25.webp", weight: 2, lore: "Peers into superpositioned futures, divining outcomes from quantum consensus." },
            { id: 26, name: "Nonce Riddle", cost: 2, attack: 1, health: 1, texture: "/cards/a26.webp", weight: 3, lore: "A cryptographic puzzle guarding the sanctity of the next block." },
            { id: 27, name: "Chain Echo", cost: 3, attack: 2, health: 2, texture: "/cards/a27.webp", weight: 2, lore: "Resonates across forks, amplifying the signal of the true chain." },
            { id: 28, name: "Vault Sovereign", cost: 5, attack: 4, health: 3, texture: "/cards/a28.webp", weight: 2, lore: "Commands the reserves of a tokenized empire, unyielding in its dominion." },
            { id: 29, name: "Slippage Fang", cost: 3, attack: 3, health: 1, texture: "/cards/a29.webp", weight: 3, lore: "Exploits market deltas with predatory precision, thriving in volatility." },
            { id: 30, name: "Beacon Shade", cost: 4, attack: 2, health: 3, texture: "/cards/a30.webp", weight: 2, lore: "Guides validators through the fog of decentralized networks." },
            { id: 31, name: "Liquidity Mogul", cost: 4, attack: 3, health: 3, texture: "/cards/a31.webp", weight: 2, lore: "Orchestrates capital flows with the finesse of a DeFi magnate." },
            { id: 32, name: "Protocol Edict", cost: 5, attack: 4, health: 2, texture: "/cards/a32.webp", weight: 1, lore: "A mandate encoded in smart contracts, reshaping market dynamics." },
            { id: 33, name: "Meme Consensus", cost: 2, attack: 1, health: 1, ability: "Draw 1 card", texture: "/cards/a33.webp", weight: 3, lore: "Harnesses the virality of community sentiment to forge new value." },
            { id: 34, name: "Neural Relay", cost: 3, attack: 2, health: 2, texture: "/cards/a34.webp", weight: 2, lore: "A synthetic intelligence bridging AI and blockchain for seamless execution." },
            { id: 35, name: "Sat Surge", cost: 6, attack: 5, health: 4, texture: "/cards/a35.webp", weight: 1, lore: "A tidal wave of microtransactions, powered by the smallest unit of sovereignty." },
            { id: 36, name: "Singularity Masquerade", cost: 9, attack: Infinity, health: Infinity, ability: "Win the game if your total draw count this turn is 7 or more.", texture: "/cards/a36.webp", weight: 0, lore: "Forged from every chain, born of every whisper, the masked Singularity descends when probability itself is breached. One move, one revelation, all fates converge." },
            { id: 37, name: "Whisper Scripter", cost: 1, attack: 0, health: 1, ability: "Combo: Copy the last ability used this turn.", texture: "/cards/a37.webp", weight: 4, lore: "Etches secrets into silent ledgers, replicating power without a trace." },
            { id: 38, name: "Mnemonic Curator", cost: 5, attack: 3, health: 4, ability: "When this enters play, recall 1 random card you've played this game to your hand.", texture: "/cards/a38.webp", weight: 3, lore: "They walk the velvet archives of memory, pulling data from dusk and dream alike." },
            { id: 39, name: "Byteflame Blitzer", cost: 3, attack: 5, health: 1, texture: "/cards/a39.webp", weight: 3, lore: "Surges through memory lanes, scorching validators with speed and style." },
            { id: 40, name: "Gaslight Rogue", cost: 2, attack: 2, health: 2, ability: "Combo: Draw 1 card and gain +1 Attack", texture: "/cards/a40.webp", weight: 4, lore: "Wields illusion and latency to obscure intent, then strikes." },
            { id: 41, name: "Darkpool Revenant", cost: 4, attack: 4, health: 2, ability: "Steal 1 random card from opponent's hand", texture: "/cards/a41.webp?v=1743097221432", weight: 2, lore: "Risen from buried transactions to claim what's hidden." },
            { id: 42, name: "Token Talon", cost: 3, attack: 3, health: 3, texture: "/cards/a42.webp", weight: 3, lore: "A raptor forged in layer-two flames, tearing through inefficiency." },
            { id: 43, name: "Streak Catalyst", cost: 5, attack: 5, health: 2, ability: "Gain +1 Attack per win in your streak", texture: "/cards/a43.webp", weight: 1, lore: "Each victory feeds its fire. The longer the streak, the brighter it burns." },
            { id: 44, name: "Rage Blade Fiend", cost: 2, attack: 5, health: 1, texture: "/cards/a44.webp", weight: 3, lore: "A whirlwind of steel and fury, slicing through chains with reckless abandon." },
            { id: 45, name: "Rage Ember Wraith", cost: 1, attack: 4, health: 1, texture: "/cards/a45.webp", weight: 4, lore: "Born from the ashes of a burned ledger, it scorches all in a fiery tantrum." },
            { id: 46, name: "Rage Chainbreaker", cost: 3, attack: 6, health: 2, texture: "/cards/a46.webp", weight: 2, lore: "Shatters blockchain shackles with a roar, leaving chaos in its wake." },
            { id: 47, name: "Rage Blood Hacker", cost: 2, attack: 5, health: 1, texture: "/cards/a47.webp", weight: 3, lore: "Frenzied code-slicer, bleeding data from the network in a crimson rage." },
            { id: 48, name: "Rage Storm Caller", cost: 3, attack: 6, health: 1, texture: "/cards/a48.webp", weight: 2, lore: "Summons a tempest of wrath, striking nodes with lightning-fueled madness." },
            { id: 49, name: "Rage Shard Reaver", cost: 1, attack: 4, health: 2, texture: "/cards/a49.webp", weight: 4, lore: "Rips through sharded realms, a berserker lost to its own fury." },
            { id: 50, name: "Rage Flux Marauder", cost: 2, attack: 5, health: 1, texture: "/cards/a50.webp", weight: 3, lore: "A volatile force of flux and rage, pillaging the mempool with glee." },
            { id: 51, name: "Rage Byte Berserker", cost: 3, attack: 6, health: 1, texture: "/cards/a51.webp", weight: 2, lore: "Bytes bend and break under its savage assault, a digital warlord unleashed." },
            { id: 52, name: "Rage Pulse Ravager", cost: 2, attack: 5, health: 2, texture: "/cards/a52.webp", weight: 3, lore: "Pulses with unhinged energy, tearing through consensus with wild abandon." },
            { id: 53, name: "Rage Fury Igniter", cost: 3, attack: 6, health: 1, ability: "Combo: +2 Attack if played after Rage Ember Wraith", texture: "/cards/a53.webp", weight: 2, lore: "Ignites the embers of rage into a blazing inferno, unstoppable and unhinged." },
            { id: 54, name: "Chain Hydra Prime", cost: 8, attack: 7, health: 7, texture: "/cards/a54.webp", weight: 1, lore: "Born of forked chains and failed consensus, its many heads devour blockspace and breathe latency." },
            { id: 55, name: "DAO Colossus", cost: 9, attack: 8, health: 8, texture: "/cards/a55.webp", weight: 1, lore: "Forged by collective will, its every strike echoes governance gone awry and victorious." },
            { id: 56, name: "Obsidian Smart Core", cost: 7, attack: 6, health: 9, texture: "/cards/a56.webp", weight: 1, lore: "An AI-driven bastion executing perfect code, impervious to entropy or exploit." },
            { id: 57, name: "Reorg Trickster", cost: 4, attack: 2, health: 2, ability: "Combo: If opponent played a card this turn, copy and play it for 0 mana.", texture: "/cards/a57.webp", weight: 4, lore: "He dances through consensus shadows, stealing futures that never were." },
            { id: 58, name: "Mnemonic Detonator", cost: 5, attack: 3, health: 3, ability: "Combo: Destroy all cards in enemy's hand", texture: "/cards/a58.webp", weight: 2, lore: "A whisper from your past detonates memory-borne obliteration." },
            { id: 59, name: "Fork Echo Walker", cost: 3, attack: 1, health: 2, ability: "Combo: Replay the last ability used by any player this game.", texture: "/cards/a59.webp", weight: 3, lore: "It treads the spectral remnants of decisions undone, echoing power unclaimed." },
            { id: 60, name: "Mempool Hound", cost: 4, attack: 6, health: 1, texture: "/cards/a60.webp", weight: 3, lore: "It hunts pending transactions with feral glee, leaving scorched entries behind." },
            { id: 61, name: "Flash Loan Marauder", cost: 5, attack: 7, health: 2, texture: "/cards/a61.webp", weight: 2, lore: "He borrows entire kingdoms of liquidity—then burns the books before dusk." },
            { id: 62, name: "Shimmer Spiker", cost: 4, attack: 5, health: 1, texture: "/cards/a62.webp", weight: 3, lore: "A glass-laced strike from the rollup realm, razor-sharp and gone before the blink." },
            { id: 63, name: "Chrono Root Singularity", cost: 10, attack: 10, health: 10, ability: "All timers reset. All cooldowns lifted. All cards become playable this turn.", texture: "/cards/a63.webp", weight: 0, lore: "The root from which all forks sprout and timelines collapse into now." },
            { id: 64, name: "Genesis Burn Protocol", cost: 9, attack: 12, health: 1, texture: "/cards/a64.webp", weight: 1, lore: "The original fire of the first transaction, reborn as unrelenting judgment." },
            { id: 65, name: "Infinite Finality Wall", cost: 10, attack: 0, health: 12, texture: "/cards/a65.webp", weight: 0, lore: "No consensus breaks it. No exploit cracks it. Only time may dissolve its permanence." },
            { id: 66, name: "Dust Indexer", cost: 1, attack: 0, health: 1, ability: "Draw 1 card. If it costs 1, draw another.", texture: "/cards/a66.webp", weight: 4, lore: "Rummages through the detritus of the ledger, sifting for overlooked value." },
            { id: 67, name: "Node Librarian", cost: 4, attack: 2, health: 3, ability: "Draw 2 cards. If both are unique types, gain +1 mana next turn.", texture: "/cards/a67.webp", weight: 3, lore: "Curates the knowledge of every node, connecting ideas across fractured data streams." },
            { id: 68, name: "Hyperledger Oracle", cost: 7, attack: 4, health: 6, ability: "Draw 3 cards. If any of those 3 cards is a draw card, draw number of cards equal to the first draw card again.", texture: "/cards/a68.webp", weight: 1, lore: "Its memory spans every fork, recalling futures where knowledge becomes cheaper." },
            { id: 74, name: "Bonk Pup", cost: 0, attack: 5, health: 3, ability: "Battlecry: Draw a card. If it costs 2 or less, gain +1 Attack this turn.", texture: "/cards/a69.webp", weight: 4,lore: "A scrappy Solana street pup, scrounging dust and sparking community chaos."},
            { id: 75, name: "Pump.fun Meme Forge", cost: 10, attack: 10, health: 10, ability: "Battlecry: Create two 1‑cost Meme Tokens with 5/5 stats (vanish at end of turn).", texture: "/cards/a71.webp", weight: 1, lore: "A turbocharged minting rig spewing meme monsters in waves, burning bright before the dump."}
        ],
  },
  {
    id: 2,
    name: "Expansion Set",
    cards: [ 
            { id: 69, name: "Golden Ledger Baron", cost: 4, attack: 5, health: 5, texture: "/cards/g1.webp", weight: 3, lore: "A gilded king of capital flows, unbothered by the whispers of the chain."},
            { id: 70, name: "Auric Chain Guardian", cost: 6, attack: 7, health: 7, texture: "/cards/g2.webp", weight: 1, lore: "Sentinel of an empire in gold, standing watch over every byte of wealth."},
            { id: 71, name: "Shimmer Golem", cost: 5, attack: 6, health: 6, texture: "/cards/g3.webp", weight: 2, lore: "Forged in the crucible of token speculation, a silent testament to opulence."},
            { id: 72, name: "Aurora Sovereign", cost: 7, attack: 8, health: 8, texture: "/cards/g4.webp", weight: 2, lore: "His crown is the sunrise of every ledger, each gleam a promise of untold riches."},
            { id: 73, name: "Golden Shard Titan", cost: 9, attack: 10, health: 10, texture: "/cards/g5.webp", weight: 1, lore: "A colossus of molten value, towering over the blockchain’s shifting sands."}
  ],
  },
  ]

export const memeToken = {
  id: 999,
  name: "Meme Token",
  cost: 1,
  attack: 5,
  health: 5,
  ability: "Ephemeral: Vanishes after one turn.",
  texture: "/cards/a71.webp",
  weight: 0,
  lore: "Short-lived. Meme-ified. Market fodder."
};

// --- Shader Code (inline for browser compatibility) ---
const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = `
    uniform sampler2D cardTexture;
    varying vec2 vUv;

    void main() {
        vec4 texColor = texture2D(cardTexture, vUv);

        float borderWidth = 0.03;
        float borderGlow = smoothstep(0.0, borderWidth, vUv.x) * smoothstep(0.0, borderWidth, 1.0 - vUv.x)
                         * smoothstep(0.0, borderWidth, vUv.y) * smoothstep(0.0, borderWidth, 1.0 - vUv.y);

        vec3 glowColor = mix(vec3(1.0, 0.84, 0.0), texColor.rgb, 0.9); // gold glow
        vec3 finalColor = mix(glowColor, texColor.rgb, borderGlow);

        gl_FragColor = vec4(finalColor, texColor.a);
    }
`;

// --- Card Class ---
export class Card {
  constructor(data, isPlayer) {
    this.data = { ...data };
    this.isPlayer = isPlayer;
    this.mesh = this.createCardMesh();
    this.targetPosition = new THREE.Vector3();
    this.targetRotation = new THREE.Euler();
  }

  createCardMesh() {
  // Detect screen width
  const isMobile = window.innerWidth <= 768;

  // Smaller size for mobile
  const width = isMobile ? 1.2 : 2;
  const height = isMobile ? 1.8 : 3;

  const geometry = new THREE.PlaneGeometry(width, height);
  const texture = new THREE.TextureLoader().load(this.data.texture);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      cardTexture: { value: this.isPlayer ? texture : cardBackMaterial.map },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = this;
  scene.add(mesh);
  return mesh;
}

  reveal() {
    if (!this.isPlayer) {
      const texture = new THREE.TextureLoader().load(this.data.texture);
      this.mesh.material.uniforms.cardTexture.value = texture;
      this.mesh.material.needsUpdate = true;
    }
  }

  update() {
    this.mesh.position.lerp(this.targetPosition, 0.1);
    this.mesh.rotation.x +=
      (this.targetRotation.x - this.mesh.rotation.x) * 0.1;
    this.mesh.rotation.y +=
      (this.targetRotation.y - this.mesh.rotation.y) * 0.1;
    this.mesh.rotation.z +=
      (this.targetRotation.z - this.mesh.rotation.z) * 0.1;
  }
}
