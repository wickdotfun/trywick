// La scène 3D (Three.js) : une bougie géante, sa flamme, et les allumettes qui tournent
// autour. Tout est généré en code, rien à charger.
//
// createScene(conteneur, options) renvoie de quoi la piloter depuis app.js :
//   setCandle({ melted, heat })  la bougie fond (0 → 1) et la flamme chauffe (0 → 1)
//   setMatches(liste)            les allumettes déjà là (sans animation)
//   addMatch(m)                  une nouvelle allumette arrive, lancée depuis l'écran
//   updateMarkets(list)          le market cap des coins : les allumettes vivantes grossissent,
//                                se rapprochent de la flamme, ou pâlissent ; les holders brûlent en or
//   flare()                      un buyback part : la flamme s'emballe
//   burnout()                    la bougie a fondu : les allumettes plongent dans la flamme,
//                                elle s'éteint, une nouvelle bougie sort de la flaque
//   screenOf(mint)               où est une allumette à l'écran (pour les étiquettes)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BG = 0x080504;
const R = 1.15;          // rayon de la bougie
const H = 4.8;           // hauteur d'une bougie neuve
const MS = 0.5;          // taille des allumettes
const CAP = 2048;        // allumettes affichables d'un coup
const INTRO = 2.4;       // durée de l'arrivée d'une allumette (s)

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (t) => 1 - Math.pow(1 - clamp(t), 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function hash(s, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967295;
}

// La couleur de la tête d'une allumette vient de son mint : toujours la même.
const HEADS = ['#e8402a', '#ff6b2b', '#d92b4b', '#ffb02e', '#3fb5ff', '#7a5cff', '#2fd38a', '#ff4fa3', '#f2f2f2'];
export const GOLD = '#ffc94a';
export function headColor(mint, holder = false) {
  return holder ? GOLD : HEADS[Math.floor(hash(mint, 7) * HEADS.length)];
}

// La force d'un coin selon son market cap : 0 à 5 k$, 1 à 1 M$ (échelle logarithmique).
export function marketPower(mcap) {
  if (!(mcap > 0)) return 0;
  return clamp(Math.log10(mcap / 5000) / Math.log10(200));
}

const FLAME = { normal: [1, 0.5, 0.15], hot: [1, 0.36, 0.08], gold: [1, 0.8, 0.22], dead: [0.5, 0.33, 0.25] };

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// La cire : un matériau standard, qui rougeoie près de la flamme (comme de la vraie cire
// éclairée de l'intérieur).
function waxMaterial(uniforms, color = 0xf1e3cf) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTop = uniforms.uTop;
    shader.uniforms.uGlow = uniforms.uGlow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;\nuniform float uTop;\nuniform float uGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float warm = pow(smoothstep(uTop - 2.4, uTop + 0.05, vWorldY), 2.2) * smoothstep(0.05, 0.9, vWorldY);
        totalEmissiveRadiance += vec3(1.0, 0.42, 0.1) * uGlow * warm;
        // La cire est un peu translucide : la lumière de la flamme la traverse, partout pareil.
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.72, 0.48) * 0.07;`);
  };
  return mat;
}

function flameMaterial(core, edge, alpha) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uCore: { value: new THREE.Color(core) }, uEdge: { value: new THREE.Color(edge) },
      uAlpha: { value: alpha },
    },
    vertexShader: `
      uniform float uTime;
      varying float vY; varying vec3 vN; varying vec3 vView;
      void main() {
        vec3 p = position;
        float y = p.y;
        p.x += (sin(uTime * 7.0 + y * 4.0) * 0.035 + sin(uTime * 13.0 + y * 9.0) * 0.014) * y * y * 1.7;
        p.z += cos(uTime * 6.0 + y * 5.0) * 0.025 * y * y;
        p.y *= 1.0 + 0.06 * sin(uTime * 17.0) + 0.04 * sin(uTime * 29.0 + 1.3);
        vY = y;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uCore; uniform vec3 uEdge; uniform float uAlpha;
      varying float vY; varying vec3 vN; varying vec3 vView;
      void main() {
        float facing = abs(dot(normalize(vN), normalize(vView)));
        float core = pow(facing, 2.4);
        vec3 col = mix(uEdge, uCore, core);
        col = mix(vec3(0.3, 0.45, 1.0), col, smoothstep(0.0, 0.2, vY));
        float a = uAlpha * (0.3 + 0.7 * facing) * smoothstep(1.0, 0.5, vY) * smoothstep(0.0, 0.05, vY);
        gl_FragColor = vec4(col * (1.0 + core * 1.6), a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function flameGeometry() {
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push(new THREE.Vector2(0.22 * Math.sin(Math.PI * Math.pow(t, 0.62)) * (1 - 0.15 * t), t));
  }
  return new THREE.LatheGeometry(pts, 32);
}

// Des petits points lumineux (flammes des allumettes, braises, étincelles), en un seul dessin.
function glowPoints(count, { size = 1, color = [1, 0.5, 0.15], core = [1, 0.95, 0.75] } = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  // La couleur de chaque point (par défaut celle de tout le système).
  const tints = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) tints.set(color, i * 3);
  geo.setAttribute('aTint', new THREE.BufferAttribute(tints, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uPixel: { value: 1 }, uSize: { value: size },
      uColor: { value: new THREE.Vector3(...color) }, uCore: { value: new THREE.Vector3(...core) },
    },
    vertexShader: `
      attribute float aSeed; attribute float aSize; attribute vec3 aTint;
      uniform float uTime; uniform float uPixel; uniform float uSize;
      varying vec3 vTint;
      void main() {
        vTint = aTint;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float f = 0.85 + 0.15 * sin(uTime * 19.0 + aSeed * 40.0) + 0.1 * sin(uTime * 31.0 + aSeed * 13.0);
        gl_PointSize = aSize * uSize * f * uPixel * (70.0 / max(0.1, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform vec3 uCore;
      varying vec3 vTint;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d);
        vec3 col = mix(vTint, uCore, pow(1.0 - d, 3.0));
        gl_FragColor = vec4(col * a * 1.7, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

export function createScene(container, { onFrame } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.FogExp2(BG, 0.032);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camera.position.set(0, 4.6, 16.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 3.0, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 6;
  controls.maxDistance = 26;
  controls.minPolarAngle = 0.75;
  controls.maxPolarAngle = 1.62;
  controls.autoRotate = !reduced;
  controls.autoRotateSpeed = 0.4;

  // ------------------------------------------------------------ lumières, sol
  scene.add(new THREE.HemisphereLight(0xffd9b0, 0x0b0705, 0.22));
  // Une lumière douce tout autour (et non d'un seul côté) : la cire garde la même couleur sous
  // tous les angles quand la bougie tourne.
  scene.add(new THREE.AmbientLight(0xffe2c4, 0.12));
  const flameLight = new THREE.PointLight(0xffa050, 30, 30, 1.5);
  scene.add(flameLight);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(60, 64),
    new THREE.MeshStandardMaterial({ color: 0x140d09, roughness: 0.92 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // ------------------------------------------------------------ la bougie
  const uniforms = { uTop: { value: H }, uGlow: { value: 0.6 } };
  const wax = waxMaterial(uniforms);
  const candle = new THREE.Group();
  scene.add(candle);

  const bodyGeo = new THREE.CylinderGeometry(R, R * 1.015, 1, 72, 30, true).translate(0, 0.5, 0);
  {
    const p = bodyGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
      const a = Math.atan2(z, x);
      const k = 1 + 0.012 * Math.sin(5 * a + 1.3) + 0.008 * Math.sin(11 * a + 0.7) + 0.004 * Math.sin(23 * a);
      p.setXYZ(i, x * k, y, z * k);
    }
    bodyGeo.computeVertexNormals();
  }
  const body = new THREE.Mesh(bodyGeo, wax);
  candle.add(body);

  // Le haut : un cratère au bord irrégulier, un bain de cire fondue, la mèche, la flamme.
  const top = new THREE.Group();
  candle.add(top);
  const rimGeo = new THREE.LatheGeometry([
    new THREE.Vector2(0, -0.16), new THREE.Vector2(R * 0.5, -0.14), new THREE.Vector2(R * 0.82, -0.08),
    new THREE.Vector2(R * 0.94, 0.02), new THREE.Vector2(R * 0.99, 0.03), new THREE.Vector2(R * 1.012, -0.04),
    new THREE.Vector2(R * 1.012, -0.12),
  ], 72);
  {
    const p = rimGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      if (Math.hypot(x, z) > R * 0.8) {
        const a = Math.atan2(z, x);
        p.setY(i, p.getY(i) + 0.05 * Math.sin(3 * a + 0.4) + 0.035 * Math.sin(7 * a + 2) + 0.02 * Math.sin(13 * a));
      }
    }
    rimGeo.computeVertexNormals();
  }
  top.add(new THREE.Mesh(rimGeo, wax));
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(R * 0.86, 48),
    new THREE.MeshStandardMaterial({ color: 0xffd7a0, emissive: 0xff7a22, emissiveIntensity: 0.55, roughness: 0.12 }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = -0.11;
  top.add(pool);

  const wick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.034, 0.42, 8).translate(0, 0.21, 0),
    new THREE.MeshStandardMaterial({ color: 0x1b1310, roughness: 0.9 }),
  );
  wick.position.y = -0.12;
  wick.rotation.z = 0.07;
  top.add(wick);
  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff5a1a }),
  );
  ember.position.set(-0.02, 0.29, 0);
  top.add(ember);

  const flame = new THREE.Group();
  flame.position.y = 0.2;
  top.add(flame);
  const fGeo = flameGeometry();
  const outerMat = flameMaterial(0xffcf70, 0xff6a14, 0.95);
  const innerMat = flameMaterial(0xffffff, 0xffd36a, 1.0);
  const outer = new THREE.Mesh(fGeo, outerMat);
  outer.scale.set(1.15, 1.25, 1.15);
  const inner = new THREE.Mesh(fGeo, innerMat);
  inner.scale.set(0.55, 0.7, 0.55);
  inner.position.y = 0.02;
  flame.add(outer, inner);
  const dot = softDot();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: dot, color: 0xff8a30, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  halo.position.y = 0.6;
  flame.add(halo);

  // Les coulures : elles apparaissent et s'allongent à mesure que la bougie fond.
  const dripGeo = new THREE.CapsuleGeometry(1, 2, 6, 12).translate(0, -2, 0);
  const drips = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const mesh = new THREE.Mesh(dripGeo, wax);
    mesh.rotation.y = -a;
    const d = {
      mesh, a,
      r: 0.06 + Math.random() * 0.06,
      len: 0.3 + Math.random() * 1.5,
      from: i < 5 ? 0 : Math.random() * 0.85,
    };
    drips.push(d);
    candle.add(mesh);
  }

  // La flaque au pied, qui s'étale.
  const puddleGeo = new THREE.CylinderGeometry(1, 1, 0.08, 96, 1);
  {
    const p = puddleGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + 0.08 * Math.sin(4 * a + 1) + 0.05 * Math.sin(9 * a + 2.2) + 0.03 * Math.sin(17 * a);
      p.setXYZ(i, x * k, p.getY(i), z * k);
    }
    puddleGeo.computeVertexNormals();
  }
  const puddle = new THREE.Mesh(puddleGeo, wax);
  puddle.position.y = 0.035;
  candle.add(puddle);

  // ------------------------------------------------------------ les allumettes
  const stickGeo = new THREE.BoxGeometry(0.05, 0.72, 0.05);
  const headGeo = new THREE.SphereGeometry(0.075, 12, 10).scale(1, 1.35, 1);
  const sticks = new THREE.InstancedMesh(stickGeo, new THREE.MeshStandardMaterial({ color: 0xd8ae78, roughness: 0.75 }), CAP);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ roughness: 0.4, emissive: 0x220800 }), CAP);
  for (const m of [sticks, heads]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    scene.add(m);
  }
  heads.setColorAt(0, new THREE.Color());
  const matchFlames = glowPoints(CAP, { size: 1.5 });
  scene.add(matchFlames);

  const sparks = glowPoints(400, { size: 0.5, color: [1, 0.55, 0.15] });
  scene.add(sparks);
  const sparkLife = new Float32Array(400);
  const sparkVel = new Float32Array(400 * 3);
  let sparkNext = 0;

  const embers = glowPoints(70, { size: 0.32, color: [1, 0.4, 0.1] });
  scene.add(embers);
  const emberState = Array.from({ length: 70 }, () => ({ t: Math.random() * 3, life: 2 + Math.random() * 2.5, x: 0, z: 0, vx: 0, vz: 0 }));

  const smoke = [];
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0x6a625c, transparent: true, opacity: 0, depthWrite: false }));
    s.visible = false;
    scene.add(s);
    smoke.push({ s, t: 0, on: false });
  }

  const list = [];             // allumettes affichées
  const byMint = new Map();

  function orbitOf(m) {
    const u = hash(m.mint, 1);
    const r = R + 0.9 + 3.0 * Math.sqrt(u);
    return {
      r,
      incl: (hash(m.mint, 2) - 0.5) * 0.55,
      node: hash(m.mint, 3) * Math.PI * 2,
      phase: hash(m.mint, 4) * Math.PI * 2,
      speed: 0.42 * Math.pow(2.4 / r, 1.5) * (hash(m.mint, 5) < 0.1 ? -1 : 1),
      yoff: (hash(m.mint, 6) - 0.5) * 1.6,
      lean: 0.15 + hash(m.mint, 8) * 0.3,
    };
  }

  function insert(m, fresh, now) {
    if (byMint.has(m.mint) || list.length >= CAP) return;
    const spawn = camera.position.clone()
      .add(new THREE.Vector3((Math.random() - 0.5) * 6, -1.5 - Math.random() * 2, 0).applyQuaternion(camera.quaternion));
    const e = {
      m, o: orbitOf(m), born: fresh ? now : -1e9, spawn, struck: !fresh, pos: new THREE.Vector3(), headPos: new THREE.Vector3(),
      power: marketPower(m.mcap), powerTarget: marketPower(m.mcap),
    };
    heads.setColorAt(list.length, new THREE.Color(headColor(m.mint, m.holder)));
    tintFor(e, list.length);
    heads.instanceColor.needsUpdate = true;
    list.push(e);
    byMint.set(m.mint, e);
  }

  // La couleur de la flamme d'une allumette : or pour un holder de $WICK, vive pour un coin qui
  // monte, éteinte pour un coin mort.
  function tintFor(e, i) {
    const m = e.m;
    const kind = m.holder ? 'gold'
      : m.mcap > 0 && m.mcap < 4500 && (m.change ?? 0) < -40 ? 'dead'
        : (m.change ?? 0) > 50 || e.powerTarget > 0.6 ? 'hot' : 'normal';
    e.dead = kind === 'dead';
    matchFlames.geometry.attributes.aTint.array.set(FLAME[kind], i * 3);
    matchFlames.geometry.attributes.aTint.needsUpdate = true;
  }

  // ------------------------------------------------------------ état animé
  const st = {
    melted: 0, meltedTarget: 0,
    heat: 0, heatTarget: 0,
    pulse: 0,
    burn: null,                // l'animation de fin de bougie en cours
    grow: 1,                   // 0 → 1 quand une nouvelle bougie sort de la flaque
    flameOn: 1,
    puddleBase: 0,
  };

  function burst(at, n = 40, power = 1) {
    const pos = sparks.geometry.attributes.position;
    const size = sparks.geometry.attributes.aSize;
    for (let k = 0; k < n; k++) {
      const i = sparkNext; sparkNext = (sparkNext + 1) % 400;
      pos.setXYZ(i, at.x, at.y, at.z);
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const v = (1.2 + Math.random() * 2.6) * power;
      sparkVel[i * 3] = Math.sin(ph) * Math.cos(th) * v;
      sparkVel[i * 3 + 1] = Math.abs(Math.cos(ph)) * v * 0.9 + 0.6;
      sparkVel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * v;
      sparkLife[i] = 0.6 + Math.random() * 0.7;
      size.setX(i, 1);
    }
  }

  // ------------------------------------------------------------ taille, rendu
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.78);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let width = 1, height = 1;
  function resize() {
    width = container.clientWidth || 1;
    height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / height;
    // En portrait, on recule pour que la bougie et ses allumettes tiennent dans l'écran.
    const dist = 16.5 * Math.max(1, Math.pow(1.05 / camera.aspect, 0.8));
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    camera.updateProjectionMatrix();
    const px = renderer.getPixelRatio();
    for (const p of [matchFlames, sparks, embers]) p.material.uniforms.uPixel.value = px * Math.min(1, height / 800 + 0.25);
  }
  new ResizeObserver(resize).observe(container);
  resize();

  // ------------------------------------------------------------ boucle
  // Le temps de la scène, en secondes.
  const clock = {
    start: performance.now(), prev: performance.now(), elapsedTime: 0,
    getDelta() {
      const n = performance.now();
      const d = (n - this.prev) / 1000;
      this.prev = n;
      this.elapsedTime = (n - this.start) / 1000;
      return d;
    },
  };
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const tan = new THREE.Vector3(), dir = new THREE.Vector3(), mat4 = new THREE.Matrix4();
  const flameWorld = new THREE.Vector3();
  let last = 0;

  function candleHeight() {
    return Math.max(0.16, H * (1 - st.melted * 0.97)) * st.grow;
  }

  function frame() {
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    st.melted += (st.meltedTarget - st.melted) * Math.min(1, dt * 1.2);
    st.heat += (st.heatTarget - st.heat) * Math.min(1, dt * 0.8);
    st.pulse = Math.max(0, st.pulse - dt * 0.9);

    // -- fin de bougie
    let suck = 0;
    if (st.burn) {
      const b = (t - st.burn.start);
      suck = clamp(b / 1.6);                                   // les allumettes plongent
      st.flameOn = b < 1.6 ? 1 + suck * 0.45 : clamp(1 - (b - 1.6) / 0.8);
      if (b > 1.6 && !st.burn.smoked) { st.burn.smoked = true; for (const s of smoke) { s.on = true; s.t = -Math.random() * 1.2; } }
      if (b > 1.6 && list.length) { list.length = 0; byMint.clear(); }
      if (b > 2.5) {
        if (!st.burn.reset) { st.burn.reset = true; st.melted = st.meltedTarget = 0; st.puddleBase = Math.min(1.6, st.puddleBase + 0.25); }
        st.grow = easeInOut(clamp((b - 2.5) / 2.2));
        st.flameOn = 0;
      }
      if (b > 4.7) {
        st.flameOn = 1;
        st.grow = 1;
        burst(flameWorld, 60, 1.2);
        st.pulse = 1;
        const done = st.burn.done;
        st.burn = null;
        done();
      }
    }

    const h = candleHeight();
    body.scale.y = h;
    top.position.y = h;
    uniforms.uTop.value = h;
    uniforms.uGlow.value = (0.42 + st.heat * 0.22 + st.pulse * 0.28) * (st.flameOn > 0 ? 1 : 0.2);
    const pr = R * 1.08 + st.melted * 2.0 + st.puddleBase;
    puddle.scale.set(pr, 1 + st.melted * 1.5, pr);
    for (const d of drips) {
      const k = st.grow < 1 ? 0 : clamp((st.melted - d.from) / 0.45);
      const visible = d.from === 0 || k > 0;
      d.mesh.visible = visible;
      if (!visible) continue;
      const L = Math.min(h - 0.05, d.len * (0.35 + 1.4 * k));
      d.mesh.scale.set(d.r * 0.55, Math.max(0.01, L) / 4, d.r * 0.95);
      d.mesh.position.set(Math.cos(d.a) * (R + d.r * 0.15), h + 0.01, Math.sin(d.a) * (R + d.r * 0.15));
    }

    const power = (1 + st.heat * 0.45 + st.pulse * 0.3) * st.flameOn;
    flame.visible = power > 0.01;
    flame.scale.setScalar(1.3 * power);
    outerMat.uniforms.uTime.value = innerMat.uniforms.uTime.value = t;
    halo.scale.setScalar(3.2 + st.heat * 0.9 + st.pulse * 0.8);
    halo.material.opacity = 0.36 * Math.min(1, power);
    flame.getWorldPosition(flameWorld);
    const flick = 1 + 0.08 * Math.sin(t * 23) + 0.06 * Math.sin(t * 37 + 1) + 0.05 * Math.sin(t * 11);
    flameLight.position.set(flameWorld.x, flameWorld.y + 0.6, flameWorld.z);
    flameLight.intensity = (24 + st.heat * 12 + st.pulse * 14) * flick * Math.min(1, power) + 1.5;

    // -- les allumettes
    const cy = h * 0.55 + 1.0;
    const fpos = matchFlames.geometry.attributes.position;
    const fsize = matchFlames.geometry.attributes.aSize;
    for (let i = 0; i < list.length; i++) {
      const e = list[i], o = e.o;
      const th = o.phase + o.speed * t;
      const ci = Math.cos(o.incl), si = Math.sin(o.incl), cn = Math.cos(o.node), sn = Math.sin(o.node);
      // Les coins forts se rapprochent de la flamme.
      e.power += (e.powerTarget - e.power) * Math.min(1, dt * 0.8);
      let r = o.r * (1 - 0.32 * e.power);
      if (suck) r = r * (1 - ease(suck)) + 0.05;
      // Un cercle, incliné autour de x puis tourné autour de y.
      const x0 = r * Math.cos(th), z0 = r * Math.sin(th);
      const y1 = -z0 * si, z1 = z0 * ci;
      tmpV.set(x0 * cn + z1 * sn, y1 + cy + o.yoff * (1 - suck), -x0 * sn + z1 * cn);
      if (suck) tmpV.y += (flameWorld.y + 0.4 - tmpV.y) * ease(suck);
      const tx0 = -Math.sin(th) * Math.sign(o.speed), tz0 = Math.cos(th) * Math.sign(o.speed);
      const ty1 = -tz0 * si, tz1 = tz0 * ci;
      tan.set(tx0 * cn + tz1 * sn, ty1, -tx0 * sn + tz1 * cn);
      // Debout, penchée vers l'avant et un peu vers la bougie.
      dir.set(-tmpV.x, 0, -tmpV.z).normalize().multiplyScalar(0.2).add(up).addScaledVector(tan, o.lean).normalize();

      let scale = MS * (0.85 + 0.8 * e.power) * (1 - ease(suck) * 0.9);
      const age = t - e.born;
      if (age < INTRO) {
        const k = ease(age / INTRO);
        tmpV.lerpVectors(e.spawn, tmpV, k);
        tmpV.y += Math.sin(k * Math.PI) * 1.2;
        scale *= 0.6 + 0.4 * k;
      } else if (!e.struck) {
        e.struck = true;
        burst(e.headPos, 36);
        st.pulse = Math.min(1.4, st.pulse + 0.7);
      }
      e.pos.copy(tmpV);
      tmpQ.setFromUnitVectors(up, dir);
      tmpS.setScalar(scale);
      mat4.compose(tmpV, tmpQ, tmpS);
      sticks.setMatrixAt(i, mat4);
      e.headPos.copy(tmpV).addScaledVector(dir, 0.39 * scale);
      mat4.compose(e.headPos, tmpQ, tmpS);
      heads.setMatrixAt(i, mat4);
      tmpV.copy(e.headPos).addScaledVector(dir, 0.13 * scale);
      fpos.setXYZ(i, tmpV.x, tmpV.y, tmpV.z);
      fsize.setX(i, (age < INTRO ? 1.6 : 1) * (scale / MS) * (0.9 + st.heat * 0.3) * (e.dead ? 0.45 : 1 + 0.4 * e.power));
    }
    sticks.count = heads.count = list.length;
    matchFlames.geometry.setDrawRange(0, list.length);
    sticks.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
    fpos.needsUpdate = fsize.needsUpdate = true;

    // -- étincelles
    const sp = sparks.geometry.attributes.position, ss = sparks.geometry.attributes.aSize;
    for (let i = 0; i < 400; i++) {
      if (sparkLife[i] <= 0) { if (ss.getX(i) !== 0) ss.setX(i, 0); continue; }
      sparkLife[i] -= dt;
      sparkVel[i * 3 + 1] -= 3.2 * dt;
      sp.setXYZ(i, sp.getX(i) + sparkVel[i * 3] * dt, sp.getY(i) + sparkVel[i * 3 + 1] * dt, sp.getZ(i) + sparkVel[i * 3 + 2] * dt);
      ss.setX(i, clamp(sparkLife[i] * 1.6));
    }
    sp.needsUpdate = ss.needsUpdate = true;

    // -- braises qui montent de la flamme
    const ep = embers.geometry.attributes.position, es = embers.geometry.attributes.aSize;
    for (let i = 0; i < emberState.length; i++) {
      const e = emberState[i];
      e.t += dt;
      if (e.t > e.life) {
        e.t = 0; e.life = 2 + Math.random() * 2.5;
        e.x = (Math.random() - 0.5) * 0.3; e.z = (Math.random() - 0.5) * 0.3;
        e.vx = (Math.random() - 0.5) * 0.35; e.vz = (Math.random() - 0.5) * 0.35;
      }
      const k = e.t / e.life;
      ep.setXYZ(i, flameWorld.x + e.x + e.vx * e.t + Math.sin(t * 2 + i) * 0.15 * k,
        flameWorld.y + 0.8 + e.t * (0.9 + st.heat * 0.6), flameWorld.z + e.z + e.vz * e.t);
      es.setX(i, Math.sin(Math.PI * k) * (0.5 + st.heat) * Math.min(1, st.flameOn) * (i % 3 === 0 ? 1.4 : 1));
    }
    ep.needsUpdate = es.needsUpdate = true;

    // -- fumée (bougie éteinte)
    for (const s of smoke) {
      if (!s.on) continue;
      s.t += dt;
      if (s.t < 0) continue;
      s.s.visible = true;
      const k = s.t / 3;
      s.s.position.set(flameWorld.x + Math.sin(s.t * 1.7 + k * 4) * 0.3 * k, flameWorld.y + s.t * 1.1, flameWorld.z);
      s.s.scale.setScalar(0.5 + k * 2.5);
      s.s.material.opacity = 0.35 * Math.sin(Math.PI * clamp(k));
      if (k >= 1) { s.on = false; s.s.visible = false; }
    }

    for (const p of [matchFlames, sparks, embers]) p.material.uniforms.uTime.value = t;
    controls.update();
    composer.render();
    onFrame?.(t);
    last = t;
  }

  let running = true;
  renderer.setAnimationLoop(() => { if (running) frame(); });
  document.addEventListener('visibilitychange', () => { running = !document.hidden; clock.getDelta(); });

  const project = new THREE.Vector3();
  function screenOf(mint) {
    const e = byMint.get(mint);
    if (!e) return null;
    project.copy(e.headPos).project(camera);
    return {
      x: (project.x * 0.5 + 0.5) * width,
      y: (-project.y * 0.5 + 0.5) * height,
      visible: project.z < 1 && Math.abs(project.x) < 1.1 && Math.abs(project.y) < 1.1,
      arriving: last - e.born < INTRO,
    };
  }

  // L'allumette la plus proche d'un point de l'écran (survol, toucher).
  function pick(x, y, radius = 24) {
    let best = null, bestD = radius * radius;
    for (const e of list) {
      project.copy(e.headPos).project(camera);
      if (project.z > 1) continue;
      const sx = (project.x * 0.5 + 0.5) * width, sy = (-project.y * 0.5 + 0.5) * height;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bestD) { bestD = d; best = e.m; }
    }
    return best;
  }

  return {
    canvas: renderer.domElement,
    setCandle({ melted, heat }) {
      st.meltedTarget = clamp(melted);
      st.heatTarget = clamp(heat);
    },
    setMatches(ms) {
      list.length = 0;
      byMint.clear();
      for (const m of ms) insert(m, false, clock.elapsedTime);
    },
    addMatch(m) { insert(m, true, clock.elapsedTime); },
    updateMarkets(markets) {
      for (const k of markets) {
        const e = byMint.get(k.mint);
        if (!e) continue;
        e.m.mcap = k.mcap;
        e.m.change = k.change;
        e.powerTarget = marketPower(k.mcap);
        tintFor(e, list.indexOf(e));
      }
    },
    flare() {
      st.pulse = 1.2;
      burst(flameWorld, 70, 1.3);
    },
    burnout() {
      return new Promise((done) => {
        if (st.burn) { done(); return; }
        st.burn = { start: clock.elapsedTime, done };
        burst(flameWorld, 90, 1.5);
      });
    },
    get burning() { return Boolean(st.burn); },
    screenOf,
    pick,
    pause(on) { controls.autoRotate = !on && !reduced; },
  };
}
