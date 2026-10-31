import { describe, expect, it } from 'vitest';
import { greedyLargest, solve } from '../src/core/solver';
import { dailyPuzzle, eligibleFor, MIN_BEST_RATIO } from '../src/core/puzzle';
import { byIso3 } from '../src/core/countries';
import { getRule } from '../src/data/rules';
import { mulberry32 } from '../src/core/rng';

/** Exhaustive reference: try every combination of up to k items. */
function brute(weights: number[], k: number, cap: number): number {
  let best = 0;
  const rec = (start: number, left: number, sum: number) => {
    if (sum > cap) return;
    best = Math.max(best, sum);
    if (left === 0) return;
    for (let i = start; i < weights.length; i++) rec(i + 1, left - 1, sum + weights[i]);
  };
  rec(0, k, 0);
  return best;
}

describe('optimal-load solver', () => {
  it('finds an exact fit', () => {
    const w = [50_000, 30_000, 20_000, 7_000, 3_000];
    const r = solve(w, 2, 53_000);
    expect(r.total).toBe(53_000);
    expect(r.picks.map((i) => w[i]).sort()).toEqual([3_000, 50_000].sort());
  });

  it('respects the hold size', () => {
    const w = [1_000, 1_000, 1_000, 1_000];
    expect(solve(w, 3, 10_000).total).toBe(3_000);
  });

  it('never exceeds capacity and handles impossible loads', () => {
    expect(solve([5_000, 6_000], 2, 4_000)).toEqual({ total: 0, picks: [] });
    expect(solve([], 3, 4_000).total).toBe(0);
  });

  it('uses each item at most once', () => {
    const r = solve([10_000], 3, 30_000);
    expect(r.total).toBe(10_000);
    expect(r.picks).toEqual([0]);
  });

  it('matches brute force on random instances', () => {
    const rng = mulberry32(7);
    for (let t = 0; t < 150; t++) {
      const n = 4 + Math.floor(rng() * 12);
      const w = Array.from({ length: n }, () => (1 + Math.floor(rng() * 5000)) * 1000);
      const k = 1 + Math.floor(rng() * 5);
      const cap = (1 + Math.floor(rng() * 12000)) * 1000;
      const r = solve(w, k, cap);
      expect(r.total).toBe(brute(w, k, cap));
      expect(r.picks.length).toBeLessThanOrEqual(k);
      expect(new Set(r.picks).size).toBe(r.picks.length);
      expect(r.picks.reduce((s, i) => s + w[i], 0)).toBe(r.total);
    }
  });

  it('handles bit positions on 32-bit word boundaries', () => {
    for (const cap of [31_000, 32_000, 33_000, 63_000, 64_000]) {
      expect(solve([cap, 1_000], 2, cap).total).toBe(cap);
    }
  });

  it('greedy takes the largest that fit', () => {
    expect(greedyLargest([60, 50, 30, 15], 2, 80)).toBe(75);
    expect(greedyLargest([60, 50, 30, 15], 3, 100)).toBe(90);
  });
});

describe('daily puzzles', () => {
  it('always have a near-perfect legal answer that the biggest countries miss', () => {
    for (let day = 1; day <= 120; day++) {
      const p = dailyPuzzle(day);
      const rule = getRule(p.ruleId);
      const picks = p.optimal.iso3.map(byIso3);
      const total = picks.reduce((s, c) => s + c.population, 0);
      expect(total).toBe(p.optimal.total);
      expect(total).toBeLessThanOrEqual(p.target);
      expect(total / p.target).toBeGreaterThanOrEqual(MIN_BEST_RATIO);
      expect(picks.length).toBeLessThanOrEqual(p.hold);
      expect(picks.every(rule.test)).toBe(true);
      expect(p.hold).toBeGreaterThanOrEqual(3);
      expect(p.hold).toBeLessThanOrEqual(6);
      const biggest = eligibleFor(rule).sort((a, b) => b.population - a.population).slice(0, p.hold);
      expect(biggest.reduce((s, c) => s + c.population, 0)).toBeGreaterThan(p.target);
    }
  });
});
