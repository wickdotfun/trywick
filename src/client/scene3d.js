// WICK en 3D (Three.js), style « low poly » à facettes. Tout est généré en code :
// pas de modèle à charger, et les 5 formes sortent du même moule.
// createScene(conteneur) renvoie un petit objet pour piloter la scène depuis app.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const BG = 0x0b0705;

export const MOOD_COLORS = {
  euphorie: { outer: '#2dff86', core: '#eafff2', light: '#5dff9d' },
  content:  { outer: '#b5f23c', core: '#fbffe0', light: '#d4ff7a' },
  calme:    { outer: '#ff9a2e', core: '#fff2c0', light: '#ffb65c' },
  stress:   { outer: '#ff6a2a', core: '#ffe0c4', light: '#ff8a4a' },
  panique:  { outer: '#ff2e3a', core: '#ffd2cc', light: '#ff4a4a' },
};

// Ce que fait le visage selon l'humeur.
const FACES = {
  euphorie: { eyes: 'happy', mouth: 'bigopen', cheeks: true },
  content:  { eyes: 'open', mouth: 'smile', cheeks: true },
  calme:    { eyes: 'open', mouth: 'flat' },
  stress:   { eyes: 'wide', mouth: 'wavy', brows: true, sweat: true },
  panique:  { eyes: 'wide', mouth: 'o', brows: true, sweat: true, small: true },
  dead:     { eyes: 'x', mouth: 'sad' },
  sleep:    { eyes: 'closed', mouth: 'sleep' },
};

// ---------------------------------------------------------------- utilitaires

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const softDot = () => canvasTexture(64, (g, s) => {
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
});

function textSprite(text, { size = 48, color = '#fff', font = '700 {s}px Unbounded, system-ui, sans-serif' } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const f = font.replace('{s}', size);
  g.font = f;
  const w = Math.ceil(g.measureText(text).width) + size;
  c.width = w;
  c.height = size * 1.6;
  g.font = f;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,.7)';
  g.shadowBlur = size * 0.25;
  g.fillStyle = color;
  g.fillText(text, w / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.userData.aspect = w / c.height;
  return sprite;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

// La surface du corps : un cylindre (n = 0) ou un prisme à n facettes dont la
// facette avant est bien à plat, face à la caméra (c'est là qu'on pose le visage).
const surf = (R) => (typeof R === 'number' ? { R, n: 0 } : R);

function surfaceAt(x, R, n) {
  if (!n) return { z: Math.sqrt(Math.max(R * R - x * x, 0)), a: Math.asin(Math.max(-1, Math.min(1, x / R))) };
  const ax = Math.abs(x);
  const sgn = x < 0 ? -1 : 1;
  for (let j = 0; j <= n / 2; j++) {
    const a0 = ((2 * j - 1) * Math.PI) / n;
    const a1 = ((2 * j + 1) * Math.PI) / n;
    const x0 = R * Math.sin(a0); const z0 = R * Math.cos(a0);
    const x1 = R * Math.sin(a1); const z1 = R * Math.cos(a1);
    if (ax <= x1 || a1 >= Math.PI / 2) {
      const t = x1 === x0 ? 0 : Math.max(0, Math.min(1, (ax - x0) / (x1 - x0)));
      return { z: z0 + (z1 - z0) * t, a: sgn * ((2 * j * Math.PI) / n) };
    }
  }
  return { z: 0, a: 0 };
}

const onCyl = (x, y, S, lift = 0.004) => {
  const { R, n } = surf(S);
  const { z, a } = surfaceAt(x, R, n);
  return new THREE.Vector3(x + Math.sin(a) * lift, y, z + Math.cos(a) * lift);
};

function place(obj, x, y, S, lift) {
  const { R, n } = surf(S);
  obj.position.copy(onCyl(x, y, S, lift));
  obj.rotation.y = surfaceAt(x, R, n).a;
  return obj;
}

// Un trait (sourcil, bouche…) qui épouse la surface, avec des bouts arrondis.
function stroke(points, S, radius, mat) {
  const flat = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0)));
  const pts = flat.getPoints(24).map((p) => onCyl(p.x, p.y, S, radius * 0.6));
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, radius, 6, false), mat));
  const cap = new THREE.SphereGeometry(radius, 8, 6);
  for (const p of [pts[0], pts[pts.length - 1]]) {
    const m = new THREE.Mesh(cap, mat);
    m.position.copy(p);
    g.add(m);
  }
  return g;
}

// Petit hasard déterministe (les mêmes coulures à chaque rendu).
function rand(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Trait plat dans le repère local d'un œil (petits arcs).
function localArc(points, radius, mat) {
  const pts = points.map(([x, y]) => new THREE.Vector3(x, y, 0.012));
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, radius, 8, false), mat));
  const cap = new THREE.SphereGeometry(radius, 8, 6);
  for (const p of [pts[0], pts[pts.length - 1]]) {
    const m = new THREE.Mesh(cap, mat);
    m.position.copy(p);
    g.add(m);
  }
  return g;
}

// ---------------------------------------------------------------- matériaux

function makeMaterials() {
  const flat = (o) => new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.78, metalness: 0, ...o });
  return {
    wax: flat({ color: 0xf6e6cc, emissive: new THREE.Color(0xff9a2e), emissiveIntensity: 0.05 }),
    waxTop: flat({ color: 0xfff4e4, roughness: 0.6, emissive: new THREE.Color(0xff9a2e), emissiveIntensity: 0.08 }),
    pool: flat({ color: 0xefdcbd }),
    wood: flat({ color: 0xe6b574 }),
    woodDark: flat({ color: 0x7b4a2c }),
    matchHead: flat({ color: 0xe0463d, roughness: 0.6 }),
    brass: flat({ color: 0xe9b14c, metalness: 0.55, roughness: 0.35 }),
    cloth: flat({ color: 0xd08e52 }),
    clothBand: flat({ color: 0x6b3f22 }),
    char: flat({ color: 0x3a2620 }),
    wick: flat({ color: 0x2b211c }),
    ember: new THREE.MeshBasicMaterial({ color: 0xff7a2a }),
    eye: new THREE.MeshPhysicalMaterial({ color: 0x1b1310, roughness: 0.2, clearcoat: 1, flatShading: true }),
    white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    sclera: flat({ color: 0xffffff, roughness: 0.4 }),
    ink: new THREE.MeshStandardMaterial({ color: 0x2a1812, roughness: 0.6 }),
    mouth: new THREE.MeshStandardMaterial({ color: 0x5a1c1c, roughness: 0.5, side: THREE.DoubleSide }),
    tongue: new THREE.MeshStandardMaterial({ color: 0xff7d86, roughness: 0.5, side: THREE.DoubleSide }),
    cheek: new THREE.MeshBasicMaterial({ color: 0xff8f8a, transparent: true, opacity: 0.5, depthWrite: false }),
    sweat: new THREE.MeshPhysicalMaterial({ color: 0x8fd6ff, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85, flatShading: true }),
    podium: flat({ color: 0x1d1727, roughness: 0.6, metalness: 0.2 }),
    // Accessoires : couleur de la flamme de la bougie, montures sombres.
    acc: flat({ color: 0xff9a2e, roughness: 0.55 }),
    shades: new THREE.MeshPhysicalMaterial({ color: 0x14121a, roughness: 0.15, metalness: 0.3, clearcoat: 1, flatShading: true }),
    petal: flat({ color: 0xff8fb8, roughness: 0.6 }),
    ring: new THREE.MeshBasicMaterial({ color: 0xff9a2e, side: THREE.DoubleSide }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xcfe6ff, roughness: 0.05, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false, flatShading: true }),
  };
}

// ---------------------------------------------------------------- flamme en cristal

// Une goutte taillée à facettes. Chaque facette a sa propre nuance (couleurs de
// sommets) : la flamme scintille comme une pierre quand elle tourne.
function flameGeometry(sides = 6, rings = 6) {
  const pts = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const r = 0.34 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.9);
    pts.push(new THREE.Vector2(Math.max(r, 0.0001), t));
  }
  const geo = new THREE.LatheGeometry(pts, sides).toNonIndexed();
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let tri = 0; tri < pos.count / 3; tri++) {
    const y = (pos.getY(tri * 3) + pos.getY(tri * 3 + 1) + pos.getY(tri * 3 + 2)) / 3;
    const shade = (0.72 + 0.45 * rand(tri + 1)) * (1.15 - 0.35 * y);
    for (let k = 0; k < 3; k++) colors.set([shade, shade, shade], (tri * 3 + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// La couleur réelle vient de l'humeur ; on la pousse au-delà de 1 pour que le bloom brille.
function flameMaterial(color, boost = 1.7) {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(color).multiplyScalar(boost) });
  mat.userData.boost = boost;
  return mat;
}

// ---------------------------------------------------------------- corps selon la forme

const HEX = 6;
const HEX_START = Math.PI / HEX; // une facette bien à plat face à la caméra

// Profil d'une bougie hexagonale : pied biseauté, rebord de cire, creux au sommet.
function candleProfile(R, H) {
  return [
    new THREE.Vector2(0.0001, 0), new THREE.Vector2(R - 0.05, 0), new THREE.Vector2(R, 0.05),
    new THREE.Vector2(R, H - 0.09), new THREE.Vector2(R - 0.02, H - 0.02), new THREE.Vector2(R - 0.07, H),
    new THREE.Vector2(R - 0.13, H - 0.015), new THREE.Vector2(R * 0.35, H - 0.05), new THREE.Vector2(0.0001, H - 0.06),
  ];
}

const lowCapsule = (r, L) => new THREE.CapsuleGeometry(r, L, 2, 6);

// Une bougie : corps à facettes, rebord fondu, coulures aux arêtes, mèche.
function candle(group, mats, R, H, y0, seed = 1) {
  const body = new THREE.Mesh(new THREE.LatheGeometry(candleProfile(R, H), HEX, HEX_START), mats.wax);
  body.position.y = y0;
  body.userData.poke = true;
  group.add(body);

  // Rebord de cire fondue qui déborde un peu.
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.025, R + 0.03, 0.07, HEX, 1, false, HEX_START), mats.waxTop);
  lip.position.y = y0 + H - 0.055;
  group.add(lip);

  // Coulures sur les arêtes de côté et de derrière (pas devant le visage).
  const corners = [1, 2, 3, 4].map((k) => HEX_START + (k * 2 * Math.PI) / HEX);
  corners.forEach((phi, i) => {
    const L = Math.min(H * 0.55, 0.12 + rand(seed * 10 + i) * 0.35 * (0.5 + H));
    const d = new THREE.Mesh(lowCapsule(0.06, L), mats.waxTop);
    d.position.set(Math.sin(phi) * (R + 0.005), y0 + H - 0.07 - L / 2, Math.cos(phi) * (R + 0.005));
    group.add(d);
  });
  // Une petite coulure sur la face avant, sur le bord, pour le charme.
  const fz = R * Math.cos(Math.PI / HEX);
  const front = new THREE.Mesh(lowCapsule(0.045, 0.1), mats.waxTop);
  front.position.set(-R * 0.34, y0 + H - 0.13, fz + 0.01);
  group.add(front);

  const top = y0 + H - 0.05;
  const wickCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, top - 0.02, 0), new THREE.Vector3(0.02, top + 0.1, 0), new THREE.Vector3(-0.015, top + 0.2, 0),
  ]);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(wickCurve, 6, 0.024, 5, false), mats.wick));
  const ember = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035, 0), mats.ember);
  ember.position.set(-0.015, top + 0.2, 0);
  ember.name = 'ember';
  group.add(ember);
  return { flameAt: new THREE.Vector3(-0.015, top + 0.16, 0), top: top + 0.2 };
}

// Flaque de cire au pied, bord irrégulier, avec quelques gouttes figées.
function puddle(group, mats, R, y0 = 0) {
  const geo = new THREE.CylinderGeometry(R * 1.32, R * 1.42, 0.07, 9, 1, false, 0.2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i); const z = pos.getZ(i);
    const k = 1 + (rand(Math.round(Math.atan2(z, x) * 100)) - 0.5) * 0.22;
    pos.setXYZ(i, x * k, pos.getY(i), z * k);
  }
  geo.computeVertexNormals();
  const pool = new THREE.Mesh(geo, mats.pool);
  pool.position.y = y0 + 0.035;
  group.add(pool);
  [[0.7, 0.09], [2.6, 0.07], [4.1, 0.1], [5.4, 0.06]].forEach(([a, r]) => {
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mats.waxTop);
    blob.position.set(Math.sin(a) * R * 1.25, y0 + 0.06, Math.cos(a) * R * 1.25);
    blob.scale.y = 0.7;
    group.add(blob);
  });
}


// ---------------------------------------------------------------- look unique

// L'accessoire, posé dans le repère du visage (x, y autour du centre du visage).
// Chaque accessoire a sa place, sans toucher les yeux, la bouche ni les sourcils :
// yeux à y ≈ +0,06, bouche entre -0,12 et -0,24, sourcils vers +0,25.
function buildAccessory(kind, { R, n, s }, mats) {
  const S = { R, n };
  const g = new THREE.Group();
  if (kind === 'lunettes') {
    // Des lunettes rondes autour des yeux : on voit toujours le regard à travers.
    const frame = (side) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.112 * s, 0.013 * s, 6, 20), mats.shades);
      return place(new THREE.Group().add(ring), side * 0.18 * s, 0.06 * s, S, 0.05 * s);
    };
    g.add(frame(-1), frame(1));
    g.add(stroke([[-0.07 * s, 0.075 * s], [0, 0.09 * s], [0.07 * s, 0.075 * s]], S, 0.012 * s, mats.shades));
  } else if (kind === 'noeud') {
    // Un nœud papillon, bien en dessous de la bouche.
    const bow = place(new THREE.Group(), 0, -0.36 * s, S, 0.04 * s);
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.ConeGeometry(0.075 * s, 0.15 * s, 4), mats.acc);
      wing.rotation.z = (side * Math.PI) / 2;
      wing.position.x = side * 0.075 * s;
      wing.scale.z = 0.5;
      bow.add(wing);
    }
    bow.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.035 * s, 0), mats.acc));
    g.add(bow);
  } else if (kind === 'echarpe') {
    // Une écharpe autour du « cou », avec un pan qui tombe sur le côté.
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.045, R + 0.05, 0.11 * s, HEX, 1, false, HEX_START), mats.acc);
    band.position.y = -0.37 * s;
    g.add(band);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 0.26 * s, 0.03 * s), mats.acc);
    tail.position.y = -0.1 * s;
    tail.rotation.z = 0.1;
    g.add(place(new THREE.Group().add(tail), 0.2 * s, -0.4 * s, S, 0.06));
  } else if (kind === 'fleur') {
    // Une fleur piquée en haut, sur le côté.
    const flower = place(new THREE.Group(), -0.24 * s, 0.3 * s, S, 0.035 * s);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const petal = new THREE.Mesh(new THREE.IcosahedronGeometry(0.052 * s, 0), mats.petal);
      petal.position.set(Math.cos(a) * 0.062 * s, Math.sin(a) * 0.062 * s, 0);
      petal.scale.z = 0.45;
      flower.add(petal);
    }
    flower.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.04 * s, 0), mats.brass));
    g.add(flower);
  }
  return g;
}

// hauteur : 0..1 (quantité de cire)
function buildStage(stage, wax, mats) {
  const g = new THREE.Group();
  const w = Math.max(0, Math.min(1, wax / 100));
  let out;

  if (stage === 'allumette') {
    // Bâtonnet carré, comme une vraie allumette, et une grosse tête taillée.
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.8, 4, 1, false, Math.PI / 4), mats.wood);
    stick.position.y = 0.9;
    stick.userData.poke = true;
    g.add(stick);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), mats.matchHead);
    head.scale.set(1, 1.12, 1);
    head.position.y = 2.1;
    head.userData.poke = true;
    head.name = 'matchHead';
    g.add(head);
    out = {
      face: { y: 2.08, R: 0.47, n: 0, s: 0.9, skin: mats.matchHead },
      shoulders: { y: 1.3, x: 0.14, s: 0.8, skin: mats.wood },
      flameAt: new THREE.Vector3(0, 2.62, 0), top: 2.68, flameScale: 1,
    };
  } else if (stage === 'bougie') {
    const R = 0.6;
    const H = 0.85 + 0.85 * w;
    puddle(g, mats, R);
    const c = candle(g, mats, R, H, 0.02, 1);
    out = {
      face: { y: 0.02 + Math.min(Math.max(H * 0.47, 0.42), H - 0.36), R, n: HEX, s: 1, skin: mats.wax },
      shoulders: { y: Math.max(H * 0.36, 0.3), x: R * 0.9, s: 1 },
      ...c, flameScale: 1,
    };
  } else if (stage === 'chandelle') {
    const dish = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.0001, 0), new THREE.Vector2(0.8, 0), new THREE.Vector2(0.88, 0.07),
      new THREE.Vector2(0.84, 0.13), new THREE.Vector2(0.5, 0.1), new THREE.Vector2(0.0001, 0.1),
    ], 10), mats.brass);
    g.add(dish);
    const R = 0.46;
    const H = 1.15 + 1.0 * w;
    const c = candle(g, mats, R, H, 0.1, 2);
    out = {
      face: { y: 0.1 + Math.min(Math.max(H * 0.55, 0.5), H - 0.36), R, n: HEX, s: 0.86, skin: mats.wax },
      shoulders: { y: 0.1 + Math.max(H * 0.4, 0.35), x: R * 0.9, s: 0.9 },
      ...c, flameScale: 1.1,
    };
  } else if (stage === 'chandelier') {
    const holder = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.0001, 0), new THREE.Vector2(0.9, 0), new THREE.Vector2(0.96, 0.06), new THREE.Vector2(0.86, 0.12),
      new THREE.Vector2(0.2, 0.17), new THREE.Vector2(0.13, 0.3), new THREE.Vector2(0.16, 0.42),
      new THREE.Vector2(0.64, 0.5), new THREE.Vector2(0.68, 0.6), new THREE.Vector2(0.56, 0.62), new THREE.Vector2(0.0001, 0.6),
    ], 10), mats.brass);
    g.add(holder);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.055, 4, 10, Math.PI * 1.3), mats.brass);
    handle.position.set(0.98, 0.18, 0);
    handle.rotation.z = -Math.PI * 0.65;
    g.add(handle);
    const R = 0.5;
    const H = 0.9 + 0.75 * w;
    const c = candle(g, mats, R, H, 0.58, 3);
    out = {
      face: { y: 0.58 + Math.min(Math.max(H * 0.48, 0.42), H - 0.36), R, n: HEX, s: 0.9, skin: mats.wax },
      shoulders: { y: 0.58 + Math.max(H * 0.36, 0.3), x: R * 0.9, s: 0.9 },
      ...c, flameScale: 1.2,
    };
  } else {
    // Torche : manche en bois à pans, tête de tissu hexagonale serrée par deux liens.
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.085, 1.7, 6, 1, false, HEX_START), mats.woodDark);
    handle.position.y = 0.85;
    g.add(handle);
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.45, 0.86, HEX, 1, false, HEX_START), mats.cloth);
    wrap.position.y = 2.05;
    wrap.userData.poke = true;
    g.add(wrap);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.08, HEX, 1, false, HEX_START), mats.char);
    cap.position.y = 2.52;
    g.add(cap);
    for (const [y, r] of [[2.4, 0.575], [1.72, 0.475]]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.07, HEX, 1, false, HEX_START), mats.clothBand);
      band.position.y = y;
      g.add(band);
    }
    const ember = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), mats.ember);
    ember.position.y = 2.57;
    ember.scale.y = 0.25;
    ember.name = 'ember';
    g.add(ember);
    out = {
      face: { y: 2.04, R: 0.53, n: HEX, s: 0.95, skin: mats.cloth },
      shoulders: { y: 1.95, x: 0.48, s: 1, skin: mats.cloth },
      flameAt: new THREE.Vector3(0, 2.52, 0), top: 2.6, flameScale: 1.35,
    };
  }
  return { group: g, ...out };
}

// ---------------------------------------------------------------- visage

function buildFace(kind, { R, n, s, skin }, mats) {
  const S = { R, n };
  const cfg = FACES[kind] || FACES.calme;
  const face = new THREE.Group();
  const eyes = [];
  const ex = 0.18 * s;
  const ey = 0.06 * s;

  for (const side of [-1, 1]) {
    const holder = place(new THREE.Group(), side * ex, ey, S, 0.002);
    const inner = new THREE.Group();
    holder.add(inner);
    const r = 0.075 * s;
    if (cfg.eyes === 'happy') {
      inner.add(localArc([[-r, -r * 0.3], [0, r * 0.7], [r, -r * 0.3]], 0.02 * s, mats.ink));
    } else if (cfg.eyes === 'closed') {
      inner.add(localArc([[-r, r * 0.2], [0, -r * 0.55], [r, r * 0.2]], 0.018 * s, mats.ink));
    } else if (cfg.eyes === 'x') {
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.018 * s, r * 1.8, 4, 8), mats.ink);
        bar.rotation.z = a;
        bar.position.z = 0.012;
        inner.add(bar);
      }
    } else if (cfg.eyes === 'wide') {
      const sc = new THREE.Mesh(new THREE.SphereGeometry(r * 1.35, 10, 8), mats.sclera);
      sc.scale.set(1, 1.1, 0.42);
      inner.add(sc);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * (cfg.small ? 0.36 : 0.55), 8, 6), mats.eye);
      pupil.scale.z = 0.5;
      pupil.position.z = r * 0.5;
      pupil.name = 'pupil';
      inner.add(pupil);
    } else {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mats.eye);
      ball.scale.set(1, 1.22, 0.5);
      inner.add(ball);
      const hi = new THREE.Mesh(new THREE.SphereGeometry(r * 0.3, 10, 8), mats.white);
      hi.position.set(r * 0.32, r * 0.45, r * 0.42);
      inner.add(hi);
    }
    holder.userData.blinkable = ['open', 'wide'].includes(cfg.eyes);
    face.add(holder);
    eyes.push(holder);
  }

  const my = -0.14 * s;
  const lw = 0.016 * s;
  const mouthShapes = {
    smile: [[-0.1, 0.01], [0, -0.055], [0.1, 0.01]],
    flat: [[-0.07, -0.02], [0.07, -0.02]],
    sad: [[-0.08, -0.06], [0, -0.015], [0.08, -0.06]],
    sleep: [[-0.05, 0], [0, -0.03], [0.05, 0]],
    wavy: [-0.1, -0.066, -0.033, 0, 0.033, 0.066, 0.1].map((x, i) => [x, (i % 2 ? 0.014 : -0.014) - 0.01]),
  };
  if (mouthShapes[cfg.mouth]) {
    face.add(stroke(mouthShapes[cfg.mouth].map(([x, y]) => [x * s, my + y * s]), S, lw, mats.ink));
  } else if (cfg.mouth === 'bigopen') {
    const w = 0.13 * s;
    const shape = new THREE.Shape();
    shape.moveTo(-w, 0);
    shape.quadraticCurveTo(0, -w * 1.9, w, 0);
    shape.quadraticCurveTo(0, w * 0.12, -w, 0);
    const m = place(new THREE.Mesh(new THREE.ShapeGeometry(shape, 16), mats.mouth), 0, my + 0.02 * s, S, 0.006);
    face.add(m);
    const tg = new THREE.Mesh(new THREE.CircleGeometry(w * 0.45, 20), mats.tongue);
    place(tg, 0, my - 0.07 * s, S, 0.008);
    tg.scale.set(1.2, 0.6, 1);
    face.add(tg);
  } else if (cfg.mouth === 'o') {
    const o = place(new THREE.Mesh(new THREE.CircleGeometry(0.055 * s, 24), mats.mouth), 0, my - 0.02 * s, S, 0.006);
    o.scale.set(0.85, 1.2, 1);
    face.add(o);
  }

  if (cfg.cheeks) {
    for (const side of [-1, 1]) {
      const c = place(new THREE.Mesh(new THREE.CircleGeometry(0.05 * s, 8), mats.cheek), side * 0.27 * s, -0.07 * s, S, 0.006);
      c.scale.set(1.3, 0.8, 1);
      face.add(c);
    }
  }
  if (cfg.brows) {
    // Sourcils inquiets, bien au-dessus des yeux (et des lunettes).
    face.add(stroke([[-0.26 * s, 0.22 * s], [-0.12 * s, 0.27 * s]], S, 0.014 * s, mats.ink));
    face.add(stroke([[0.26 * s, 0.22 * s], [0.12 * s, 0.27 * s]], S, 0.014 * s, mats.ink));
  }
  let sweat = null;
  if (cfg.sweat) {
    sweat = new THREE.Group();
    const drop = new THREE.Mesh(new THREE.SphereGeometry(0.04 * s, 8, 6), mats.sweat);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.028 * s, 0.06 * s, 6), mats.sweat);
    tip.position.y = 0.045 * s;
    sweat.add(drop, tip);
    // Sur la tempe, à côté de l'œil (et pas dessus).
    place(sweat, 0.36 * s, 0.2 * s, S, 0.03);
    sweat.userData.base = sweat.position.y;
    face.add(sweat);
  }
  return { face, eyes, sweat };
}

function buildArms(mats, skin, s) {
  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075 * s, 0.26 * s, 2, 6), skin);
    arm.position.y = -0.19 * s;
    pivot.add(arm);
    const hand = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1 * s, 1), skin);
    hand.position.y = -0.36 * s;
    pivot.add(hand);
    pivot.userData.side = side;
    arms.push(pivot);
  }
  return arms;
}

// ---------------------------------------------------------------- particules

function makeEmbers(count, tex) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 1.2 + Math.random() * 2.8;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.random() * 4;
    pos[i * 3 + 2] = Math.sin(a) * r - 0.6;
    seeds[i] = Math.random();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 0.06, map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xff9a2e, opacity: 0.9 });
  const pts = new THREE.Points(geo, mat);
  pts.userData.seeds = seeds;
  return pts;
}

function makeBurst(max, tex) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
  const mat = new THREE.PointsMaterial({ size: 0.075, map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd36a });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.parts = [];
  pts.userData.max = max;
  return pts;
}

// ---------------------------------------------------------------- scène

export function createScene(container, { onPoke } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  if (!renderer.getContext()) throw new Error('webgl');
  const mobile = matchMedia('(max-width: 820px)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(BG, 1);
  container.appendChild(renderer.domElement);
  renderer.domElement.className = 'scene-canvas';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.FogExp2(BG, 0.055);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.28;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  let camDist = 7;
  const lookAt = new THREE.Vector3(0, 1.3, 0);

  // Lumières : nuit violette + la flamme qui éclaire vraiment le personnage.
  const hemi = new THREE.HemisphereLight(0x7a6bb0, 0x1a1422, 0.55);
  const key = new THREE.DirectionalLight(0xc9c0ff, 0.5);
  key.position.set(3, 4, 5);
  const rim = new THREE.DirectionalLight(0x9a7cff, 1.1);
  rim.position.set(-3, 3, -4);
  const flameLight = new THREE.PointLight(0xffa24a, 7, 7, 1.7);
  scene.add(hemi, key, rim, flameLight);

  const mats = makeMaterials();
  const dot = softDot();

  // Le socle et son anneau lumineux aux couleurs de l'humeur.
  const podium = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.5, 0.32, 10), mats.podium);
  podium.position.y = -0.16;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.365, 1.365, 0.035, 10, 1, true), mats.ring);
  ring.position.y = -0.005;
  const floorGlow = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), new THREE.MeshBasicMaterial({ map: dot, color: 0xff9a2e, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.y = -0.31;
  scene.add(podium, ring, floorGlow);

  // Le personnage.
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  scene.add(root);

  // La flamme : un cristal extérieur aux couleurs de l'humeur, un cœur clair,
  // un halo. bend = le vent qui la couche, spin = elle tourne pour scintiller.
  const flameGeo = flameGeometry();
  const flameGroup = new THREE.Group();
  const flameBend = new THREE.Group();
  const flameSpin = new THREE.Group();
  const flameOuter = new THREE.Mesh(flameGeo, flameMaterial('#ff9a2e', 1.3));
  const flameCore = new THREE.Mesh(flameGeometry(5, 4), flameMaterial('#fff2c0', 1.55));
  flameCore.scale.set(0.5, 0.58, 0.5);
  flameCore.position.set(0, 0.02, 0.04);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xff9a2e, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(1.5);
  glow.position.y = 0.35;
  flameSpin.add(flameOuter, flameCore);
  flameBend.add(flameSpin);
  flameGroup.add(glow, flameBend);
  body.add(flameGroup);

  // Cloche en verre (abri).
  const dome = new THREE.Group();
  const domeGlass = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(1.18, 0), new THREE.Vector2(1.18, 0.05), new THREE.Vector2(1.12, 0.1), new THREE.Vector2(1.12, 2.4),
    new THREE.Vector2(1.05, 2.85), new THREE.Vector2(0.8, 3.2), new THREE.Vector2(0.4, 3.4), new THREE.Vector2(0.0001, 3.45),
  ], 10), mats.glass);
  const knob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), mats.brass);
  knob.position.y = 3.5;
  dome.add(domeGlass, knob);
  dome.visible = false;
  scene.add(dome);

  const embers = makeEmbers(mobile ? 60 : 110, dot);
  scene.add(embers);
  const burst = makeBurst(160, dot);
  scene.add(burst);

  // Fumée (éteinte) et « z » (allumette qui dort).
  const smoke = [];
  for (let i = 0; i < 10; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0x8a8398, transparent: true, opacity: 0, depthWrite: false }));
    sp.userData.phase = i / 10;
    smoke.push(sp);
    scene.add(sp);
  }
  const zzz = ['z', 'z', 'Z'].map((ch, i) => {
    const sp = textSprite(ch, { size: 64, color: '#d9d2f0' });
    sp.userData.phase = i / 3;
    scene.add(sp);
    return sp;
  });

  // Les flammèches de la communauté.
  const flamesGroup = new THREE.Group();
  scene.add(flamesGroup);
  let flammeches = [];

  // ------------------------------------------------ état courant
  let props = { stage: 'allumette', lit: false, wax: 0, mood: 'calme', shielded: false, windy: false, look: null };
  let lookKey = '';
  let sparkleT = 0;
  let built = null;
  let framed = false; // la toute première image se cadre d'un coup, sans glisser
  let face = null;
  let faceKey = '';
  let arms = [];
  let builtKey = '';
  let heightShown = 0;
  let squash = 0;
  let flare = 0;
  let shake = 0;
  let domeT = 0;
  let appear = 1;
  const pointer = new THREE.Vector2();
  const pointerSmooth = new THREE.Vector2();
  let nextBlink = 1.5;
  let blinkT = 0;
  const colors = { outer: new THREE.Color('#ff9a2e'), core: new THREE.Color('#fff2c0'), light: new THREE.Color('#ffb65c') };
  const target = { outer: new THREE.Color(), core: new THREE.Color(), light: new THREE.Color() };

  function faceKind() {
    if (!props.lit) return props.stage === 'allumette' ? 'sleep' : 'dead';
    return props.mood;
  }

  function rebuild() {
    if (built) {
      body.remove(built.group);
      built.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    built = buildStage(props.stage, heightShown, mats);
    body.add(built.group);
    // Visage, accessoire et bras : repositionnés, reconstruits seulement si nécessaire.
    const kind = faceKind();
    const key = `${props.stage}|${kind}|${lookKey}`;
    if (key !== faceKey) {
      if (face) { body.remove(face.face); face.face.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
      face = buildFace(kind, built.face, mats);
      if (props.look && props.stage !== 'allumette') {
        face.face.add(buildAccessory(props.look.accessory, built.face, mats));
      }
      body.add(face.face);
      arms.forEach((a) => body.remove(a));
      arms = buildArms(mats, built.shoulders.skin || built.face.skin, built.shoulders.s);
      arms.forEach((a) => body.add(a));
      faceKey = key;
    }
    face.face.position.y = built.face.y;
    for (const a of arms) a.position.set(a.userData.side * (built.shoulders.x + 0.01), built.shoulders.y, 0.02);
    flameGroup.position.copy(built.flameAt);
    const em = built.group.getObjectByName('ember');
    if (em) em.visible = props.lit;
  }

  // Les couleurs du look : la cire, et la flamme (qui reste la sienne quelle que soit l'humeur).
  function applyLook(look) {
    const wax = new THREE.Color(look?.wax.color || '#f6e6cc');
    mats.wax.color.copy(wax);
    mats.waxTop.color.copy(wax).lerp(new THREE.Color('#ffffff'), 0.35);
    mats.pool.color.copy(wax).multiplyScalar(0.94);
    mats.cloth.color.set('#d08e52').lerp(wax, 0.45);
    mats.acc.color.set(look?.flame.color || '#ff9a2e');
  }

  function update(next) {
    const prevStage = props.stage;
    props = { ...props, ...next };
    const flame = props.look?.flame.color;
    const c = flame
      ? { outer: flame, core: new THREE.Color(flame).lerp(new THREE.Color('#ffffff'), 0.72), light: new THREE.Color(flame).lerp(new THREE.Color('#ffffff'), 0.25) }
      : MOOD_COLORS[props.mood] || MOOD_COLORS.calme;
    target.outer.set(c.outer);
    target.core.set(c.core);
    target.light.set(c.light);
    const nextLook = props.look ? JSON.stringify(props.look) : '';
    const lookChanged = nextLook !== lookKey;
    if (lookChanged) { lookKey = nextLook; applyLook(props.look); }
    const key = `${props.stage}|${faceKind()}|${lookKey}`;
    if (props.stage !== prevStage) { appear = 0; heightShown = props.wax; }
    if (key !== faceKey || props.stage !== builtKey || lookChanged) {
      builtKey = props.stage;
      rebuild();
    }
  }

  // ------------------------------------------------ effets

  function emit(n, origin, { speed = 2.2, up = 1.6, color = 0xffd36a, life = 0.9 } = {}) {
    const parts = burst.userData.parts;
    burst.material.color.set(color);
    for (let i = 0; i < n && parts.length < burst.userData.max; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      parts.push({
        p: origin.clone(),
        v: new THREE.Vector3(Math.cos(a) * v * 0.6, up * (0.5 + Math.random()), Math.sin(a) * v * 0.6),
        life, age: 0,
      });
    }
  }

  function flameWorld() {
    const p = new THREE.Vector3();
    flameGroup.getWorldPosition(p);
    return p;
  }

  function react(kind) {
    const at = flameWorld();
    if (kind === 'gratter') { emit(26, at.clone().add(new THREE.Vector3(0, -0.2, 0.2)), { speed: 3, color: 0xffc14a }); shake = 0.35; }
    if (kind === 'raviver') { flare = 1; emit(18, at, { speed: 1.6, up: 2.4, color: target.outer.getHex() }); }
    if (kind === 'cire') { squash = 1; emit(10, at.clone().add(new THREE.Vector3(0, -0.3, 0)), { speed: 1, up: 1, color: 0xfff1d0 }); }
    if (kind === 'abri') { domeT = Math.min(domeT, 0.2); }
    if (kind === 'special') { flare = 1.4; squash = 1; emit(90, at, { speed: 4, up: 3, color: target.outer.getHex(), life: 1.4 }); }
    if (kind === 'poke') { squash = 0.8; flare = 0.5; emit(8, at, { speed: 1.2, up: 1.4, color: target.outer.getHex() }); }
  }

  // ------------------------------------------------ flammèches

  function setFlammeches(list, meId) {
    flamesGroup.clear();
    flammeches = list.slice(0, mobile ? 30 : 60).map((f, i) => {
      const seed = hashString(f.id);
      const mine = f.id === meId;
      const g = new THREE.Group();
      const size = (0.07 + 0.02 * (f.level || 1)) * (mine ? 1.6 : 1);
      const mat = flameMaterial(f.color, mine ? 1.9 : 1.4);
      const fl = new THREE.Mesh(flameGeo, mat);
      fl.scale.setScalar(size);
      fl.position.y = -size * 0.3;
      fl.rotation.y = seed * Math.PI;
      const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: f.color, transparent: true, opacity: mine ? 0.35 : 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
      gl.scale.setScalar(size * 3.2);
      g.add(gl, fl);
      if (mine) {
        const label = textSprite(f.name.replace(/ #\d+$/, ''), { size: 40, color: '#fff' });
        label.scale.set(0.16 * label.userData.aspect, 0.16, 1);
        label.position.y = size * 2.2 + 0.12;
        g.add(label);
      }
      g.userData = {
        mat, mine, fl,
        radius: mine ? (mobile ? 1.25 : 1.55) : 2.2 + seed * 1.3,
        height: mine ? 1.2 : 0.3 + ((seed * 7.3) % 1) * 2.8,
        speed: mine ? 0.35 : (0.12 + seed * 0.18) * (seed > 0.5 ? 1 : -1),
        phase: seed * Math.PI * 2 + i,
      };
      flamesGroup.add(g);
      return g;
    });
  }

  // ------------------------------------------------ rendu

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // Taille réelle du dessin. On la revérifie à chaque image : quand la page était
  // cachée (autre onglet du site), la scène mesurait 0 et restait sinon toute petite.
  let sizeW = 0;
  let sizeH = 0;
  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    sizeW = container.clientWidth;
    sizeH = container.clientHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    camera.aspect = w / h;
    // Sur un écran étroit, on recule un peu pour tout voir.
    camera.fov = w / h < 0.8 ? 40 : 30;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Le navigateur peut reprendre la carte graphique (onglet en arrière-plan, autre
  // vidéo…). Au retour, on recrée les images intermédiaires et l'éclairage d'ambiance.
  function rebuildTargets() {
    composer.setSize(1, 1);
    resize();
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  }
  renderer.domElement.addEventListener('webglcontextrestored', rebuildTargets);

  function onMove(e) {
    const r = container.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  }
  window.addEventListener('pointermove', onMove, { passive: true });

  const ray = new THREE.Raycaster();
  function onClick(e) {
    const r = container.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    ray.setFromCamera(p, camera);
    const hits = ray.intersectObject(body, true);
    if (hits.length) { react('poke'); onPoke?.(); }
  }
  renderer.domElement.addEventListener('click', onClick);

  const clock = new THREE.Clock();
  let running = true;
  let raf = 0;
  const tmp = new THREE.Vector3();

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!running) return;
    if (container.clientWidth && (container.clientWidth !== sizeW || container.clientHeight !== sizeH)) resize();
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    // Couleurs qui glissent doucement vers l'humeur.
    colors.outer.lerp(target.outer, 1 - Math.exp(-3 * dt));
    colors.core.lerp(target.core, 1 - Math.exp(-3 * dt));
    colors.light.lerp(target.light, 1 - Math.exp(-3 * dt));

    // La cire change de hauteur en douceur.
    if (Math.abs(heightShown - props.wax) > 0.2) {
      heightShown = damp(heightShown, props.wax, 2.5, dt);
      rebuild();
    }

    const lit = props.lit;
    const mood = props.mood;
    pointerSmooth.x = damp(pointerSmooth.x, pointer.x, 4, dt);
    pointerSmooth.y = damp(pointerSmooth.y, pointer.y, 4, dt);

    // Corps : respiration, humeur, réactions.
    appear = Math.min(1, appear + dt * 1.6);
    const pop = appear < 1 ? 1 + Math.sin(appear * Math.PI) * 0.25 : 1;
    squash = Math.max(0, squash - dt * 2.4);
    shake = Math.max(0, shake - dt);
    flare = Math.max(0, flare - dt * 1.2);
    const sq = Math.sin(squash * Math.PI) * 0.12;
    let bx = 0; let by = 0; let rz = 0; let rx = 0;
    let armLift = 0.15; let armWave = 0;
    const breathe = Math.sin(t * (lit ? 2.2 : 1.2)) * (lit ? 0.012 : 0.02);
    if (!lit && props.stage !== 'allumette') { rx = 0.14; armLift = 0.05; }
    else if (!lit) { rz = Math.sin(t * 0.8) * 0.03; armLift = 0.12; }
    else if (mood === 'euphorie') { by = Math.abs(Math.sin(t * 5)) * 0.09; armLift = 2.3; armWave = Math.sin(t * 10) * 0.35; }
    else if (mood === 'content') { rz = Math.sin(t * 1.6) * 0.045; armLift = 0.55; armWave = Math.sin(t * 2.2) * 0.15; }
    else if (mood === 'calme') { rz = Math.sin(t * 0.7) * 0.02; armLift = 0.12; }
    else if (mood === 'stress') { bx = Math.sin(t * 40) * 0.008; armLift = 0.35; armWave = Math.sin(t * 13) * 0.08; }
    else if (mood === 'panique') { bx = Math.sin(t * 55) * 0.025; rz = Math.sin(t * 31) * 0.045; armLift = 2.55; armWave = Math.sin(t * 20) * 0.5; }
    if (shake) bx += Math.sin(t * 70) * 0.03 * shake;

    root.rotation.y = damp(root.rotation.y, pointerSmooth.x * 0.4, 3, dt);
    body.position.set(bx, by, 0);
    body.rotation.set(rx, 0, rz);
    body.scale.set(pop * (1 + sq), pop * (1 + breathe - sq), pop * (1 + sq));

    arms.forEach((a) => {
      const s = a.userData.side;
      a.rotation.z = s * (armLift + (s > 0 ? armWave : -armWave));
    });

    // Yeux : clignements et regard qui suit la souris.
    if (face) {
      nextBlink -= dt;
      if (nextBlink <= 0) { blinkT = 0.16; nextBlink = 2.5 + Math.random() * 3.5; }
      blinkT = Math.max(0, blinkT - dt);
      const lid = blinkT > 0 ? Math.max(0.08, Math.abs(blinkT - 0.08) / 0.08) : 1;
      for (const e of face.eyes) {
        if (e.userData.blinkable) e.scale.y = lid;
        const inner = e.children[0];
        inner.position.x = damp(inner.position.x, pointerSmooth.x * 0.02, 6, dt);
        inner.position.y = damp(inner.position.y, pointerSmooth.y * 0.015, 6, dt);
      }
      if (face.sweat) {
        const k = (t * 0.6) % 1;
        face.sweat.position.y = face.sweat.userData.base - k * 0.18;
        face.sweat.children.forEach((m) => { m.material.opacity = 0.85 * (1 - k); });
      }
    }

    // Flamme.
    const windy = props.windy;
    const fscale = (built?.flameScale || 1) * (0.62 + 0.5 * Math.min(1, props.wax / 100)) * (1 + flare * 0.45);
    flameGroup.visible = lit;
    flameGroup.scale.setScalar(damp(flameGroup.scale.x || 1, lit ? fscale : 0.01, 6, dt));
    // Elle tourne doucement (les facettes scintillent), vacille, et le vent la couche.
    const pace = mood === 'panique' ? 2.2 : mood === 'stress' ? 1.6 : mood === 'euphorie' ? 1.4 : 1;
    flameSpin.rotation.y += dt * 0.9 * pace;
    flameSpin.scale.set(
      1 - Math.sin(t * 9 * pace) * 0.04,
      1 + Math.sin(t * 9 * pace) * 0.07 + Math.sin(t * 23 * pace) * 0.04,
      1 - Math.sin(t * 9 * pace) * 0.04,
    );
    flameBend.rotation.z = damp(flameBend.rotation.z, windy ? 0.55 + Math.sin(t * 3) * 0.12 : Math.sin(t * 1.7) * 0.06, 4, dt);
    flameOuter.material.color.copy(colors.outer).multiplyScalar(flameOuter.material.userData.boost);
    flameCore.material.color.copy(colors.core).multiplyScalar(flameCore.material.userData.boost);
    glow.material.color.copy(colors.outer);
    mats.ring.color.copy(lit ? colors.outer : new THREE.Color(0x3a3350));
    floorGlow.material.color.copy(colors.outer);
    floorGlow.material.opacity = damp(floorGlow.material.opacity, lit ? 0.22 : 0.04, 3, dt);
    mats.wax.emissive.copy(colors.outer);
    mats.wax.emissiveIntensity = lit ? 0.05 + flare * 0.1 : 0;
    mats.waxTop.emissive.copy(colors.outer);
    mats.waxTop.emissiveIntensity = lit ? 0.12 + flare * 0.15 : 0;

    flameGroup.getWorldPosition(tmp);
    flameLight.position.set(tmp.x, tmp.y + 0.35 * fscale, tmp.z + 0.25);
    flameLight.color.copy(colors.light);
    const flick = 1 + Math.sin(t * 13) * 0.06 + Math.sin(t * 29) * 0.04;
    flameLight.intensity = damp(flameLight.intensity, lit ? 7 * flick * (1 + flare) * Math.min(1.3, fscale) : 0, 5, dt);
    hemi.intensity = damp(hemi.intensity, lit ? 0.55 : 0.95, 2, dt);

    // Quand le chart monte, elle grandit plus vite : des étincelles montent autour d'elle.
    if (lit && (mood === 'euphorie' || mood === 'content')) {
      sparkleT -= dt;
      if (sparkleT <= 0) {
        sparkleT = mood === 'euphorie' ? 0.12 : 0.3;
        const a = Math.random() * Math.PI * 2;
        const h = (built ? built.top : 2) * Math.random();
        emit(1, new THREE.Vector3(Math.cos(a) * 0.75, h, Math.sin(a) * 0.75), { speed: 0.2, up: 1.1, color: colors.outer.getHex(), life: 1.3 });
      }
    }

    // Cloche.
    const wantDome = props.shielded && lit;
    domeT = damp(domeT, wantDome ? 1 : 0, 4, dt);
    dome.visible = domeT > 0.01;
    dome.position.y = (1 - domeT) * 1.5;
    mats.glass.opacity = 0.1 * domeT;

    // Braises ambiantes.
    const ep = embers.geometry.attributes.position;
    const seeds = embers.userData.seeds;
    for (let i = 0; i < seeds.length; i++) {
      let y = ep.getY(i) + dt * (0.18 + seeds[i] * 0.35) * (lit ? 1 : 0.4);
      if (y > 4.2) y = -0.2;
      ep.setY(i, y);
      ep.setX(i, ep.getX(i) + Math.sin(t * 0.8 + seeds[i] * 20) * dt * 0.05 + (windy ? -dt * 0.6 : 0));
      if (ep.getX(i) < -4.5) ep.setX(i, 4.5);
    }
    ep.needsUpdate = true;
    embers.material.color.copy(lit ? colors.outer : new THREE.Color(0x6a6480));
    embers.material.opacity = lit ? 0.85 : 0.35;

    // Étincelles.
    const parts = burst.userData.parts;
    const bp = burst.geometry.attributes.position;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age > p.life) { parts.splice(i, 1); continue; }
      p.v.y -= 3.2 * dt;
      p.p.addScaledVector(p.v, dt);
    }
    for (let i = 0; i < burst.userData.max; i++) {
      const p = parts[i];
      if (p) bp.setXYZ(i, p.p.x, p.p.y, p.p.z); else bp.setXYZ(i, 0, -100, 0);
    }
    bp.needsUpdate = true;

    // Fumée quand elle est éteinte, « z » quand l'allumette dort.
    const dead = !lit && props.stage !== 'allumette';
    const top = built ? built.top : 2;
    smoke.forEach((sp) => {
      const k = (t * 0.25 + sp.userData.phase) % 1;
      sp.visible = dead;
      sp.position.set(Math.sin(k * 6 + sp.userData.phase * 10) * 0.12 * k, top + k * 1.6, 0);
      sp.scale.setScalar(0.25 + k * 0.7);
      sp.material.opacity = dead ? Math.sin(k * Math.PI) * 0.35 : 0;
    });
    const sleeping = !lit && props.stage === 'allumette';
    zzz.forEach((sp, i) => {
      const k = (t * 0.22 + sp.userData.phase) % 1;
      sp.visible = sleeping;
      const s = 0.18 + k * 0.22 + i * 0.03;
      sp.scale.set(s * sp.userData.aspect * 0.6, s, 1);
      sp.position.set(0.45 + k * 0.5, top - 0.2 + k * 1.1, 0.2);
      sp.material.opacity = Math.sin(k * Math.PI);
    });

    // Flammèches en orbite.
    for (const f of flammeches) {
      const u = f.userData;
      const a = u.phase + t * u.speed;
      const r = u.radius + Math.sin(t * 0.5 + u.phase) * 0.08;
      f.position.set(Math.cos(a) * r, u.height + Math.sin(t * 1.3 + u.phase) * 0.12, Math.sin(a) * r * 0.8);
      u.fl.rotation.y += dt * 1.2;
      u.fl.scale.y = u.fl.scale.x * (1 + Math.sin(t * 8 + u.phase) * 0.08);
    }

    // Caméra : cadre tout WICK (de la base au bout de la flamme) + léger parallaxe.
    // (on laisse de la place en bas pour les boutons, et sur un écran étroit
    // on recule assez pour voir tout le socle en largeur)
    const topY = Math.max((built ? built.top : 2) + (lit ? 1.05 * fscale : 0.5), domeT > 0.3 ? 3.65 : 0);
    // Hauteur visible : WICK prend ~68 % de l'image, avec ~14 % en bas pour les
    // boutons et ~18 % en haut pour la bulle.
    const needH = (topY + 0.5) / 0.68;
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    const distH = needH / (2 * tanHalf);
    const distW = (camera.aspect < 0.8 ? 3.6 : 3.3) / (2 * tanHalf * camera.aspect);
    const dist = Math.min(13, Math.max(5.2, distH, distW));
    const lookY = -0.5 + needH * 0.36;
    if (!framed && built) {
      camDist = dist;
      lookAt.y = lookY;
      framed = true;
    }
    camDist = damp(camDist, dist, 2, dt);
    lookAt.y = damp(lookAt.y, lookY, 2, dt);
    camera.position.set(pointerSmooth.x * 0.35, lookAt.y + 0.45 + pointerSmooth.y * 0.2, camDist);
    camera.lookAt(lookAt);

    composer.render(dt);
    if (onFrameCb) onFrameCb();
  }
  let onFrameCb = null;
  raf = requestAnimationFrame(frame);

  // Position à l'écran du haut de WICK (pour accrocher la bulle).
  function anchor() {
    const p = new THREE.Vector3();
    if (props.lit) {
      flameGroup.getWorldPosition(p);
      p.y += 0.95 * flameGroup.scale.y;
    } else {
      p.set(0, (built ? built.top : 2) + 0.35, 0);
      root.localToWorld(p);
    }
    p.project(camera);
    return { x: (p.x * 0.5 + 0.5) * container.clientWidth, y: (-p.y * 0.5 + 0.5) * container.clientHeight };
  }

  update({});

  // Une photo carrée de la bougie, telle qu'elle est à cet instant (pour la carte à partager).
  // La bougie occupe le haut de l'image : le bas est laissé libre pour le texte de la carte.
  function capture(size = 1080) {
    const pr = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    composer.setPixelRatio?.(1);
    composer.setSize(size, size);
    bloom.resolution.set(size / 2, size / 2);
    camera.aspect = 1;
    camera.fov = 30;
    camera.updateProjectionMatrix();
    const topY = (built ? built.top : 2) + (props.lit ? 1.05 * flameGroup.scale.x : 0.5);
    const H = (topY + 0.5) / 0.62;
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    const look = new THREE.Vector3(0, -0.5 + H * 0.2, 0);
    camera.position.set(0, look.y + 0.45, Math.max(5.2, H / (2 * tanHalf)));
    camera.lookAt(look);
    composer.render(0);
    const url = renderer.domElement.toDataURL('image/png');
    renderer.setPixelRatio(pr);
    composer.setPixelRatio?.(pr);
    resize();
    return url;
  }

  return {
    capture,
    update,
    react,
    anchor,
    setFlammeches,
    onFrame(cb) { onFrameCb = cb; },
    setActive(v) { running = v; if (v) clock.getDelta(); },
    // Vrai si le navigateur a repris la carte graphique et ne l'a pas encore rendue.
    isLost() { return renderer.getContext().isContextLost(); },
    refresh() { resize(); },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
