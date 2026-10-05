// Quand l'IA ne répond pas (quota du jour, panne, limite) : un brouillon fait ici, à partir de
// l'idée, pour que créer un coin donne toujours quelque chose. Le créateur le modifie librement,
// ou relance Spark plus tard. La démo s'en sert aussi.
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const SUFFIX = ['Flame', 'Candle', 'Ember', 'Spark', 'Wick'];

// L'idée → { name, symbol, description, visual }.
export function draftCoin(idea) {
  const text = String(idea || '').trim();
  const words = text.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => w.length > 2);
  const main = (words.sort((a, b) => b.length - a.length)[0] || 'Ember').toLowerCase();
  const cap = main[0].toUpperCase() + main.slice(1);
  const name = `${cap} ${pick(SUFFIX)}`.slice(0, 24);
  const symbol = (main.slice(0, 4) + pick(['', 'Y', 'O', 'Z'])).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'SPARK';
  return {
    name, symbol,
    description: `${name} started as one idea: ${text.slice(0, 90)}. Now it is a candle, and its Operator never lets it go out.`,
    visual: text,
  };
}

// Un logo dessiné ici (une créature et sa flamme, aux couleurs tirées du texte). → Blob PNG.
export function drawLogo(seedText) {
  let h = 0;
  for (const ch of String(seedText || 'wick')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const bg = g.createRadialGradient(256, 300, 40, 256, 256, 360);
  bg.addColorStop(0, `hsl(${(hue + 30) % 360} 70% 22%)`);
  bg.addColorStop(1, '#0b0705');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 512);
  g.fillStyle = `hsl(${hue} 80% 58%)`;
  g.beginPath(); g.ellipse(256, 320, 150, 135, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff';
  for (const x of [205, 307]) { g.beginPath(); g.arc(x, 300, 30, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#140b05';
  for (const x of [212, 300]) { g.beginPath(); g.arc(x, 306, 14, 0, Math.PI * 2); g.fill(); }
  const fl = g.createLinearGradient(0, 60, 0, 200);
  fl.addColorStop(0, '#fff6c8'); fl.addColorStop(1, '#ff8a1c');
  g.fillStyle = fl;
  g.beginPath(); g.moveTo(256, 50); g.bezierCurveTo(320, 120, 300, 190, 256, 200); g.bezierCurveTo(212, 190, 192, 120, 256, 50); g.fill();
  return new Promise((r) => c.toBlob(r, 'image/png'));
}
