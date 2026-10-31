// Plays today's voyage in headless Chromium at desktop and mobile sizes and saves
// screenshots of: first-visit help, home, mid-game, a successful result and a sunk result.
// Usage: npm run shots   (writes to ./screenshots)
import { chromium, type Browser, type BrowserContextOptions, type Page } from 'playwright';
import { createServer } from 'vite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { signLicense } from '../src/core/license';
import { dailyPuzzle, eligibleFor } from '../src/core/puzzle';
import { dayNumber } from '../src/core/daily';
import { byIso3 } from '../src/core/countries';
import { getRule } from '../src/data/rules';

const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const puzzle = dailyPuzzle(dayNumber());
const rule = getRule(puzzle.ruleId);
const best = puzzle.optimal.iso3.map(byIso3);
const heavy = eligibleFor(rule).sort((a, b) => b.population - a.population);
console.log(`Voyage #${puzzle.id}: ${rule.text}, hold ${puzzle.hold}, target ${puzzle.target}`);
console.log(`Best: ${best.map((c) => c.name).join(', ')}`);

const errors: string[] = [];

async function open(browser: Browser, opts: BrowserContextOptions, url: string, shiftDays = 0): Promise<Page> {
  const ctx = await browser.newContext({ ...opts, reducedMotion: 'no-preference' });
  // Optionally move the page's clock forward so the archive has past voyages to show.
  if (shiftDays) {
    // A plain string: tsx's transpiled helpers don't exist inside the page.
    await ctx.addInitScript(`{
      const Real = Date, offset = ${shiftDays * 86_400_000};
      globalThis.Date = class extends Real {
        constructor(...args) { args.length ? super(...args) : super(Real.now() + offset); }
        static now() { return Real.now() + offset; }
      };
    }`);
  }
  // Stand-ins for the Netlify payment functions, which the Vite dev server doesn't run.
  await ctx.route('**/api/checkout', (r) => r.fulfill({ json: { amount: 300, currency: 'eur' } }));
  await ctx.route('**/api/restore', async (r) =>
    PRIVATE_KEY
      ? r.fulfill({ json: { license: await signLicense(PRIVATE_KEY, { v: 1, feature: 'unlimited', ref: 'cs_test_shots', iat: Date.now() }) } })
      : r.fulfill({ status: 404, json: { error: 'No purchase found for that email' } }),
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function load(page: Page, name: string): Promise<void> {
  await page.fill('#cargo-input', name);
  await page.keyboard.press('Enter');
  // Wait for the crane to finish and the controls to unlock (or the voyage to end).
  await page.waitForFunction(() => {
    const input = document.querySelector<HTMLInputElement>('#cargo-input');
    return !input || !input.disabled || document.body.dataset.screen === 'result';
  }, undefined, { timeout: 15000 });
  await page.waitForTimeout(500);
}

async function run(label: string, opts: BrowserContextOptions, url: string, browser: Browser): Promise<void> {
  const shot = (page: Page, name: string, full = false) => page.screenshot({ path: `${OUT}/${label}-${name}.png`, fullPage: full });

  // First visit: the help modal opens by itself.
  let page = await open(browser, opts, url);
  await page.waitForSelector('dialog[open]');
  await page.waitForTimeout(1600);
  await shot(page, '0-help');
  await page.click('.modal-close');
  await page.waitForTimeout(1200);
  await shot(page, '1-home');

  // A good voyage: load the optimal cargo except the last one, screenshot, then finish.
  await page.click('#begin');
  await page.waitForSelector('#cargo-input');
  for (const c of best.slice(0, Math.max(1, best.length - 1))) await load(page, c.name);
  await page.fill('#cargo-input', best.length > 1 ? best[best.length - 1].name.slice(0, 3) : '');
  await page.dispatchEvent('#cargo-input', 'input');
  await page.waitForTimeout(300);
  await shot(page, '2-midgame');
  await page.fill('#cargo-input', '');
  await page.dispatchEvent('#cargo-input', 'input');
  if (best.length > 1) await load(page, best[best.length - 1].name);

  // Resume check: reload mid-voyage if the hold isn't full yet.
  if (await page.$('.btn-sail:not([disabled])')) {
    await page.click('.btn-sail');
  }
  await page.waitForSelector('.result');
  await page.waitForTimeout(7500);
  await shot(page, '3-success');
  await shot(page, '3-success-full', true);

  // Stats modal after a voyage.
  await page.click('#btn-stats');
  await page.waitForTimeout(500);
  await shot(page, '5-stats');
  await page.click('.modal-close');
  await page.context().close();

  // A sunk voyage: load the heaviest legal countries until the ship goes under.
  page = await open(browser, opts, url);
  await page.click('.modal-close');
  await page.click('#begin');
  await page.waitForSelector('#cargo-input');
  // Reload once mid-voyage to prove resume works.
  const first = heavy.find((c) => c.population < puzzle.target)!;
  await load(page, first.name);
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('#cargo-input');
  const resumed = await page.$$eval('.cargo-card.filled', (els) => els.length);
  if (resumed !== 1) errors.push(`resume failed: ${resumed} containers after reload`);
  for (const c of heavy.filter((c) => c !== first)) {
    if ((await page.evaluate(() => document.body.dataset.screen)) === 'result') break;
    await load(page, c.name);
  }
  await page.waitForSelector('.result.sunk', { timeout: 20000 });
  await page.waitForTimeout(4500);
  await shot(page, '4-sunk');
  await page.context().close();

  // Archive: a past day whose best load is a Perfect Trim. The clock is moved forward
  // so the archive has past voyages. Load a decoy, jettison it, then load the perfect
  // cargo and sail into the fireworks.
  page = await open(browser, opts, url, SHIFT_DAYS);
  await page.click('.modal-close');
  await page.click('.home-buttons .btn:has-text("ARCHIVE")');
  await page.waitForTimeout(400);
  await shot(page, '6-archive');
  await page.click(`.arch-row:has(.arch-num:text-is("#${perfect.id}"))`);
  await page.waitForSelector('#cargo-input');
  await load(page, decoy.name);
  await page.click('.btn-jet');
  await page.waitForTimeout(200);
  await shot(page, '7-jettison-pick');
  await page.click('.cargo-card.throwable', { force: true });
  await page.waitForTimeout(2600);
  await shot(page, '7-jettison');
  for (const c of perfectCargo) {
    if ((await page.evaluate(() => document.body.dataset.screen)) === 'result') break;
    await load(page, c.name);
  }
  if (await page.$('.btn-sail:not([disabled])')) await page.click('.btn-sail');
  await page.waitForSelector('.result.perfect');
  await page.waitForTimeout(2200);
  await shot(page, '8-perfect-fireworks');
  await page.click('#btn-settings');
  await page.waitForTimeout(400);
  await shot(page, '9-settings');
  await page.click('.modal-close');

  // Unlimited is locked until bought; restore a (test) purchase to unlock it.
  await page.click('.btn-ghost:has-text("HARBOUR")');
  await page.click('.home-buttons .btn:has-text("UNLIMITED")');
  await page.waitForSelector('dialog[open] .pay-price:has-text("ONE-TIME")');
  await shot(page, '10-paywall');
  if (PRIVATE_KEY) {
    await page.click('.pay-more summary');
    await page.fill('.pay-email', 'captain@example.com');
    await page.click('.pay-restore .btn');
    await page.waitForSelector('#cargo-input');
    await page.waitForTimeout(1500);
    await shot(page, '11-unlimited');
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector('#cargo-input');
    if (!(await page.textContent('body'))!.includes('PRACTICE VOYAGE')) errors.push('unlimited voyage did not resume after reload');
  }
  await page.context().close();
}

// The licence key from .env (made by `npm run keys`), to test the unlock end to end.
const envKey = existsSync('.env') ? /^LICENSE_PRIVATE_KEY=(.*)$/m.exec(readFileSync('.env', 'utf8'))?.[1] : undefined;
const PRIVATE_KEY = envKey ? (JSON.parse(envKey) as JsonWebKey) : null;
if (!PRIVATE_KEY) console.log('No LICENSE_PRIVATE_KEY in .env: skipping the Unlimited unlock check.');

// A past voyage (as seen from SHIFT_DAYS ahead) where the best load rounds to a perfect 1000.
const SHIFT_DAYS = 60;
const today = dayNumber() + SHIFT_DAYS;
let perfectDay = today - 1;
while (perfectDay > 1 && Math.round((1000 * dailyPuzzle(perfectDay).optimal.total) / dailyPuzzle(perfectDay).target) !== 1000) perfectDay--;
const perfect = dailyPuzzle(perfectDay, 'archive');
const perfectCargo = perfect.optimal.iso3.map(byIso3);
const decoy = eligibleFor(getRule(perfect.ruleId))
  .filter((c) => !perfect.optimal.iso3.includes(c.iso3))
  .sort((a, b) => a.population - b.population)[0];
console.log(`Perfect day #${perfect.id}: ${perfectCargo.map((c) => c.name).join(', ')} (decoy ${decoy.name})`);

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const url = 'http://localhost:5199/';
const browser = await chromium.launch();
try {
  await run('desktop', { viewport: { width: 1280, height: 900 } }, url, browser);
  await run('mobile', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, url, browser);
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.error(`Problems:\n${[...new Set(errors)].join('\n')}`);
  process.exit(1);
}
console.log(`Screenshots saved to ./${OUT}`);
