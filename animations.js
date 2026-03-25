// animations.js - Comprehensive animation system for MASQ
// THREE is loaded globally via CDN

// ============================================================================
// ACCESSIBILITY: Reduced Motion Support
// ============================================================================

// Check if user prefers reduced motion
export const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;

// Shorter durations for users who prefer reduced motion
export function getAnimationDuration(normalDuration) {
  return prefersReducedMotion ? Math.min(normalDuration * 0.3, 100) : normalDuration;
}

// ============================================================================
// EASING FUNCTIONS
// ============================================================================

export const Easing = {
  // Basic easing
  linear: t => t,

  // Quad
  easeInQuad: t => t * t,
  easeOutQuad: t => t * (2 - t),
  easeInOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

  // Cubic
  easeInCubic: t => t * t * t,
  easeOutCubic: t => (--t) * t * t + 1,
  easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,

  // Elastic
  easeOutElastic: t => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1;
  },

  // Back (overshoot)
  easeOutBack: t => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeInBack: t => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },

  // Bounce
  easeOutBounce: t => {
    if (t < 1 / 2.75) {
      return 7.5625 * t * t;
    } else if (t < 2 / 2.75) {
      return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
    } else if (t < 2.5 / 2.75) {
      return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
    } else {
      return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
    }
  }
};

// ============================================================================
// ANIMATION MANAGER
// ============================================================================

class AnimationManager {
  constructor() {
    this.animations = [];
    this.isRunning = false;
    this._animationId = 0;
  }

  add(animation) {
    animation.id = ++this._animationId;
    this.animations.push(animation);
    if (!this.isRunning) {
      this.isRunning = true;
      this.update();
    }
    return animation;
  }

  // Cancel animations by object reference or tag
  cancel(target, tag = null) {
    this.animations = this.animations.filter(anim => {
      if (tag && anim.tag === tag) return false;
      if (anim.target === target) return false;
      return true;
    });
  }

  // Cancel all animations for a specific card
  cancelForCard(card) {
    this.animations = this.animations.filter(anim => anim.card !== card);
  }

  // Clear all animations
  clearAll() {
    this.animations = [];
  }

  update() {
    if (this.animations.length === 0) {
      this.isRunning = false;
      return;
    }

    const now = performance.now();
    this.animations = this.animations.filter(anim => {
      if (anim.cancelled) return false;

      const elapsed = now - anim.startTime;
      const progress = Math.min(elapsed / anim.duration, 1);
      const easedProgress = anim.easing(progress);

      anim.onUpdate(easedProgress, progress);

      if (progress >= 1) {
        if (anim.onComplete) anim.onComplete();
        return false;
      }
      return true;
    });

    requestAnimationFrame(() => this.update());
  }

  // Animate a value from start to end
  animate(options) {
    const {
      from = 0,
      to = 1,
      duration = 500,
      easing = Easing.easeOutCubic,
      onUpdate,
      onComplete
    } = options;

    return new Promise(resolve => {
      this.add({
        startTime: performance.now(),
        duration,
        easing,
        onUpdate: (easedProgress) => {
          const value = from + (to - from) * easedProgress;
          onUpdate(value, easedProgress);
        },
        onComplete: () => {
          if (onComplete) onComplete();
          resolve();
        }
      });
    });
  }

  // Animate Three.js object position
  animatePosition(object, target, duration = 500, easing = Easing.easeOutCubic) {
    const start = object.position.clone();
    return this.animate({
      duration,
      easing,
      onUpdate: (progress) => {
        object.position.lerpVectors(start, target, progress);
      }
    });
  }

  // Animate Three.js object scale
  animateScale(object, targetScale, duration = 300, easing = Easing.easeOutBack) {
    const start = object.scale.clone();
    const target = new THREE.Vector3(targetScale, targetScale, targetScale);
    return this.animate({
      duration,
      easing,
      onUpdate: (progress) => {
        object.scale.lerpVectors(start, target, progress);
      }
    });
  }

  // Animate Three.js object rotation
  animateRotation(object, targetRotation, duration = 500, easing = Easing.easeOutCubic) {
    const start = object.rotation.clone();
    return this.animate({
      duration,
      easing,
      onUpdate: (progress) => {
        object.rotation.x = start.x + (targetRotation.x - start.x) * progress;
        object.rotation.y = start.y + (targetRotation.y - start.y) * progress;
        object.rotation.z = start.z + (targetRotation.z - start.z) * progress;
      }
    });
  }
}

export const animationManager = new AnimationManager();

// ============================================================================
// CARD ANIMATIONS
// ============================================================================

// Card draw animation - slide from deck with flip
export async function animateCardDraw(card, targetPosition, isPlayer = true) {
  const mesh = card.mesh;
  const deckPosition = new THREE.Vector3(0, 0, 0.5);

  // Start from deck position
  mesh.position.copy(deckPosition);
  mesh.rotation.y = isPlayer ? 0 : Math.PI; // Face down for opponent
  mesh.visible = true;

  // Arc path animation
  const duration = 600;
  const startPos = deckPosition.clone();
  const endPos = targetPosition.clone();
  const arcHeight = 2;

  await animationManager.animate({
    duration,
    easing: Easing.easeOutCubic,
    onUpdate: (progress) => {
      // Bezier curve for arc
      const t = progress;
      mesh.position.x = startPos.x + (endPos.x - startPos.x) * t;
      mesh.position.y = startPos.y + (endPos.y - startPos.y) * t + Math.sin(t * Math.PI) * arcHeight;
      mesh.position.z = startPos.z + (endPos.z - startPos.z) * t;

      // Flip animation for player cards
      if (isPlayer) {
        mesh.rotation.y = (1 - progress) * Math.PI * 0.5;
      }
    }
  });

  // Settle bounce
  await animationManager.animateScale(mesh, 1.1, 100, Easing.easeOutQuad);
  await animationManager.animateScale(mesh, 1.0, 100, Easing.easeOutQuad);
}

// Card play animation - zoom to center first, then move to board
export async function animateCardPlay(card, targetPosition) {
  const mesh = card.mesh;
  const startPos = mesh.position.clone();
  const startScale = mesh.scale.x;

  // Center of screen position (in 3D space)
  const centerPos = new THREE.Vector3(0, 0, 4);
  const zoomScale = 2.5;

  // Glow effect during play
  if (mesh.material.uniforms && mesh.material.uniforms.glowIntensity) {
    mesh.material.uniforms.glowIntensity.value = 1.0;
  }

  // Phase 1: Zoom to center of screen
  await animationManager.animate({
    duration: 250,
    easing: Easing.easeOutCubic,
    onUpdate: (progress) => {
      mesh.position.x = startPos.x + (centerPos.x - startPos.x) * progress;
      mesh.position.y = startPos.y + (centerPos.y - startPos.y) * progress;
      mesh.position.z = startPos.z + (centerPos.z - startPos.z) * progress;
      mesh.scale.setScalar(startScale + (zoomScale - startScale) * progress);
    }
  });

  // Brief pause at center
  await new Promise(resolve => setTimeout(resolve, 150));

  // Phase 2: Move from center to board position
  const fromCenter = mesh.position.clone();
  const targetScale = 0.25; // Final board scale

  await animationManager.animate({
    duration: 300,
    easing: Easing.easeOutBack,
    onUpdate: (progress) => {
      mesh.position.x = fromCenter.x + (targetPosition.x - fromCenter.x) * progress;
      mesh.position.y = fromCenter.y + (targetPosition.y - fromCenter.y) * progress;
      mesh.position.z = fromCenter.z + (targetPosition.z - fromCenter.z) * progress;
      mesh.scale.setScalar(zoomScale + (targetScale - zoomScale) * progress);

      // Slight rotation during flight
      mesh.rotation.z = Math.sin(progress * Math.PI) * 0.1;
    }
  });

  mesh.rotation.z = 0;

  // Fade glow
  if (mesh.material.uniforms && mesh.material.uniforms.glowIntensity) {
    animationManager.animate({
      duration: 300,
      onUpdate: (progress) => {
        mesh.material.uniforms.glowIntensity.value = 1.0 - progress;
      }
    });
  }
}

// Card hover - completely instant, no animation
export function animateCardHover(card, isHovering, isInHand = true) {
  const mesh = card.mesh;

  // Cancel any existing animations for this card
  animationManager.cancelForCard(card);

  // Scale values
  const targetScale = isHovering ? (isInHand ? 2.0 : 0.6) : (isInHand ? 1.0 : 0.25);
  const targetZ = isHovering ? 3.0 : 0.5;

  // Store original position when first hovering
  if (isInHand && isHovering && card._originalY === undefined) {
    card._originalY = mesh.position.y;
    card._originalX = mesh.position.x;
    card._originalZ = mesh.position.z;
  }

  // ALL changes are instant - no animation
  mesh.scale.setScalar(targetScale);
  mesh.position.z = targetZ;

  if (isInHand) {
    if (isHovering) {
      // Move up and towards center instantly
      mesh.position.y = (card._originalY || mesh.position.y) + 3.5;
      mesh.position.x = (card._originalX || mesh.position.x) * 0.5;
    } else if (card._originalY !== undefined) {
      // Return to original position instantly
      mesh.position.y = card._originalY;
      mesh.position.x = card._originalX;
    }
  }

  // Reset stored position when not hovering
  if (!isHovering && card._originalY !== undefined) {
    delete card._originalY;
    delete card._originalX;
    delete card._originalZ;
  }
}

// Card flip animation (for revealing opponent cards)
export async function animateCardFlip(card) {
  const mesh = card.mesh;

  // Flip to 90 degrees
  await animationManager.animateRotation(
    mesh,
    { x: 0, y: Math.PI / 2, z: 0 },
    200,
    Easing.easeInQuad
  );

  // Change texture at midpoint
  card.reveal();

  // Flip to 0 degrees
  await animationManager.animateRotation(
    mesh,
    { x: 0, y: 0, z: 0 },
    200,
    Easing.easeOutQuad
  );

  // Pop effect
  await animationManager.animateScale(mesh, 1.2, 100, Easing.easeOutQuad);
  await animationManager.animateScale(mesh, 1.0, 150, Easing.easeOutBounce);
}

// Card queue animation
export async function animateCardQueue(card, queuePosition) {
  const mesh = card.mesh;

  await animationManager.animate({
    duration: 300,
    easing: Easing.easeOutCubic,
    onUpdate: (progress) => {
      mesh.position.lerp(queuePosition, progress * 0.3);
      mesh.scale.setScalar(1.0 - progress * 0.3); // Shrink slightly
    }
  });
}

// ============================================================================
// DAMAGE & HEAL EFFECTS
// ============================================================================

// Screen shake effect
export function screenShake(camera, intensity = 0.3, duration = 300) {
  const originalPosition = camera.position.clone();

  animationManager.animate({
    duration,
    easing: Easing.easeOutQuad,
    onUpdate: (progress) => {
      const remaining = 1 - progress;
      const shakeX = (Math.random() - 0.5) * intensity * remaining;
      const shakeY = (Math.random() - 0.5) * intensity * remaining;
      camera.position.x = originalPosition.x + shakeX;
      camera.position.y = originalPosition.y + shakeY;
    },
    onComplete: () => {
      camera.position.copy(originalPosition);
    }
  });
}

// Damage number pool for reuse
const damageNumberPool = [];
const MAX_DAMAGE_NUMBERS = 10;

// Texture cache for damage numbers (reuse textures for same values)
const damageTextureCache = new Map();
const MAX_CACHED_TEXTURES = 20;

// Clear all damage numbers (call on game end)
export function clearDamageNumbers(scene) {
  damageNumberPool.forEach(sprite => {
    if (sprite && sprite.parent) {
      scene.remove(sprite);
      sprite.material.dispose();
    }
  });
  damageNumberPool.length = 0;
}

// Clear texture cache (call on game end for memory cleanup)
export function clearDamageTextureCache() {
  damageTextureCache.forEach(({ texture }) => texture.dispose());
  damageTextureCache.clear();
}

// Get or create cached texture for damage number
function getDamageTexture(amount, isHeal) {
  const key = `${isHeal ? '+' : '-'}${amount}`;

  if (damageTextureCache.has(key)) {
    return damageTextureCache.get(key).texture;
  }

  // Limit cache size
  if (damageTextureCache.size >= MAX_CACHED_TEXTURES) {
    const firstKey = damageTextureCache.keys().next().value;
    const { texture } = damageTextureCache.get(firstKey);
    texture.dispose();
    damageTextureCache.delete(firstKey);
  }

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  ctx.font = 'bold 48px Orbitron';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Outline
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  ctx.strokeText(key, 64, 32);

  // Fill
  ctx.fillStyle = isHeal ? '#2ecc71' : '#e74c3c';
  ctx.fillText(key, 64, 32);

  const texture = new THREE.CanvasTexture(canvas);
  damageTextureCache.set(key, { texture, canvas });

  return texture;
}

// Create round summary showing total damage and heal with clear spacing
export function createRoundSummary(scene, playerDamage, playerHeal, opponentDamage, opponentHeal) {
  // Show opponent's damage dealt to player (top left)
  if (opponentDamage > 0) {
    setTimeout(() => {
      createDamageNumber(scene, new THREE.Vector3(-3, -2, 2), opponentDamage, false);
    }, 0);
  }

  // Show player's heal (top right, with gap)
  if (playerHeal > 0) {
    setTimeout(() => {
      createDamageNumber(scene, new THREE.Vector3(3, -2, 2), playerHeal, true);
    }, 300);
  }

  // Show player's damage dealt to opponent (bottom left)
  if (playerDamage > 0) {
    setTimeout(() => {
      createDamageNumber(scene, new THREE.Vector3(-3, 2, 2), playerDamage, false);
    }, 600);
  }

  // Show opponent's heal (bottom right, with gap)
  if (opponentHeal > 0) {
    setTimeout(() => {
      createDamageNumber(scene, new THREE.Vector3(3, 2, 2), opponentHeal, true);
    }, 900);
  }
}

// Floating damage number
export function createDamageNumber(scene, position, amount, isHeal = false) {
  // Limit active damage numbers for performance
  if (damageNumberPool.length >= MAX_DAMAGE_NUMBERS) {
    const oldSprite = damageNumberPool.shift();
    if (oldSprite && oldSprite.parent) {
      scene.remove(oldSprite);
      oldSprite.material.dispose();
      // Don't dispose cached textures
    }
  }

  // Use cached texture for better performance
  const texture = getDamageTexture(amount, isHeal);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });
  const sprite = new THREE.Sprite(material);

  sprite.position.copy(position);
  sprite.position.z = 3;
  sprite.scale.set(1.5, 0.75, 1);
  scene.add(sprite);
  damageNumberPool.push(sprite);

  // Animate floating up and fading - longer duration for visibility
  const startY = position.y;
  animationManager.animate({
    duration: 2500,
    easing: Easing.easeOutCubic,
    onUpdate: (progress) => {
      sprite.position.y = startY + progress * 3;
      // Fade out only in last 40% of animation
      sprite.material.opacity = progress < 0.6 ? 1 : 1 - ((progress - 0.6) / 0.4);
      sprite.scale.set(1.8 + progress * 0.5, 0.9 + progress * 0.25, 1);
    },
    onComplete: () => {
      scene.remove(sprite);
      const idx = damageNumberPool.indexOf(sprite);
      if (idx > -1) damageNumberPool.splice(idx, 1);
      material.dispose();
      texture.dispose();
    }
  });
}

// ============================================================================
// PARTICLE SYSTEM (with object pooling for performance)
// ============================================================================

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    // Object pool for reusing particle geometries
    this.geometryPool = [];
    this.maxPoolSize = 20;
  }

  // Get geometry from pool or create new
  getGeometry(size) {
    if (this.geometryPool.length > 0) {
      return this.geometryPool.pop();
    }
    return new THREE.BufferGeometry();
  }

  // Return geometry to pool for reuse
  returnGeometry(geometry) {
    if (this.geometryPool.length < this.maxPoolSize) {
      this.geometryPool.push(geometry);
    } else {
      geometry.dispose();
    }
  }

  // Limit active particles for performance
  cleanupOldParticles() {
    if (this.particles.length > 10) {
      const oldParticle = this.particles.shift();
      if (oldParticle && oldParticle.parent) {
        this.scene.remove(oldParticle);
      }
    }
  }

  // Create damage particles (red sparks)
  createDamageParticles(position, amount = 10) {
    this.cleanupOldParticles();
    const geometry = this.getGeometry(amount);
    const positions = new Float32Array(amount * 3);
    const velocities = [];

    for (let i = 0; i < amount; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;

      velocities.push({
        x: (Math.random() - 0.5) * 0.1,
        y: Math.random() * 0.1 + 0.05,
        z: (Math.random() - 0.5) * 0.1
      });
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xff3333,
      size: 0.15,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const points = new THREE.Points(geometry, material);
    this.scene.add(points);

    const startTime = performance.now();
    const duration = 800;

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = elapsed / duration;

      if (progress >= 1) {
        this.scene.remove(points);
        this.returnGeometry(geometry);
        material.dispose();
        const idx = this.particles.indexOf(points);
        if (idx > -1) this.particles.splice(idx, 1);
        return;
      }

      const posArray = geometry.attributes.position.array;
      for (let i = 0; i < amount; i++) {
        posArray[i * 3] += velocities[i].x;
        posArray[i * 3 + 1] += velocities[i].y - progress * 0.01; // Gravity
        posArray[i * 3 + 2] += velocities[i].z;
      }
      geometry.attributes.position.needsUpdate = true;
      material.opacity = 1 - progress;

      requestAnimationFrame(animate);
    };

    this.particles.push(points);
    animate();
  }

  // Create heal particles (green sparkles)
  createHealParticles(position, amount = 15) {
    this.cleanupOldParticles();
    const geometry = this.getGeometry(amount);
    const positions = new Float32Array(amount * 3);
    const velocities = [];

    for (let i = 0; i < amount; i++) {
      const angle = (i / amount) * Math.PI * 2;
      const radius = 0.5;
      positions[i * 3] = position.x + Math.cos(angle) * radius;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z + Math.sin(angle) * radius;

      velocities.push({
        x: Math.cos(angle) * 0.02,
        y: Math.random() * 0.08 + 0.04,
        z: Math.sin(angle) * 0.02
      });
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0x33ff66,
      size: 0.12,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const points = new THREE.Points(geometry, material);
    this.scene.add(points);

    const startTime = performance.now();
    const duration = 1000;

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = elapsed / duration;

      if (progress >= 1) {
        this.scene.remove(points);
        this.returnGeometry(geometry);
        material.dispose();
        const idx = this.particles.indexOf(points);
        if (idx > -1) this.particles.splice(idx, 1);
        return;
      }

      const posArray = geometry.attributes.position.array;
      for (let i = 0; i < amount; i++) {
        posArray[i * 3] += velocities[i].x * (1 - progress);
        posArray[i * 3 + 1] += velocities[i].y;
        posArray[i * 3 + 2] += velocities[i].z * (1 - progress);
      }
      geometry.attributes.position.needsUpdate = true;
      material.opacity = 1 - progress * progress;
      material.size = 0.12 + progress * 0.08;

      requestAnimationFrame(animate);
    };

    this.particles.push(points);
    animate();
  }

  // Create mana particles (blue swirl)
  createManaParticles(position, amount = 12) {
    this.cleanupOldParticles();
    const geometry = this.getGeometry(amount);
    const positions = new Float32Array(amount * 3);

    for (let i = 0; i < amount; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0x3399ff,
      size: 0.1,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const points = new THREE.Points(geometry, material);
    this.scene.add(points);

    const startTime = performance.now();
    const duration = 600;

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = elapsed / duration;

      if (progress >= 1) {
        this.scene.remove(points);
        this.returnGeometry(geometry);
        material.dispose();
        const idx = this.particles.indexOf(points);
        if (idx > -1) this.particles.splice(idx, 1);
        return;
      }

      const posArray = geometry.attributes.position.array;
      for (let i = 0; i < amount; i++) {
        const angle = (i / amount) * Math.PI * 2 + progress * Math.PI * 4;
        const radius = progress * 0.8;
        posArray[i * 3] = position.x + Math.cos(angle) * radius;
        posArray[i * 3 + 1] = position.y + progress * 1.5;
        posArray[i * 3 + 2] = position.z + Math.sin(angle) * radius;
      }
      geometry.attributes.position.needsUpdate = true;
      material.opacity = 1 - progress;

      requestAnimationFrame(animate);
    };

    this.particles.push(points);
    animate();
  }

  // Cleanup all particles (call when game ends)
  dispose() {
    this.particles.forEach(p => {
      if (p.parent) this.scene.remove(p);
      if (p.geometry) p.geometry.dispose();
      if (p.material) p.material.dispose();
    });
    this.particles = [];
    this.geometryPool.forEach(g => g.dispose());
    this.geometryPool = [];
  }
}

// ============================================================================
// WIN/LOSS EFFECTS
// ============================================================================

// Detect mobile for performance adjustments
const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export function createVictoryEffect(scene) {
  // Reduce particles on mobile for performance
  const particleCount = isMobile ? 40 : 100;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const velocities = [];

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = 0;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 2;

    // Gold/yellow colors
    colors[i * 3] = 1;
    colors[i * 3 + 1] = 0.8 + Math.random() * 0.2;
    colors[i * 3 + 2] = Math.random() * 0.3;

    velocities.push({
      x: (Math.random() - 0.5) * 0.3,
      y: Math.random() * 0.2 + 0.1,
      z: (Math.random() - 0.5) * 0.3,
      rotSpeed: Math.random() * 0.2
    });
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.2,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const confetti = new THREE.Points(geometry, material);
  scene.add(confetti);

  const startTime = performance.now();
  const duration = 3000;

  const animate = () => {
    const elapsed = performance.now() - startTime;
    const progress = elapsed / duration;

    if (progress >= 1) {
      scene.remove(confetti);
      geometry.dispose();
      material.dispose();
      return;
    }

    const posArray = geometry.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
      posArray[i * 3] += velocities[i].x;
      posArray[i * 3 + 1] += velocities[i].y - progress * 0.015;
      posArray[i * 3 + 2] += velocities[i].z;
    }
    geometry.attributes.position.needsUpdate = true;
    material.opacity = 1 - progress * progress;

    requestAnimationFrame(animate);
  };

  animate();

  // Show victory banner
  showGameBanner('VICTORY!', '#ffd700', '#2ecc71');
}

export function createDefeatEffect(scene) {
  // Reduce particles on mobile for performance
  const particleCount = isMobile ? 25 : 50;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 10;
    positions[i * 3 + 1] = 5 + Math.random() * 3;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 5;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0x660000,
    size: 0.15,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  const startTime = performance.now();
  const duration = 2000;

  const animate = () => {
    const elapsed = performance.now() - startTime;
    const progress = elapsed / duration;

    if (progress >= 1) {
      scene.remove(particles);
      geometry.dispose();
      material.dispose();
      return;
    }

    const posArray = geometry.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
      posArray[i * 3 + 1] -= 0.05;
    }
    geometry.attributes.position.needsUpdate = true;
    material.opacity = 0.8 - progress * 0.6;

    requestAnimationFrame(animate);
  };

  animate();

  // Show defeat banner
  showGameBanner('DEFEAT', '#e74c3c', '#8b0000');
}

// Animated game banner
function showGameBanner(text, color1, color2) {
  // Remove existing banner
  const existing = document.getElementById('game-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'game-banner';
  banner.innerHTML = text;
  banner.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0);
    font-family: 'Orbitron', sans-serif;
    font-size: 72px;
    font-weight: bold;
    color: ${color1};
    text-shadow: 0 0 20px ${color2}, 0 0 40px ${color2}, 0 0 60px ${color2};
    z-index: 1000;
    pointer-events: none;
    animation: bannerPop 0.5s ease-out forwards, bannerGlow 1s ease-in-out infinite alternate;
  `;

  // Add keyframes if not exists
  if (!document.getElementById('banner-styles')) {
    const style = document.createElement('style');
    style.id = 'banner-styles';
    style.textContent = `
      @keyframes bannerPop {
        0% { transform: translate(-50%, -50%) scale(0) rotate(-10deg); opacity: 0; }
        50% { transform: translate(-50%, -50%) scale(1.2) rotate(5deg); }
        100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); opacity: 1; }
      }
      @keyframes bannerGlow {
        from { filter: brightness(1); }
        to { filter: brightness(1.3); }
      }
      @keyframes bannerFade {
        from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        to { opacity: 0; transform: translate(-50%, -50%) scale(1.5); }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(banner);

  // Fade out after 2 seconds
  setTimeout(() => {
    banner.style.animation = 'bannerFade 1s ease-out forwards';
    setTimeout(() => banner.remove(), 1000);
  }, 2000);
}

// ============================================================================
// UI ANIMATIONS
// ============================================================================

// Animate health bar change
export function animateHealthBar(element, fromValue, toValue, maxValue, duration = 500) {
  const startWidth = (fromValue / maxValue) * 100;
  const endWidth = (toValue / maxValue) * 100;

  animationManager.animate({
    from: startWidth,
    to: endWidth,
    duration,
    easing: Easing.easeOutCubic,
    onUpdate: (value) => {
      element.style.width = `${Math.max(0, value)}%`;

      // Color based on health
      const healthPercent = value;
      if (healthPercent > 60) {
        element.style.background = 'linear-gradient(90deg, #2ecc71, #27ae60)';
      } else if (healthPercent > 30) {
        element.style.background = 'linear-gradient(90deg, #f1c40f, #f39c12)';
      } else {
        element.style.background = 'linear-gradient(90deg, #e74c3c, #c0392b)';
      }
    }
  });

  // Pulse effect on damage
  if (toValue < fromValue) {
    element.style.animation = 'healthPulse 0.3s ease-out';
    setTimeout(() => element.style.animation = '', 300);
  }
}

// Animate mana change
export function animateManaChange(element, fromValue, toValue, duration = 300) {
  animationManager.animate({
    from: fromValue,
    to: toValue,
    duration,
    easing: Easing.easeOutCubic,
    onUpdate: (value) => {
      element.textContent = Math.round(value);
    }
  });
}

// Turn timer animation
export function animateTurnTimer(element, duration, onComplete) {
  const startTime = performance.now();

  const update = () => {
    const elapsed = performance.now() - startTime;
    const remaining = Math.max(0, duration - elapsed);
    const progress = elapsed / duration;

    const seconds = Math.ceil(remaining / 1000);
    element.textContent = `${seconds}s`;

    // Color warning
    if (seconds <= 5) {
      element.style.color = '#e74c3c';
      element.style.animation = 'timerPulse 0.5s ease-in-out infinite';
    } else if (seconds <= 10) {
      element.style.color = '#f39c12';
    } else {
      element.style.color = '#fff';
    }

    if (remaining <= 0) {
      if (onComplete) onComplete();
      return;
    }

    requestAnimationFrame(update);
  };

  update();
}

// Add CSS for UI animations
export function initAnimationStyles() {
  if (document.getElementById('animation-styles')) return;

  const style = document.createElement('style');
  style.id = 'animation-styles';
  style.textContent = `
    @keyframes healthPulse {
      0%, 100% { transform: scaleX(1); }
      50% { transform: scaleX(1.02); filter: brightness(1.5); }
    }

    @keyframes timerPulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }

    @keyframes cardGlow {
      0%, 100% { box-shadow: 0 0 10px rgba(255, 215, 0, 0.5); }
      50% { box-shadow: 0 0 20px rgba(255, 215, 0, 0.8); }
    }

    @keyframes manaSpend {
      0% { transform: scale(1); }
      50% { transform: scale(0.8); opacity: 0.5; }
      100% { transform: scale(1); opacity: 1; }
    }

    .mana-spending {
      animation: manaSpend 0.3s ease-out;
    }

    .damage-flash {
      animation: damageFlash 0.2s ease-out;
    }

    @keyframes damageFlash {
      0%, 100% { filter: none; }
      50% { filter: brightness(2) saturate(0) contrast(2); }
    }

    /* Reduced motion support for accessibility */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }

    /* GPU acceleration hints for smooth animations */
    .health-fill, .mana-fill {
      will-change: width;
    }

    .timer {
      will-change: transform, opacity;
    }
  `;
  document.head.appendChild(style);
}

// Initialize styles on load
initAnimationStyles();
