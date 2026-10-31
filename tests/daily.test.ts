import { describe, expect, it } from 'vitest';
import { dateForDay, dayNumber, formatCountdown, msUntilNextDay } from '../src/core/daily';
import { hashString, mulberry32, seeded, shuffle } from '../src/core/rng';
import { dailyPuzzle, unlimitedPuzzle } from '../src/core/puzzle';

describe('daily seed', () => {
  it('numbers voyages from 31 October 2026', () => {
    expect(dayNumber(new Date(2026, 9, 31, 0, 0, 1))).toBe(1);
    expect(dayNumber(new Date(2026, 9, 31, 23, 59, 59))).toBe(1);
    expect(dayNumber(new Date(2026, 10, 1, 0, 0, 0))).toBe(2);
    expect(dayNumber(new Date(2026, 11, 16, 12))).toBe(47);
  });

  it('rolls over at local midnight', () => {
    const lateNight = new Date(2026, 10, 3, 23, 59, 59, 999);
    const justAfter = new Date(2026, 10, 4, 0, 0, 0, 0);
    expect(dayNumber(justAfter) - dayNumber(lateNight)).toBe(1);
    expect(msUntilNextDay(lateNight)).toBe(1);
  });

  it('is unaffected by daylight-saving changes', () => {
    // Walk two years of local dates; numbers must increase by exactly one per day.
    let prev = dayNumber(new Date(2026, 8, 15, 12));
    for (let i = 1; i < 730; i++) {
      const n = dayNumber(new Date(2026, 8, 15 + i, 12));
      expect(n).toBe(prev + 1);
      prev = n;
    }
  });

  it('maps numbers back to dates', () => {
    for (const n of [1, 47, 100, 365, 1000]) expect(dayNumber(dateForDay(n))).toBe(n);
  });

  it('formats the countdown', () => {
    expect(formatCountdown(3_723_000)).toBe('01:02:03');
    expect(formatCountdown(-5)).toBe('00:00:00');
  });

  it('gives everyone the same puzzle for the same day', () => {
    expect(dailyPuzzle(47)).toEqual(dailyPuzzle(47));
    const a = dailyPuzzle(120);
    const b = dailyPuzzle(121);
    expect([a.ruleId, a.target, a.hold]).not.toEqual([b.ruleId, b.target, b.hold]);
    expect(unlimitedPuzzle(999)).toEqual(unlimitedPuzzle(999));
  });

  it('has a stable, deterministic RNG', () => {
    expect(hashString('loadline')).toBe(hashString('loadline'));
    expect(hashString('a')).not.toBe(hashString('b'));
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    const xs = Array.from({ length: 5 }, () => r1());
    expect(xs).toEqual(Array.from({ length: 5 }, () => r2()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(shuffle(seeded('x'), [1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
