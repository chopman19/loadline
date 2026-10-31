// Puzzle generation. Each puzzle is a (rule, hold size, target) triple, built so that:
//   * some legal combination reaches at least 99.5% of the load line, and
//   * the obvious play (biggest eligible countries first) falls clearly short.
import { COUNTRIES, type Country } from './countries';
import { RULES, getRule, type ManifestRule } from '../data/rules';
import { randInt, seeded, shuffle, weightedSample, type Rng } from './rng';
import { greedyLargest, solve } from './solver';

export const MIN_TARGET = 1_000_000;
export const MAX_TARGET = 500_000_000;
/** Some legal load must reach this share of the target. */
export const MIN_BEST_RATIO = 0.995;
/** Loading the biggest countries first must stay below this share. */
export const MAX_GREEDY_RATIO = 0.985;
/** Largest-first over the whole eligible set must stay below this share. */
export const MAX_FILL_RATIO = 0.993;

export type PuzzleKind = 'daily' | 'archive' | 'unlimited';

export interface Puzzle {
  /** Voyage number for daily/archive puzzles; a practice seed for unlimited ones. */
  id: number;
  kind: PuzzleKind;
  ruleId: string;
  hold: number;
  target: number;
  /** Best possible load (ISO3 codes), heaviest first, and its total. */
  optimal: { total: number; iso3: string[] };
  /** The total you'd get by loading the biggest eligible countries first. */
  greedy: number;
}

export function eligibleFor(rule: ManifestRule): Country[] {
  return COUNTRIES.filter(rule.test);
}

/** Rounds up to `sig` significant figures (never below 1,000 people). */
export function ceilSig(n: number, sig: number): number {
  const unit = Math.max(1000, 10 ** (Math.floor(Math.log10(n)) - (sig - 1)));
  return Math.ceil(n / unit) * unit;
}

export interface Candidate {
  target: number;
  optimal: Puzzle['optimal'];
  greedy: number;
}

export function evaluate(eligible: Country[], hold: number, target: number): Candidate | null {
  if (target < MIN_TARGET || target > MAX_TARGET) return null;
  const weights = eligible.map((c) => c.population);
  // The biggest few must overshoot, otherwise "load the giants" is the answer.
  const topSum = weights.slice().sort((a, b) => b - a).slice(0, hold).reduce((a, b) => a + b, 0);
  if (topSum <= target) return null;
  if (weights.some((w) => w <= target && w >= target * 0.97)) return null; // no one-country solves
  // "Obvious picks": the biggest few countries on the manifest, taken largest-first while they fit.
  const biggest = weights.slice().sort((a, b) => b - a).slice(0, hold + 3);
  const greedy = greedyLargest(biggest, hold, target);
  if (greedy >= target * MAX_GREEDY_RATIO) return null;
  // Even topping up with small fry, largest-first must not reach Master Mariner territory.
  if (greedyLargest(weights, hold, target) >= target * MAX_FILL_RATIO) return null;
  const best = solve(weights, hold, target);
  if (best.total < target * MIN_BEST_RATIO) return null;
  const iso3 = best.picks.map((i) => eligible[i]).sort((a, b) => b.population - a.population).map((c) => c.iso3);
  return { target, optimal: { total: best.total, iso3 }, greedy };
}

/** Tries to build a puzzle for one rule; returns null if the rule can't produce a good one. */
export function buildForRule(rng: Rng, rule: ManifestRule, attempts = 240): Omit<Puzzle, 'id' | 'kind'> | null {
  const eligible = eligibleFor(rule);
  if (eligible.length < 6) return null;
  let hold = [3, 4, 4, 5, 5, 6, 6][randInt(rng, 0, 6)];
  hold = Math.min(hold, Math.max(3, Math.floor(eligible.length / 3)));
  for (let a = 0; a < attempts; a++) {
    // Plant a combination of 2..hold countries; weighting by sqrt(population) favours
    // mid-sized countries over the long tail of microstates.
    const size = randInt(rng, Math.min(hold, 2 + (hold > 4 ? 1 : 0)), hold);
    const planted = weightedSample(rng, eligible, size, (c) => Math.sqrt(c.population));
    const sum = planted.reduce((s, c) => s + c.population, 0);
    if (sum < MIN_TARGET || sum > MAX_TARGET) continue;
    // Prefer a tidy 3-significant-figure load line; fall back to 4 if that leaves no good answer.
    for (const sig of [3, 4]) {
      const found = evaluate(eligible, hold, ceilSig(sum, sig));
      if (found) return { ruleId: rule.id, hold, ...found };
    }
  }
  return null;
}

/** Bag of rules for a block of days: each rule appears once per block, in shuffled order. */
function ruleForDay(day: number): ManifestRule[] {
  const block = Math.floor((day - 1) / RULES.length);
  const order = shuffle(seeded(`loadline-bag-${block}`), RULES);
  const n = RULES.length;
  const start = (day - 1) % n;
  // Preferred rule first. Fallbacks start half a bag away so neighbouring days that both
  // need one don't land on the same rule.
  const half = Math.floor(n / 2);
  return [order[start], ...Array.from({ length: n - 1 }, (_, i) => order[(start + half + i * 7) % n])].filter(
    (r, i, all) => all.indexOf(r) === i,
  );
}

const cache = new Map<string, Puzzle>();

export function dailyPuzzle(day: number, kind: 'daily' | 'archive' = 'daily'): Puzzle {
  const key = `d${day}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, kind };
  const rng = seeded(`loadline-day-${day}`);
  for (const rule of ruleForDay(day)) {
    const built = buildForRule(rng, rule);
    if (built) {
      const p: Puzzle = { id: day, kind, ...built };
      cache.set(key, p);
      return p;
    }
  }
  throw new Error(`No valid puzzle for day ${day}`);
}

export function unlimitedPuzzle(seed: number): Puzzle {
  const rng = seeded(`loadline-practice-${seed}`);
  for (const rule of shuffle(rng, RULES)) {
    const built = buildForRule(rng, rule);
    if (built) return { id: seed, kind: 'unlimited', ...built };
  }
  throw new Error(`No valid practice puzzle for seed ${seed}`);
}

export function puzzleRule(p: Puzzle): ManifestRule {
  return getRule(p.ruleId);
}
