// Country name matching for the cargo input: accent-insensitive, alias-aware and typo-tolerant.
import { COUNTRIES, type Country } from './countries';

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '')
    .replace(/\bst\b/g, 'saint');
}

interface Entry {
  country: Country;
  keys: string[]; // normalized name first, then aliases
  exactOnly: string[]; // ISO codes: only match when typed in full
}

const ENTRIES: Entry[] = COUNTRIES.map((country) => ({
  country,
  keys: [country.name, ...country.aliases].map(normalize),
  exactOnly: [country.iso3.toLowerCase()],
}));

/** Optimal string alignment distance (Levenshtein with adjacent transpositions). */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    let rowMin = Infinity;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

function allowedTypos(len: number): number {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  return 3;
}

function scoreKey(q: string, key: string, isName: boolean): number {
  if (key === q) return isName ? 100 : 96;
  if (key.startsWith(q)) return 80 - Math.min(10, key.length - q.length) * 0.5;
  if (key.split(' ').some((w) => w.startsWith(q))) return 62;
  if (q.length >= 3 && key.includes(q)) return 45;
  const typos = allowedTypos(q.length);
  if (typos > 0) {
    const whole = editDistance(q, key, typos);
    if (whole <= typos) return 40 - whole * 4;
    if (q.length >= 4 && key.length > q.length) {
      const prefix = editDistance(q, key.slice(0, q.length), 1);
      if (prefix <= 1) return 28;
    }
  }
  return 0;
}

export interface Suggestion {
  country: Country;
  score: number;
}

export function search(query: string, limit = 6): Suggestion[] {
  const q = normalize(query);
  if (!q) return [];
  const out: Suggestion[] = [];
  for (const e of ENTRIES) {
    let best = e.exactOnly.includes(q) ? 97 : 0;
    e.keys.forEach((k, i) => {
      best = Math.max(best, scoreKey(q, k, i === 0));
    });
    if (best > 0) out.push({ country: e.country, score: best });
  }
  out.sort((a, b) => b.score - a.score || b.country.population - a.country.population);
  return out.slice(0, limit);
}

/** Resolves what the player typed to a single country, or null if nothing is close enough. */
export function resolve(query: string): Country | null {
  const top = search(query, 1)[0];
  return top && top.score >= 28 ? top.country : null;
}
