// Le dessin de WICK, en SVG. Une fonction pure : même état → même dessin.
// La flamme, les couleurs et les tremblements sont pilotés par le CSS (style.css).

const W = 240;
const H = 340;
const CX = W / 2;
const GROUND = 318;

// Hauteur du corps : la bougie rapetisse vraiment quand la cire fond.
function bodyHeight(min, max, wax) {
  const t = Math.max(0, Math.min(1, wax / 100));
  return Math.round(min + (max - min) * t);
}

function face(cx, cy, mood, lit, stage) {
  if (!lit && stage !== 'allumette') {
    // Éteinte : yeux en croix, bouche triste.
    const x = (dx) => `<path class="eye-x" d="M${cx + dx - 6} ${cy - 6} l12 12 M${cx + dx + 6} ${cy - 6} l-12 12"/>`;
    return `${x(-15)}${x(15)}<path class="mouth" d="M${cx - 8} ${cy + 20} q8 -7 16 0"/>`;
  }
  if (!lit) {
    // Allumette pas encore née : elle dort en souriant.
    return `<path class="lid" d="M${cx - 21} ${cy} q6 5 12 0 M${cx + 9} ${cy} q6 5 12 0"/>
      <path class="mouth" d="M${cx - 6} ${cy + 14} q6 5 12 0"/>`;
  }
  const eyes = {
    euphorie: `<path class="lid thick" d="M${cx - 22} ${cy + 3} q7 -11 14 0 M${cx + 8} ${cy + 3} q7 -11 14 0"/>`,
    content: `<g class="blink"><ellipse class="eye" cx="${cx - 15}" cy="${cy}" rx="5.5" ry="7"/><ellipse class="eye" cx="${cx + 15}" cy="${cy}" rx="5.5" ry="7"/>
      <circle class="shine" cx="${cx - 13}" cy="${cy - 3}" r="2"/><circle class="shine" cx="${cx + 17}" cy="${cy - 3}" r="2"/></g>`,
    calme: `<g class="blink"><ellipse class="eye" cx="${cx - 15}" cy="${cy + 2}" rx="5.5" ry="5"/><ellipse class="eye" cx="${cx + 15}" cy="${cy + 2}" rx="5.5" ry="5"/></g>
      <path class="lid thick" d="M${cx - 23} ${cy - 1} h16 M${cx + 7} ${cy - 1} h16"/>`,
    stress: `<g class="blink"><circle class="eye-white" cx="${cx - 15}" cy="${cy}" r="8"/><circle class="eye-white" cx="${cx + 15}" cy="${cy}" r="8"/>
      <circle class="eye" cx="${cx - 14}" cy="${cy + 1}" r="3.2"/><circle class="eye" cx="${cx + 16}" cy="${cy + 1}" r="3.2"/></g>
      <path class="brow" d="M${cx - 23} ${cy - 13} l12 -4 M${cx + 23} ${cy - 13} l-12 -4"/>`,
    panique: `<circle class="eye-white" cx="${cx - 15}" cy="${cy}" r="10"/><circle class="eye-white" cx="${cx + 15}" cy="${cy}" r="10"/>
      <circle class="eye" cx="${cx - 15}" cy="${cy}" r="2.6"/><circle class="eye" cx="${cx + 15}" cy="${cy}" r="2.6"/>
      <path class="brow" d="M${cx - 25} ${cy - 16} l12 5 M${cx + 25} ${cy - 16} l-12 5"/>`,
  };
  const mouths = {
    euphorie: `<path class="mouth-open" d="M${cx - 14} ${cy + 14} q14 20 28 0 z"/>`,
    content: `<path class="mouth" d="M${cx - 10} ${cy + 15} q10 9 20 0"/>`,
    calme: `<path class="mouth" d="M${cx - 8} ${cy + 18} h16"/>`,
    stress: `<path class="mouth" d="M${cx - 12} ${cy + 19} q3 -4 6 0 t6 0 t6 0 t6 0"/>`,
    panique: `<ellipse class="mouth-open" cx="${cx}" cy="${cy + 22}" rx="7" ry="9"/>`,
  };
  const sweat = mood === 'stress' || mood === 'panique'
    ? `<path class="sweat" d="M${cx + 30} ${cy - 14} q5 8 0 11 q-5 -3 0 -11z"/>` : '';
  const cheeks = mood === 'euphorie' || mood === 'content'
    ? `<ellipse class="cheek" cx="${cx - 25}" cy="${cy + 11}" rx="6" ry="3.5"/><ellipse class="cheek" cx="${cx + 25}" cy="${cy + 11}" rx="6" ry="3.5"/>` : '';
  return (eyes[mood] || eyes.calme) + (mouths[mood] || mouths.calme) + sweat + cheeks;
}

function flame(x, y, scale, lit) {
  if (!lit) return '';
  // Le point d'ancrage est le haut de la mèche ; la flamme grandit vers le haut.
  return `<g class="flame-anchor" transform="translate(${x} ${y})"><g class="wind">
    <g class="flame" style="--flame-scale:${scale}">
      <path class="flame-outer" d="M0 0 C-22 -6 -24 -34 -8 -58 C-2 -68 0 -80 2 -92 C10 -74 26 -54 24 -30 C23 -10 14 -1 0 0 Z"/>
      <path class="flame-inner" d="M0 -2 C-11 -5 -12 -22 -3 -36 C0 -42 2 -50 3 -56 C8 -44 14 -32 12 -18 C11 -7 7 -2 0 -2 Z"/>
    </g>
  </g></g>`;
}

function smoke(x, y, show) {
  if (!show) return '';
  return `<g class="smoke" transform="translate(${x} ${y})">
    <path d="M0 0 q-8 -12 0 -24 t0 -24"/><path class="s2" d="M4 -4 q8 -12 0 -24 t0 -24"/>
  </g>`;
}

function wickLine(x, y) {
  return `<path class="wick-line" d="M${x} ${y} q-2 -8 1 -14"/>`;
}

const bodies = {
  allumette({ wax, mood, lit }) {
    const top = 120;
    const faceY = 176;
    return {
      top: { x: CX, y: top - 24 },
      svg: `<rect class="stick" x="${CX - 11}" y="${top}" width="22" height="${GROUND - top}" rx="6"/>
        <rect class="stick-grain" x="${CX - 3}" y="${top + 60}" width="3" height="${GROUND - top - 80}" rx="1.5"/>
        <path class="match-head" d="M${CX - 20} ${top + 8} C${CX - 22} ${top - 30} ${CX + 22} ${top - 30} ${CX + 20} ${top + 8} C${CX + 16} ${top + 22} ${CX - 16} ${top + 22} ${CX - 20} ${top + 8} Z"/>
        <g class="face-wrap"><rect class="face-plate" x="${CX - 38}" y="${faceY - 22}" width="76" height="54" rx="22"/>${face(CX, faceY, mood, lit, 'allumette')}</g>`,
      flameScale: 0.9,
    };
  },
  bougie({ wax, mood, lit }) {
    const h = bodyHeight(70, 170, wax);
    const top = GROUND - h;
    return {
      top: { x: CX, y: top - 14 },
      svg: `<rect class="wax" x="${CX - 48}" y="${top}" width="96" height="${h}" rx="18"/>
        <path class="wax-top" d="M${CX - 48} ${top + 16} C${CX - 48} ${top - 4} ${CX + 48} ${top - 4} ${CX + 48} ${top + 16} L${CX + 48} ${top + 22} C${CX + 34} ${top + 22} ${CX + 36} ${top + 46} ${CX + 26} ${top + 46} C${CX + 16} ${top + 46} ${CX + 20} ${top + 24} ${CX + 6} ${top + 24} C${CX - 10} ${top + 24} ${CX - 14} ${top + 36} ${CX - 24} ${top + 36} C${CX - 34} ${top + 36} ${CX - 32} ${top + 22} ${CX - 48} ${top + 22} Z"/>
        ${wickLine(CX, top + 2)}
        <g class="face-wrap">${face(CX, top + Math.min(70, h * 0.55), mood, lit, 'bougie')}</g>`,
      flameScale: 1,
    };
  },
  chandelle({ wax, mood, lit }) {
    const h = bodyHeight(80, 185, wax);
    const top = GROUND - 14 - h;
    return {
      top: { x: CX, y: top - 14 },
      svg: `<ellipse class="dish" cx="${CX}" cy="${GROUND - 6}" rx="70" ry="12"/>
        <rect class="wax" x="${CX - 36}" y="${top}" width="72" height="${h}" rx="14"/>
        <path class="wax-top" d="M${CX - 36} ${top + 12} C${CX - 36} ${top - 4} ${CX + 36} ${top - 4} ${CX + 36} ${top + 12} L${CX + 36} ${top + 18} C${CX + 26} ${top + 18} ${CX + 28} ${top + 52} ${CX + 18} ${top + 52} C${CX + 8} ${top + 52} ${CX + 12} ${top + 20} ${CX} ${top + 20} C${CX - 14} ${top + 20} ${CX - 18} ${top + 30} ${CX - 26} ${top + 30} C${CX - 34} ${top + 30} ${CX - 30} ${top + 18} ${CX - 36} ${top + 18} Z"/>
        ${wickLine(CX, top + 2)}
        <g class="face-wrap">${face(CX, top + Math.min(76, h * 0.5), mood, lit, 'chandelle')}</g>`,
      flameScale: 1.1,
    };
  },
  chandelier({ wax, mood, lit }) {
    const h = bodyHeight(80, 160, wax);
    const base = GROUND - 44;
    const top = base - h;
    return {
      top: { x: CX, y: top - 14 },
      svg: `<path class="brass" d="M${CX - 62} ${GROUND} h124 l-20 -18 h-84 z"/>
        <rect class="brass" x="${CX - 9}" y="${base + 4}" width="18" height="${GROUND - base - 20}"/>
        <path class="brass" d="M${CX + 60} ${GROUND - 12} c34 -4 34 -44 4 -44" fill="none" stroke-width="9"/>
        <ellipse class="brass" cx="${CX}" cy="${base + 4}" rx="56" ry="11"/>
        <rect class="wax" x="${CX - 38}" y="${top}" width="76" height="${h}" rx="14"/>
        <path class="wax-top" d="M${CX - 38} ${top + 12} C${CX - 38} ${top - 4} ${CX + 38} ${top - 4} ${CX + 38} ${top + 12} L${CX + 38} ${top + 18} C${CX + 26} ${top + 18} ${CX + 28} ${top + 44} ${CX + 18} ${top + 44} C${CX + 8} ${top + 44} ${CX + 12} ${top + 20} ${CX} ${top + 20} C${CX - 16} ${top + 20} ${CX - 22} ${top + 34} ${CX - 30} ${top + 34} C${CX - 38} ${top + 34} ${CX - 34} ${top + 18} ${CX - 38} ${top + 18} Z"/>
        ${wickLine(CX, top + 2)}
        <g class="face-wrap">${face(CX, top + Math.min(66, h * 0.55), mood, lit, 'chandelier')}</g>`,
      flameScale: 1.2,
    };
  },
  torche({ wax, mood, lit }) {
    const top = 118;
    return {
      top: { x: CX, y: top - 4 },
      svg: `<path class="handle" d="M${CX - 16} ${top + 60} L${CX - 9} ${GROUND} h18 L${CX + 16} ${top + 60} z"/>
        <path class="wrap" d="M${CX - 40} ${top} h80 l-10 64 h-60 z"/>
        <path class="wrap-band" d="M${CX - 39} ${top + 6} h78 M${CX - 32} ${top + 57} h64"/>
        <g class="face-wrap">${face(CX, top + 28, mood, lit, 'torche')}</g>`,
      flameScale: 1.4,
    };
  },
};

export function renderWick({ stage, lit, wax, mood, shielded }) {
  const draw = (bodies[stage] || bodies.bougie)({ wax, mood, lit });
  // La flamme grandit avec la cire (entre 60 % et 115 % de sa taille).
  const scale = draw.flameScale * (0.6 + 0.55 * Math.min(1, wax / 100));
  const dome = shielded
    ? `<path class="dome" d="M${CX - 92} ${GROUND + 4} V${140} C${CX - 92} ${40} ${CX + 92} ${40} ${CX + 92} ${140} V${GROUND + 4}"/>
       <path class="dome-shine" d="M${CX - 70} ${250} V${150} C${CX - 70} ${110} ${CX - 50} ${86} ${CX - 30} ${78}"/>` : '';
  return `<svg class="wick-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="WICK">
    <ellipse class="shadow" cx="${CX}" cy="${GROUND + 6}" rx="74" ry="9"/>
    <g class="body">${draw.svg}</g>
    ${flame(draw.top.x, draw.top.y, scale.toFixed(3), lit)}
    ${smoke(draw.top.x, draw.top.y, !lit && stage !== 'allumette')}
    <g class="sparks" transform="translate(${draw.top.x} ${draw.top.y})"></g>
    ${dome}
  </svg>`;
}
