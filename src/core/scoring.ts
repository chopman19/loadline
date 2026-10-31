export interface Rank {
  id: 'perfect' | 'master' | 'captain' | 'mate' | 'deckhand' | 'landlubber' | 'sunk';
  name: string;
  color: string;
  min: number;
}

/** Ordered best to worst. `sunk` is only awarded to overloaded ships. */
export const RANKS: Rank[] = [
  { id: 'perfect', name: 'Perfect Trim', color: '#ffd23f', min: 1000 },
  { id: 'master', name: 'Master Mariner', color: '#b8f35a', min: 990 },
  { id: 'captain', name: 'Captain', color: '#5ee0c8', min: 950 },
  { id: 'mate', name: 'First Mate', color: '#6fb6ff', min: 850 },
  { id: 'deckhand', name: 'Deckhand', color: '#c9a7ff', min: 700 },
  { id: 'landlubber', name: 'Landlubber', color: '#c2b8a3', min: 0 },
  { id: 'sunk', name: 'Sleeping with the Fishes', color: '#ff5a4f', min: -1 },
];

export function scoreFor(loaded: number, target: number): number {
  if (target <= 0 || loaded > target) return 0;
  return Math.round((1000 * loaded) / target);
}

export function rankFor(score: number, sunk: boolean): Rank {
  if (sunk) return RANKS[RANKS.length - 1];
  return RANKS.find((r) => r.min >= 0 && score >= r.min) ?? RANKS[RANKS.length - 2];
}
