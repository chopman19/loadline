import { describe, expect, it } from 'vitest';
import { rankFor, scoreFor } from '../src/core/scoring';
import { shareText } from '../src/core/share';
import { formatShort, formatFull } from '../src/core/format';

describe('scoring', () => {
  it('scores proportionally and rounds', () => {
    expect(scoreFor(87_400_000, 87_400_000)).toBe(1000);
    expect(scoreFor(85_040_000, 87_400_000)).toBe(973);
    expect(scoreFor(0, 87_400_000)).toBe(0);
    expect(scoreFor(43_700_000, 87_400_000)).toBe(500);
  });

  it('scores an overloaded ship as zero', () => {
    expect(scoreFor(87_401_000, 87_400_000)).toBe(0);
  });

  it('assigns rank tiers at the documented thresholds', () => {
    expect(rankFor(1000, false).name).toBe('Perfect Trim');
    expect(rankFor(999, false).name).toBe('Master Mariner');
    expect(rankFor(990, false).name).toBe('Master Mariner');
    expect(rankFor(989, false).name).toBe('Captain');
    expect(rankFor(950, false).name).toBe('Captain');
    expect(rankFor(949, false).name).toBe('First Mate');
    expect(rankFor(850, false).name).toBe('First Mate');
    expect(rankFor(700, false).name).toBe('Deckhand');
    expect(rankFor(699, false).name).toBe('Landlubber');
    expect(rankFor(0, false).name).toBe('Landlubber');
    expect(rankFor(0, true).name).toBe('Sleeping with the Fishes');
  });
});

describe('share text', () => {
  it('matches the documented format', () => {
    expect(shareText({ kind: 'daily', id: 47, score: 973, sunk: false, containers: 4, jettisoned: 1 })).toBe(
      '⚓ LOADLINE #47 · 973/1000 · Captain\n🟦🟦🟦🟦⬜ 4 containers, 1 jettisoned\n🚢 chopman19.github.io/loadline',
    );
  });

  it('uses waves for a sunk ship and never mentions countries', () => {
    const t = shareText({ kind: 'daily', id: 3, score: 0, sunk: true, containers: 1, jettisoned: 0 });
    expect(t).toContain('🌊');
    expect(t).toContain('Sleeping with the Fishes');
    expect(t).toContain('1 container\n');
    expect(t).not.toContain('jettisoned');
  });

  it('labels archive and practice voyages', () => {
    expect(shareText({ kind: 'archive', id: 9, score: 1000, sunk: false, containers: 3, jettisoned: 0 })).toContain('#9 (archive)');
    expect(shareText({ kind: 'unlimited', id: 5, score: 500, sunk: false, containers: 3, jettisoned: 0 })).toContain('practice');
  });
});

describe('number formatting', () => {
  it('formats short and full', () => {
    expect(formatShort(87_400_000)).toBe('87.4M');
    expect(formatShort(1_412_914_000)).toBe('1.41B');
    expect(formatShort(5_905_000)).toBe('5.91M');
    expect(formatShort(123_000_000)).toBe('123M');
    expect(formatShort(950_000)).toBe('950K');
    expect(formatFull(87_400_000)).toBe('87,400,000');
  });
});
