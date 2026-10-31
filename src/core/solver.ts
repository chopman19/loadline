// Optimal-load solver: the largest total of at most `maxItems` distinct weights that does not
// exceed `capacity`. Populations are multiples of 1,000, so we work in thousands.
//
// 1. A cardinality-bounded subset-sum DP over bitsets finds every reachable total (fast:
//    a few thousand words per row, shifted and OR-ed once per item).
// 2. A depth-first search, pruned by that reachability table and by "largest remaining"
//    bounds, recovers one combination that hits the best total exactly.

export interface SolveResult {
  /** Best achievable total (same unit as the input weights). */
  total: number;
  /** Indices into the input array of one optimal combination. */
  picks: number[];
}

const UNIT = 1000;

export function solve(weights: readonly number[], maxItems: number, capacity: number): SolveResult {
  const cap = Math.floor(capacity / UNIT);
  const items = weights
    .map((w, i) => ({ w: Math.round(w / UNIT), i }))
    .filter((x) => x.w > 0 && x.w <= cap)
    .sort((a, b) => b.w - a.w);
  const k = Math.min(maxItems, items.length);
  if (k === 0 || cap <= 0) return { total: 0, picks: [] };

  const words = (cap >>> 5) + 1;
  const reach: Uint32Array[] = Array.from({ length: k + 1 }, () => new Uint32Array(words));
  reach[0][0] = 1;
  const lastWord = cap >>> 5;
  const lastMask = (cap & 31) === 31 ? 0xffffffff : (1 << ((cap & 31) + 1)) - 1;

  items.forEach(({ w }, n) => {
    const ws = w >>> 5;
    const bs = w & 31;
    for (let c = Math.min(k - 1, n); c >= 0; c--) {
      const src = reach[c];
      const dst = reach[c + 1];
      for (let j = lastWord; j >= ws; j--) {
        const lo = src[j - ws];
        const v = bs === 0 ? lo : (lo << bs) | (j - ws - 1 >= 0 ? src[j - ws - 1] >>> (32 - bs) : 0);
        if (v) dst[j] |= v;
      }
      dst[lastWord] &= lastMask;
    }
  });

  // reachableWithin[m] = bitset of totals reachable using at most m items.
  const within: Uint32Array[] = [reach[0].slice()];
  for (let m = 1; m <= k; m++) {
    const u = within[m - 1].slice();
    for (let j = 0; j < words; j++) u[j] |= reach[m][j];
    within.push(u);
  }
  const has = (bits: Uint32Array, s: number) => s >= 0 && s <= cap && (bits[s >>> 5] & (1 << (s & 31))) !== 0;

  let best = 0;
  for (let s = cap; s > 0; s--) {
    if (has(within[k], s)) {
      best = s;
      break;
    }
  }
  if (best === 0) return { total: 0, picks: [] };

  // prefix[j] = sum of items[0..j-1]; items are sorted descending, so the m largest items
  // available from position j sum to prefix[j+m] - prefix[j].
  const prefix = [0];
  for (const it of items) prefix.push(prefix[prefix.length - 1] + it.w);
  const topFrom = (j: number, m: number) => prefix[Math.min(items.length, j + m)] - prefix[j];

  const chosen: number[] = [];
  const dfs = (start: number, remaining: number, slots: number): boolean => {
    if (remaining === 0) return true;
    if (slots === 0 || !has(within[slots], remaining)) return false;
    // Skip items that are too heavy (binary search on the descending list).
    let lo = start;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (items[mid].w > remaining) lo = mid + 1;
      else hi = mid;
    }
    for (let j = lo; j < items.length; j++) {
      if (topFrom(j, slots) < remaining) return false;
      chosen.push(j);
      if (dfs(j + 1, remaining - items[j].w, slots - 1)) return true;
      chosen.pop();
    }
    return false;
  };
  dfs(0, best, k);

  return { total: best * UNIT, picks: chosen.map((j) => items[j].i) };
}

/**
 * What a player gets by loading the biggest countries first: walk the list from the largest
 * down, taking each one that still fits, until the hold is full.
 */
export function greedyLargest(weights: readonly number[], maxItems: number, capacity: number): number {
  const sorted = weights.slice().sort((a, b) => b - a);
  let total = 0;
  let count = 0;
  for (const w of sorted) {
    if (count >= maxItems) break;
    if (total + w <= capacity) {
      total += w;
      count++;
    }
  }
  return total;
}
