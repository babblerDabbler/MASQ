// animations.js - Comprehensive animation system for MASQ
// THREE is loaded globally via CDN

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
  }

  add(animation) {
    this.animations.push(animation);
    if (!this.isRunning) {
      this.isRunning = true;
      this.update();
    }
    return animation;
  }

  update() {
    if (this.animations.length === 0) {
      this.isRunning = false;
      return;
    }

    const now = performance.now();
    this.animations = this.animations.filter(anim => {
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

// Card play animation - arc to center with spin
export async function animateCardPlay(card, targetPosition) {
  const mesh = card.mesh;
  const startPos = mesh.position.clone();
  const duration = 400;

  // Glow effect during play
  if (mesh.material.uniforms && mesh.material.uniforms.glowIntensity) {
    mesh.material.uniforms.glowIntensity.value = 1.0;
  }

  await animationManager.animate({
    duration,
    easing: Easing.easeOutBack,
    onUpdate: (progress) => {
      const t = progress;
      mesh.position.x = startPos.x + (targetPosition.x - startPos.x) * t;
      mesh.position.y = startPos.y + (targetPosition.y - startPos.y) * t + Math.sin(t * Math.PI) * 1.5;
      mesh.position.z = startPos.z + (targetPosition.z - startPos.z) * t + Math.sin(t * Math.PI) * 0.5;

      // Slight rotation during flight
      mesh.rotation.z = Math.sin(t * Math.PI * 2) * 0.1;
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

// Card hover animation
export function animateCardHover(card, isHovering, isInHand = true) {
  const mesh = card.mesh;
  // Larger zoom for cards in hand, bigger for played cards too
  const targetScale = isHovering ? (isInHand ? 2.0 : 0.6) : (isInHand ? 1.0 : 0.25);
  const targetZ = isHovering ? 3.0 : 0.5;

  // Store original Y position if not stored
  if (isInHand && isHovering && card._originalY === undefined) {
    card._originalY = mesh.position.y;
  }

  animationManager.animateScale(mesh, targetScale, 200, Easing.easeOutBack);

  // Raise card higher when hovering in hand to prevent bottom cutoff
  const targetY = isInHand && isHovering ? (card._originalY || mesh.position.y) + 1.5 : (card._originalY || mesh.position.y);

  animationManager.animate({
    duration: 200,
    easing: Easing.easeOutCubic,
    onUpdate: (progress) => {
      mesh.position.z = mesh.position.z + (targetZ - mesh.position.z) * progress * 0.3;
      if (isInHand) {
        mesh.position.y = mesh.position.y + (targetY - mesh.position.y) * progress * 0.3;
      }
    }
  });

  // Reset original Y when not hovering
  if (!isHovering && card._originalY !== undefined) {
    delete card._originalY;
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

// Floating damage number
export function createDamageNumber(scene, position, amount, isHeal = false) {
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
  ctx.strokeText((isHeal ? '+' : '-') + amount, 64, 32);

  // Fill
  ctx.fillStyle = isHeal ? '#2ecc71' : '#e74c3c';
  ctx.fillText((isHeal ? '+' : '-') + amount, 64, 32);

  const texture = new THREE.CanvasTexture(canvas);
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
      material.dispose();
      texture.dispose();
    }
  });
}

// ============================================================================
// PARTICLE SYSTEM
// ============================================================================

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
  }

  // Create damage particles (red sparks)
  createDamageParticles(position, amount = 10) {
    const geometry = new THREE.BufferGeometry();
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
        geometry.dispose();
        material.dispose();
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

    animate();
  }

  // Create heal particles (green sparkles)
  createHealParticles(position, amount = 15) {
    const geometry = new THREE.BufferGeometry();
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
        geometry.dispose();
        material.dispose();
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

    animate();
  }

  // Create mana particles (blue swirl)
  createManaParticles(position, amount = 12) {
    const geometry = new THREE.BufferGeometry();
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
        geometry.dispose();
        material.dispose();
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

    animate();
  }
}

// ============================================================================
// WIN/LOSS EFFECTS
// ============================================================================

export function createVictoryEffect(scene) {
  // Gold confetti burst
  const particleCount = 100;
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
  // Dark particles falling
  const particleCount = 50;
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
  `;
  document.head.appendChild(style);
}

// Initialize styles on load
initAnimationStyles();
