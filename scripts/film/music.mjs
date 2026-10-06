// Une petite musique d'ambiance pour le film (47 s) : des nappes chaudes, une basse douce, un
// arpège léger, un battement feutré, une montée et un impact à la fin. Tout est synthétisé ici.
import { writeFileSync } from 'node:fs';
const SR = 44100, DUR = 47, N = Math.floor(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);
const BPM = 96, BEAT = 60 / BPM, BAR = BEAT * 4;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
// Am – F – C – G (en notes MIDI), une mesure chacun.
const CH = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]];
const chordAt = (t) => CH[Math.floor(t / BAR) % 4];
const env = (t, a, d) => (t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d));
const add = (i, l, r) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };

// 1. Les nappes : chaque accord, des ondes douces désaccordées, attaque lente.
for (let bar = 0; bar * BAR < DUR; bar++) {
  const t0 = bar * BAR, notes = CH[bar % 4];
  for (const m of notes) for (const det of [-0.08, 0, 0.07]) {
    const f = hz(m) * 2 ** (det / 12), ph = Math.random() * 6.28;
    for (let i = Math.floor(t0 * SR); i < Math.min(N, Math.floor((t0 + BAR + 1.6) * SR)); i++) {
      const t = i / SR - t0;
      const a = Math.min(1, t / 0.9) * (t > BAR ? Math.exp(-(t - BAR) / 0.5) : 1);
      const x = Math.sin(2 * Math.PI * f * (i / SR) + ph), x2 = Math.sin(4 * Math.PI * f * (i / SR) + ph) * 0.25;
      const v = (x + x2) * a * 0.012;
      add(i, v * (det < 0 ? 1.15 : 0.85), v * (det > 0 ? 1.15 : 0.85));
    }
  }
}
// 2. L'intro scintillante (0–4,5 s).
for (let i = 0; i < 4.8 * SR; i++) {
  const t = i / SR, a = Math.min(1, t / 1.5) * Math.min(1, (4.8 - t) / 1.2);
  const v = (Math.sin(2 * Math.PI * 1318.5 * t) + Math.sin(2 * Math.PI * 1760 * t) * 0.6) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 5 * t)) * a * 0.006;
  add(i, v, v * 0.8);
}
// 3. La basse (à partir de 4,2 s), la fondamentale une octave en dessous.
for (let i = Math.floor(4.2 * SR); i < Math.floor(46 * SR); i++) {
  const t = i / SR, m = chordAt(t)[0] - 12, tb = (t % BAR);
  const v = Math.sin(2 * Math.PI * hz(m) * t) * env(tb, 0.05, 1.6) * 0.07;
  add(i, v, v);
}
// 4. Le battement feutré (8,4–37,4 s) et un léger charleston (15–33,6 s).
for (let k = 0; k * BEAT < DUR; k++) {
  const t0 = k * BEAT;
  if (t0 >= 8.4 && t0 < 37.4) {
    for (let j = 0; j < 0.35 * SR; j++) {
      const t = j / SR, f = 50 + 70 * Math.exp(-t * 30);
      const v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 9) * 0.16;
      add(Math.floor(t0 * SR) + j, v, v);
    }
  }
  const th = t0 + BEAT / 2;
  if (th >= 15 && th < 33.6) {
    for (let j = 0; j < 0.06 * SR; j++) {
      const v = (Math.random() * 2 - 1) * Math.exp(-j / SR * 70) * 0.012;
      add(Math.floor(th * SR) + j, v * 0.7, v);
    }
  }
}
// 5. L'arpège (8,4–37,4 s) : les notes de l'accord, en croches, une octave au-dessus.
for (let k = 0; k * BEAT / 2 < DUR; k++) {
  const t0 = k * BEAT / 2;
  if (t0 < 8.4 || t0 >= 37.4) continue;
  const notes = chordAt(t0), m = notes[[0, 2, 1, 3, 2, 1, 3, 2][k % 8]] + 12, f = hz(m);
  const pan = k % 2 ? 0.7 : 1;
  for (let j = 0; j < 0.9 * SR; j++) {
    const t = j / SR;
    const v = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-t * 5) * 0.03;
    add(Math.floor(t0 * SR) + j, v * pan, v * (1.7 - pan));
  }
}
// 6. La montée (37,6–40,6 s) puis l'impact (40,6 s) sur la fin.
let lp = 0;
for (let i = Math.floor(37.6 * SR); i < Math.floor(40.6 * SR); i++) {
  const t = i / SR - 37.6, a = (t / 3) ** 2;
  lp += (Math.random() * 2 - 1 - lp) * (0.02 + 0.3 * a);
  const v = lp * a * 0.09 + Math.sin(2 * Math.PI * (200 + 600 * a) * t) * a * 0.012;
  add(i, v, v);
}
for (let j = 0; j < 3 * SR; j++) {
  const t = j / SR, f = 40 + 60 * Math.exp(-t * 12);
  const v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 2.2) * 0.13 + (Math.random() * 2 - 1) * Math.exp(-t * 14) * 0.05;
  add(Math.floor(40.6 * SR) + j, v, v);
}
// 7. Un souffle doux à chaque changement de scène.
for (const c of [8.4, 15.2, 23.2, 28.4, 33.6]) {
  let lp2 = 0;
  for (let j = 0; j < 1.2 * SR; j++) {
    const t = j / SR - 0.6, a = Math.exp(-(t * t) / 0.06);
    lp2 += (Math.random() * 2 - 1 - lp2) * 0.08;
    add(Math.floor((c - 0.6) * SR) + j, lp2 * a * 0.05, lp2 * a * 0.04);
  }
}

// La réverbération (quatre peignes, deux passe-tout) : de l'espace, rien de sec.
function reverb(x) {
  const out = new Float32Array(x.length);
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ b: new Float32Array(d), i: 0, f: 0.8 }));
  const aps = [225, 556].map((d) => ({ b: new Float32Array(d), i: 0 }));
  for (let n = 0; n < x.length; n++) {
    let s = 0;
    for (const c of combs) { const y = c.b[c.i]; c.b[c.i] = x[n] + y * c.f; c.i = (c.i + 1) % c.b.length; s += y; }
    s *= 0.25;
    for (const a of aps) { const y = a.b[a.i]; const v = -s + y; a.b[a.i] = s + y * 0.5; a.i = (a.i + 1) % a.b.length; s = v; }
    out[n] = s;
  }
  return out;
}
const rl = reverb(L), rr = reverb(R);
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR, fade = Math.min(1, t / 1.2) * Math.min(1, (DUR - t) / 2.2);
  L[i] = (L[i] * 0.75 + rl[i] * 0.45) * fade; R[i] = (R[i] * 0.75 + rr[i] * 0.45) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
// Pas trop forte : le pic à -6 dB, adouci.
const g = 0.5 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const s = (v) => Math.max(-32767, Math.min(32767, Math.round(Math.tanh(v * g * 1.2) * 30000)));
  buf.writeInt16LE(s(L[i]), 44 + i * 4); buf.writeInt16LE(s(R[i]), 46 + i * 4);
}
writeFileSync(new URL('./music.wav', import.meta.url), buf);
console.log('music.wav', (buf.length / 1e6).toFixed(1), 'MB, peak gain', g.toFixed(2));
