// Pure voyage state: what's on board, what was thrown overboard, and how it ended.
import { byIso3, type Country } from './countries';
import { getRule } from '../data/rules';
import type { Puzzle, PuzzleKind } from './puzzle';
import { scoreFor } from './scoring';

export interface VoyageState {
  kind: PuzzleKind;
  id: number;
  /** ISO3 codes currently on deck, in loading order. */
  loaded: string[];
  /** The container thrown overboard, if the jettison has been used. */
  jettisoned: string | null;
  /** Set once the ship sinks or sets sail; a sunk ship keeps the overloading container in `loaded`. */
  outcome: null | 'sunk' | 'sailed';
}

export type LoadResult =
  | { ok: true; country: Country; total: number; sunk: boolean; full: boolean }
  | { ok: false; reason: string };

export function newVoyage(p: Puzzle): VoyageState {
  return { kind: p.kind, id: p.id, loaded: [], jettisoned: null, outcome: null };
}

export function totalOf(iso3s: readonly string[]): number {
  return iso3s.reduce((s, c) => s + byIso3(c).population, 0);
}

export function tryLoad(v: VoyageState, p: Puzzle, c: Country): LoadResult {
  if (v.outcome) return { ok: false, reason: 'This voyage is over.' };
  if (v.loaded.includes(c.iso3)) return { ok: false, reason: `${c.name} is already on deck.` };
  if (v.jettisoned === c.iso3) return { ok: false, reason: `${c.name} is floating out to sea. No take-backs!` };
  if (v.loaded.length >= p.hold) return { ok: false, reason: 'The hold is full.' };
  const rule = getRule(p.ruleId);
  if (!rule.test(c)) return { ok: false, reason: rule.why(c) };
  v.loaded.push(c.iso3);
  const total = totalOf(v.loaded);
  const sunk = total > p.target;
  if (sunk) v.outcome = 'sunk';
  return { ok: true, country: c, total, sunk, full: v.loaded.length >= p.hold };
}

export function jettison(v: VoyageState, iso3: string): boolean {
  if (v.outcome || v.jettisoned || !v.loaded.includes(iso3)) return false;
  v.loaded = v.loaded.filter((c) => c !== iso3);
  v.jettisoned = iso3;
  return true;
}

export function finalScore(v: VoyageState, p: Puzzle): number {
  return v.outcome === 'sunk' ? 0 : scoreFor(totalOf(v.loaded), p.target);
}
