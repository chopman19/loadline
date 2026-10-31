import type { PuzzleKind } from './puzzle';
import { rankFor } from './scoring';

export const SITE = 'chopman19.github.io/loadline';

export interface ShareInput {
  kind: PuzzleKind;
  id: number;
  score: number;
  sunk: boolean;
  containers: number;
  jettisoned: number;
}

/** Spoiler-free result text: score, rank and a five-segment bar, no countries. */
export function shareText(r: ShareInput): string {
  const rank = rankFor(r.score, r.sunk);
  const title = r.kind === 'unlimited' ? 'LOADLINE practice' : `LOADLINE #${r.id}${r.kind === 'archive' ? ' (archive)' : ''}`;
  let bar: string;
  if (r.sunk) bar = '🟥🟥🟥🟥🟥';
  else if (r.score >= 1000) bar = '🟨🟨🟨🟨🟨';
  else {
    const filled = Math.floor(r.score / 200);
    bar = '🟦'.repeat(filled) + '⬜'.repeat(5 - filled);
  }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const cargo = plural(r.containers, 'container') + (r.jettisoned ? `, ${r.jettisoned} jettisoned` : '');
  return [`⚓ ${title} · ${r.score}/1000 · ${rank.name}`, `${bar} ${cargo}`, `${r.sunk ? '🌊' : '🚢'} ${SITE}`].join('\n');
}
