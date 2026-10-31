// Progress, settings and the in-progress voyage, kept in localStorage.
// Every access is wrapped so private browsing or a full quota never breaks the game.
import type { NumberFormat } from '../core/format';
import type { VoyageState } from '../core/voyage';
import { RANKS, rankFor, type Rank } from '../core/scoring';

const KEY = 'loadline:v1';

export interface Settings {
  sfx: boolean;
  music: boolean;
  muted: boolean;
  motion: 'auto' | 'reduce' | 'full';
  format: NumberFormat;
}

export interface VoyageRecord {
  score: number;
  sunk: boolean;
  /** ISO3 codes on deck at the end (for a sunk ship, including the one that sank it). */
  loaded: string[];
  jettisoned: string | null;
  total: number;
  at: number;
}

export interface SaveData {
  settings: Settings;
  daily: Record<string, VoyageRecord>;
  archive: Record<string, VoyageRecord>;
  practice: { played: number; best: number; seed: number };
  current: VoyageState | null;
  seenHelp: boolean;
  /** Signed Unlimited licence (see src/core/license.ts). */
  license: string | null;
}

const DEFAULTS: SaveData = {
  settings: { sfx: true, music: true, muted: false, motion: 'auto', format: 'full' },
  daily: {},
  archive: {},
  practice: { played: 0, best: 0, seed: 0 },
  current: null,
  seenHelp: false,
  license: null,
};

function read(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      settings: { ...DEFAULTS.settings, ...(parsed.settings ?? {}) },
      practice: { ...DEFAULTS.practice, ...(parsed.practice ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const save: SaveData = read();

export function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Storage unavailable: progress lasts for this session only.
  }
}

export interface Stats {
  played: number;
  winPct: number;
  streak: number;
  bestStreak: number;
  perfect: number;
  histogram: { rank: Rank; count: number }[];
}

/**
 * Daily voyages only. A streak is a run of consecutive days with a voyage that didn't sink;
 * it stays alive until the end of today, so an unplayed today doesn't break it yet.
 */
export function computeStats(daily: Record<string, VoyageRecord>, today: number): Stats {
  const days = Object.keys(daily)
    .map(Number)
    .sort((a, b) => a - b);
  const records = days.map((d) => daily[d]);
  const played = records.length;
  const wins = records.filter((r) => !r.sunk).length;
  let best = 0;
  let run = 0;
  let prev = -Infinity;
  for (const d of days) {
    const ok = !daily[d].sunk;
    run = ok ? (d === prev + 1 ? run + 1 : 1) : 0;
    best = Math.max(best, run);
    prev = ok ? d : -Infinity;
  }
  let streak = 0;
  let d = daily[today] ? today : today - 1;
  while (daily[d] && !daily[d].sunk) {
    streak++;
    d--;
  }
  const histogram = RANKS.map((rank) => ({ rank, count: records.filter((r) => rankFor(r.score, r.sunk).id === rank.id).length }));
  return {
    played,
    winPct: played ? Math.round((wins / played) * 100) : 0,
    streak,
    bestStreak: best,
    perfect: records.filter((r) => !r.sunk && r.score >= 1000).length,
    histogram,
  };
}
