// Renders public/favicon-32.png, public/apple-touch-icon.png and public/og-image.png
// with headless Chromium. The OG card uses a live screenshot of the harbour scene.
// Usage: npm run icons
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';

const server = await createServer({ server: { port: 5197, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
try {
  const svg = readFileSync('public/favicon.svg', 'utf8');
  for (const [size, file] of [
    [32, 'public/favicon-32.png'],
    [180, 'public/apple-touch-icon.png'],
  ] as const) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
    await page.screenshot({ path: file });
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.addInitScript(() => localStorage.setItem('loadline:v1', JSON.stringify({ seenHelp: true })));
  await page.goto('http://localhost:5197/');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500);
  const shot = await (await page.$('#scene'))!.screenshot();
  const src = `data:image/png;base64,${shot.toString('base64')}`;
  await page.evaluate((src) => {
    document.body.innerHTML = `
      <div style="width:1200px;height:630px;display:flex;align-items:center;gap:44px;padding:0 56px;box-sizing:border-box;
                  background:radial-gradient(ellipse at 30% 0%,rgba(255,122,26,.25),transparent 60%),#070b1c">
        <img src="${src}" style="width:640px;height:400px;image-rendering:pixelated;box-shadow:0 0 0 6px #34407a,0 0 0 12px #04060f,0 0 60px rgba(255,122,26,.25)">
        <div style="display:flex;flex-direction:column;gap:26px">
          <span class="title-sign" style="font-size:44px;animation:none">LOADLINE</span>
          <span style="font-family:VT323;font-size:34px;letter-spacing:.2em;color:#a3acd0;line-height:1.3">LOAD THE SHIP<br>DON'T SINK IT<br>ONE VOYAGE A DAY</span>
        </div>
      </div>`;
  }, src);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'public/og-image.png' });
  console.log('Wrote favicon-32.png, apple-touch-icon.png and og-image.png to public/');
} finally {
  await browser.close();
  await server.close();
}
