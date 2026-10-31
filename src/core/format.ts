export type NumberFormat = 'short' | 'full';

export function formatFull(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatShort(n: number): string {
  const abs = Math.abs(n);
  const trim = (s: string) => s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  if (abs >= 1e9) return `${trim((n / 1e9).toFixed(2))}B`;
  if (abs >= 1e6) return `${trim((n / 1e6).toFixed(abs >= 1e8 ? 0 : abs >= 1e7 ? 1 : 2))}M`;
  if (abs >= 1e3) return `${trim((n / 1e3).toFixed(0))}K`;
  return String(Math.round(n));
}

export function formatPop(n: number, mode: NumberFormat): string {
  return mode === 'short' ? formatShort(n) : formatFull(n);
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(ratio >= 0.995 && ratio < 1 ? 2 : 1)}%`;
}
