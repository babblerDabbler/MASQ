// threeSetup.js
const textureLoader = new THREE.TextureLoader();

export const cardBackMaterial = new THREE.MeshStandardMaterial({
  map: textureLoader.load('/assets/back1.png'),
  side: THREE.DoubleSide
});

export const scene = new THREE.Scene();

const aspect = window.innerWidth / window.innerHeight;
const frustumSize = 15;
export const camera = new THREE.OrthographicCamera(
  frustumSize * aspect / -2,
  frustumSize * aspect / 2,
  frustumSize / 2,
  frustumSize / -2,
  0.1,
  1000
);
camera.position.set(0, 0, 5);
camera.lookAt(0, 0, 0);

export const renderer = new THREE.WebGLRenderer({ 
  canvas: document.getElementById('gameCanvas'), 
  antialias: true 
});
renderer.setSize(window.innerWidth, window.innerHeight);

scene.background = textureLoader.load('/assets//bgbg2.png');


const ambientLight = new THREE.AmbientLight(0xFFFFFF, 1);
scene.add(ambientLight);
