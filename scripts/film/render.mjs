import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const FPS = 30, DUR = 40.5, N = Math.round(FPS * DUR);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--allow-file-access-from-files'] }).catch(() => chromium.launch());
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto('file://scripts/film/film.html'); await p.waitForTimeout(1500);
const t0 = Date.now();
for (let f = 0; f < N; f++) {
  await p.evaluate((t) => window.render(t), f / FPS);
  await p.screenshot({ path: 'scripts/film/frames/f' + String(f).padStart(5, '0') + '.jpg', type: 'jpeg', quality: 94 });
  if (f % 100 === 0) console.log(f, '/', N, Math.round((Date.now() - t0) / 1000) + 's');
}
console.log('done', Math.round((Date.now() - t0) / 1000) + 's');
await b.close();
