// Le rendu du film : film.html image par image (30 i/s), la musique (music.mjs), puis ffmpeg.
//   node scripts/film/music.mjs && node scripts/film/render.mjs
// → public/cards/wick-intro.mp4 et son image public/cards/post-intro.png.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';

const FPS = 30, DUR = 47, N = Math.round(FPS * DUR);
const dir = fileURLToPath(new URL('.', import.meta.url));
const frames = `${dir}frames`, cards = fileURLToPath(new URL('../../public/cards/', import.meta.url));
rmSync(frames, { recursive: true, force: true }); mkdirSync(frames);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--allow-file-access-from-files'] }).catch(() => chromium.launch());
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto(new URL('film.html', import.meta.url).href); await p.waitForTimeout(1500);
const t0 = Date.now();
for (let f = 0; f < N; f++) {
  await p.evaluate((t) => window.render(t), f / FPS);
  await p.screenshot({ path: `${frames}/f${String(f).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 94 });
  if (f % 150 === 0) console.log(f, '/', N, `${Math.round((Date.now() - t0) / 1000)}s`);
}
// L'image du post : le titre, toutes les pièces en place.
await p.evaluate(() => window.render(7.4));
await p.screenshot({ path: `${dir}poster.png` });
await b.close();

const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
ff('-i', `${dir}music.wav`, '-af', 'loudnorm=I=-20:TP=-3:LRA=11', '-ar', '44100', `${dir}music-n.wav`);
ff('-framerate', String(FPS), '-i', `${frames}/f%05d.jpg`, '-i', `${dir}music-n.wav`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
  '-shortest', '-movflags', '+faststart', `${cards}wick-intro.mp4`);
ff('-i', `${dir}poster.png`, '-vf', 'scale=1600:-1', `${cards}post-intro.png`);
rmSync(frames, { recursive: true, force: true });
console.log('done', `${Math.round((Date.now() - t0) / 1000)}s`);
