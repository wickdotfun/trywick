// La carte à partager : une image 1080 × 1350 de TA bougie telle qu'elle est
// maintenant (photo 3D), avec son nom, son âge, sa forme, sa rareté et son look.
const W = 1080;
const H = 1350;

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Une pastille de texte ; renvoie sa largeur.
function pill(g, x, y, text, { fill, stroke, color, font = '500 26px "Geist Mono", monospace', padX = 18, h = 48 }) {
  g.font = font;
  const w = g.measureText(text).width + padX * 2;
  roundRect(g, x, y, w, h, 10);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); }
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, x + padX, y + h / 2 + 1);
  return w;
}

// info : { name, id, statusLabel, alive, badge (Hall of Fame…), flameColor,
//          traits: [texte…], statusLabel, site, tagline }
export async function makeCard(photo, info) {
  await Promise.all([
    document.fonts?.load('600 72px Geist'),
    document.fonts?.load('500 26px "Geist Mono"'),
  ].filter(Boolean)).catch(() => {});
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  // Fond : presque noir, une lueur de la couleur de sa flamme, une grille fine.
  g.fillStyle = '#0b0705';
  g.fillRect(0, 0, W, H);
  const img = await loadImage(photo);
  if (!info.alive) g.filter = 'grayscale(0.85) brightness(0.8)';
  g.drawImage(img, 0, 0, W, W);
  g.filter = 'none';
  const glow = g.createRadialGradient(W / 2, 360, 20, W / 2, 360, 620);
  glow.addColorStop(0, `${info.flameColor}22`);
  glow.addColorStop(1, 'transparent');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  // Le bas de la photo se fond dans le fond, pour le texte.
  const fade = g.createLinearGradient(0, 700, 0, 1080);
  fade.addColorStop(0, 'rgba(11,7,5,0)');
  fade.addColorStop(1, 'rgba(11,7,5,1)');
  g.fillStyle = fade;
  g.fillRect(0, 700, W, 380);
  g.fillStyle = '#0b0705';
  g.fillRect(0, 1080, W, H - 1080);
  g.strokeStyle = 'rgba(255,255,255,0.035)';
  g.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) { g.beginPath(); g.moveTo(x + 0.5, 1040); g.lineTo(x + 0.5, H); g.stroke(); }
  for (let y = 1040; y <= H; y += 60) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }

  // En haut : le logo et le wordmark WICK, puis le numéro.
  const [mark, word] = await Promise.all([loadImage('brand/logo.png'), loadImage('brand/wordmark.png')]).catch(() => []);
  if (mark) g.drawImage(mark, 34, 20, 108, 108);
  if (word) g.drawImage(word, 138, 56, 34 * (word.width / word.height), 34);
  g.textBaseline = 'middle';
  g.font = '500 26px "Geist Mono", monospace';
  g.fillStyle = '#9a98a3';
  const idText = `#${info.id}`;
  g.fillText(idText, W - 56 - g.measureText(idText).width, 74);
  if (info.badge) pill(g, 56, 132, info.badge.toUpperCase(), { fill: '#ffd23f22', stroke: '#ffd23f88', color: '#ffd23f' });

  // Le nom, puis la forme et l'âge.
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#f4f2ef';
  let size = 76;
  do { g.font = `600 ${size}px Geist, sans-serif`; size -= 4; } while (g.measureText(info.name).width > W - 112 && size > 40);
  g.fillText(info.name, 56, 1000);
  g.font = '500 30px "Geist Mono", monospace';
  g.fillStyle = info.alive ? info.flameColor : '#9a98a3';
  g.fillText(info.statusLabel, 56, 1052);

  // Le look, en pastilles.
  let x = 56;
  let y = 1100;
  for (const t of info.traits) {
    g.font = '500 24px "Geist Mono", monospace';
    const w = g.measureText(t).width + 32;
    if (x + w > W - 56) { x = 56; y += 58; }
    pill(g, x, y, t, { fill: 'rgba(255,255,255,0.05)', stroke: 'rgba(255,255,255,0.14)', color: '#d8d6de', font: '500 24px "Geist Mono", monospace', padX: 16, h: 46 });
    x += w + 10;
  }

  // Le pied : l'adresse du site et l'appel.
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.fillRect(56, H - 96, W - 112, 1);
  g.font = '500 26px "Geist Mono", monospace';
  g.textBaseline = 'middle';
  g.fillStyle = '#f4f2ef';
  g.fillText(info.site, 56, H - 52);
  g.fillStyle = '#9a98a3';
  const tag = info.tagline;
  g.fillText(tag, W - 56 - g.measureText(tag).width, H - 52);
  return c;
}
