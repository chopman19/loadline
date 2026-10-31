# LOADLINE

*Load the ship · don't sink it · one voyage a day.*

LOADLINE is a daily geography puzzle. A cargo ship waits in a pixel-art harbour with a
**load line** painted on its hull: a target population such as 87,400,000. You load
countries as containers, and each one weighs as much as its population. You only learn a
country's population once it's on deck. Get as close to the line as you can without going
over, then set sail. Go over and the ship sinks.

It is a fully static site (Vite + TypeScript, no framework, no backend). All art is drawn
in code on a canvas, and all sound and music is synthesised with the Web Audio API.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Node 20 or newer is required.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Rebuilds `countries.json`, type-checks, and builds to `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm test` | Unit tests (daily seed, scoring, solver, rule filters, name matcher, data sanity) |
| `npm run puzzles` | Generates and checks the next 365 daily puzzles (`-- --verbose` lists them) |
| `npm run data` | Rebuilds `src/data/countries.json` from `scripts/country-source.ts` and validates it |
| `npm run shots` | Plays through the game in headless Chromium (desktop and mobile) and saves screenshots to `screenshots/` |
| `npm run icons` | Regenerates `public/favicon-32.png`, `apple-touch-icon.png` and `og-image.png` |
| `npm run deploy` | Builds and publishes to GitHub Pages (the `gh-pages` branch) |
| `npm run keys` | Makes the key pair that signs Unlimited licences (see below). Refuses to replace an existing key |

`npm run shots` and `npm run icons` need a Playwright browser once: `npx playwright install chromium`.

## Deploy

`npm run build` writes a static site to `dist/`. Asset paths are relative (`base: './'`).
The daily game works on any static host, but **buying Unlimited needs the three small
functions in `netlify/functions`**, so deploy to Netlify for payments.

- **Netlify:** connect the repo. `netlify.toml` sets the build command, the `dist` folder and
  the functions. Then add the environment variables listed under "Unlimited and payments".
- **Vercel:** framework preset "Vite" (build `npm run build`, output `dist`). The functions
  are standard `Request` → `Response` handlers, so moving them to `api/` mostly means renaming.
- **GitHub Pages** (where it's published now): static only, so Unlimited can't be bought
  there. `npm run deploy` builds and pushes `dist/` to the `gh-pages` branch, which Pages serves.

The site address appears in three places. Change them if you deploy somewhere other than
`chopman19.github.io/loadline`: the `og:url`/`og:image`/`twitter:image` tags in `index.html`, and
`SITE` in `src/core/share.ts` (the last line of the share text).

## Unlimited and payments

The daily voyage is free. Unlimited is a one-time Stripe purchase with **no accounts and no
database**: Stripe's own records are the list of buyers.

1. **UNLOCK UNLIMITED** calls `/api/checkout`, which opens Stripe Checkout for the product's
   default price.
2. Stripe sends the buyer back to `?unlock=<checkout session id>`. The game calls
   `/api/verify`, which asks Stripe whether that session paid for the product.
3. If it did, the function returns a **licence**: a small payload signed with a private
   ECDSA key. The game checks the signature with the public key in `src/config.ts` and saves
   the licence in `localStorage`. Editing `localStorage` can't forge one.
4. **Restore purchase** (in the Unlimited dialog) takes the email used at checkout.
   `/api/restore` finds that buyer's completed checkouts in Stripe and issues a new licence,
   so the unlock works on other devices.

**Setup**

1. In Stripe, give the product (`prod_VWptLN9ya187k9`) a **one-time default price**.
2. `npm run keys` writes the public key into `src/config.ts` and the private key into `.env`
   (git-ignored). Run it once: new keys invalidate every licence already sold.
3. In Netlify, under Site configuration > Environment variables, add:
   - `STRIPE_SECRET_KEY`: your Stripe secret key (`sk_test_...` while testing, then `sk_live_...`)
   - `LICENSE_PRIVATE_KEY`: the whole JSON value from `.env`
   - `STRIPE_PRODUCT_ID` (optional): only if you switch to another product
4. To test locally with the functions running, use `npx netlify dev` instead of `npm run dev`.
   It reads `.env`, so add `STRIPE_SECRET_KEY=sk_test_...` there.

Limits worth knowing: the puzzles are generated in the browser, so someone who edits the
game's JavaScript can still skip the check. Restore only needs an email, so anyone who knows
a buyer's email could unlock their own browser with it.

## How the puzzles work

- **Numbering.** Voyage #1 was 31 October 2026. A new voyage starts at local midnight
  (`src/core/daily.ts`).
- **Seeding.** Each day's puzzle comes from a seeded PRNG (FNV-1a hash + mulberry32), so
  everyone gets the same puzzle without a server (`src/core/rng.ts`).
- **Rules.** The manifest rule rotates through a shuffled "bag" of every rule, so rules
  don't repeat until the bag is used up.
- **Generation** (`src/core/puzzle.ts`). For each day the generator picks a rule and a hold
  size (3 to 6), plants a random combination of eligible countries, and rounds its total up
  to a tidy load line. It then accepts the puzzle only if:
  - the best legal load reaches **at least 99.5%** of the line;
  - the hold's biggest countries together overshoot the line;
  - loading the biggest countries first stays **below 98.5%**;
  - largest-first over the whole eligible set stays **below 99.3%**;
  - no single country lands within 3% of the line.
- **Solver** (`src/core/solver.ts`). The optimal load is a cardinality-limited subset-sum.
  A bitset dynamic programme finds every reachable total, and a pruned depth-first search
  recovers the countries. It takes a few milliseconds per puzzle.

Because puzzles are generated from the country data and the rules list, **changing either
changes future puzzles**. Run `npm run puzzles` after any edit to check the next year still
validates.

## Data

`src/data/countries.json` holds 201 entries: all 193 UN member states, plus Palestine,
Vatican City, Kosovo, Taiwan, Hong Kong, Macau, Puerto Rico and Greenland. Each entry has
its name, aliases, ISO alpha-2/alpha-3 codes, population, continent, UN subregion,
landlocked/island flags, hemisphere (`N`, `S` or `both` for countries the Equator crosses),
coasts, land neighbours and a one-line fun fact.

- **Populations** are UN *World Population Prospects 2024* medium-variant estimates for
  2026, rounded to the nearest 1,000. Kosovo isn't listed separately by the UN, so its
  figure is the 2024 Kosovo census. Vatican City's ~500 people round up to 1,000.
- The data is edited in `scripts/country-source.ts` (one compact row per country) and
  expanded by `npm run data`. The build checks that borders are mutual, codes are unique,
  every country has a flag and there are exactly 193 UN members.
- **Flags** come from the open-source [flag-icons](https://github.com/lipis/flag-icons)
  package (MIT). They are rasterised at 12×9 pixels at runtime and drawn with
  `image-rendering: pixelated`.

### Adding a manifest rule

Rules live in `src/data/rules.ts`. Each one has an `id`, display `text`, a one-line
`detail`, a `test(country)` filter, and `why(country)`, which explains a rejection in a
friendly sentence. Append one to `RULES` and run `npm test && npm run puzzles`.

## Project layout

```
src/
  core/        pure game logic: countries, rng, daily, rules glue, solver, puzzle, scoring, matcher, voyage, share
  data/        countries.json and rules.ts
  scene/       canvas harbour (scene.ts), pixel helpers, low-res flags
  audio/       Web Audio sound effects and music
  state/       localStorage persistence and stats
  ui/          app controller, modals, DOM helpers, pixel icons
scripts/       data build, 365-day puzzle check, screenshot playthrough, icon and key generators
netlify/       payment functions (checkout, verify, restore) and their shared Stripe code
tests/         vitest unit tests
```

## Accessibility and preferences

- Fully keyboard-playable. Type, use the arrow keys in the autocomplete, Enter to load,
  Tab to complete a name, Escape to close the list or cancel a jettison.
- Icon buttons have ARIA labels, the gauge is an ARIA meter, and messages are announced
  through a live region.
- **Reduced motion** follows `prefers-reduced-motion` by default and can be forced on or off
  in Settings. It removes screen shake and shortens or stills the big animations.
- Progress, settings and an in-progress voyage are saved in `localStorage`. Reloading
  mid-voyage resumes where you left off. A finished voyage is recorded the moment it
  ends, so reloading can't undo a sinking.

## Fonts

"Press Start 2P" (headings) and "VT323" (UI) are self-hosted through the
`@fontsource` packages (SIL Open Font License).
