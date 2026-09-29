// Le fond du site : des braises qui montent lentement, comme au-dessus d'un feu.
// Trois profondeurs (loin, milieu, près), un scintillement, une légère dérive, et
// elles s'écartent un peu du pointeur. Dessiné en 2D, à 30 images/s au plus, et
// en pause quand l'onglet est caché ou que le visiteur préfère moins d'animations.

// Une petite lueur pré-dessinée par couleur : cœur presque blanc, halo coloré.
function glowSprite(color, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255, 250, 235, 1)');
  grad.addColorStop(0.12, color);
  grad.addColorStop(0.4, `${color}55`);
  grad.addColorStop(1, `${color}00`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export function startEmbers(canvas) {
  if (!canvas?.getContext) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const g = canvas.getContext('2d');
  const sprites = ['#ffb347', '#ff8a1e', '#ffd27a', '#ff5a1f'].map((c) => glowSprite(c));
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  let w = 0;
  let h = 0;
  let parts = [];
  const pointer = { x: -9999, y: -9999 };

  function spawn(p, anywhere) {
    const depth = Math.random() ** 1.6; // beaucoup de braises lointaines, peu de proches
    p.depth = depth;
    p.x = Math.random() * w;
    p.y = anywhere ? Math.random() * h : h + 20 + Math.random() * 80;
    p.size = (1.2 + depth * 5.5) * (0.7 + Math.random() * 0.6);
    p.vy = 9 + depth * 38 + Math.random() * 10;
    p.sway = 6 + Math.random() * 22;
    p.freq = 0.3 + Math.random() * 0.7;
    p.phase = Math.random() * Math.PI * 2;
    p.alpha = 0.25 + depth * 0.65;
    p.sprite = sprites[Math.floor(Math.random() * sprites.length)];
    p.twinkle = 2 + Math.random() * 5;
    p.push = 0;
    return p;
  }

  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(90, Math.max(28, (w * h) / 16000)));
    while (parts.length < n) parts.push(spawn({}, true));
    parts.length = n;
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });

  let last = performance.now();
  let acc = 0;
  let t = 0;
  function draw(dt) {
    t += dt;
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      p.y -= p.vy * dt;
      // Elles s'écartent doucement du pointeur, puis reprennent leur route.
      const dx = p.x - pointer.x;
      const dy = p.y - pointer.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 140 * 140) p.push += (dx >= 0 ? 1 : -1) * (1 - Math.sqrt(d2) / 140) * 60 * dt;
      p.push *= 0.96;
      p.x += p.push * dt * 4;
      const x = p.x + Math.sin(t * p.freq + p.phase) * p.sway;
      // Elles s'éteignent en montant (plus haut, plus faible).
      const fade = Math.min(1, Math.max(0, p.y / h) * 1.6);
      const flick = 0.72 + 0.28 * Math.sin(t * p.twinkle + p.phase);
      const a = p.alpha * fade * flick;
      if (a > 0.01) {
        g.globalAlpha = a;
        const s = p.size * 4;
        g.drawImage(p.sprite, x - s / 2, p.y - s / 2, s, s);
      }
      if (p.y < -30 || p.x < -60 || p.x > w + 60) spawn(p, false);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  if (reduce) { draw(0); return; }
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) { last = now; return; }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    if (acc < 1 / 30) return;
    draw(acc);
    acc = 0;
  }
  requestAnimationFrame(frame);
}
