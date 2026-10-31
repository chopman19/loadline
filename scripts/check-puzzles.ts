// Generates the next 365 daily puzzles (from today's voyage) and checks each one:
//   * the optimal load reaches >= 99.5% of the target without going over
//   * the optimal load obeys the rule and the hold size
//   * loading the biggest eligible countries first falls short (< 98.5%)
// Usage: npm run puzzles [-- --from <voyage> --days <n> --verbose]
import { dailyPuzzle, eligibleFor, MAX_GREEDY_RATIO, MIN_BEST_RATIO } from '../src/core/puzzle';
import { dayNumber, formatDayDate } from '../src/core/daily';
import { byIso3 } from '../src/core/countries';
import { getRule } from '../src/data/rules';
import { solve } from '../src/core/solver';

const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const from = arg('--from', dayNumber());
const days = arg('--days', 365);
const verbose = args.includes('--verbose');

const failures: string[] = [];
const ruleCounts = new Map<string, number>();
const holdCounts = new Map<number, number>();
let perfectPossible = 0;
const t0 = performance.now();

for (let day = from; day < from + days; day++) {
  const p = dailyPuzzle(day);
  const rule = getRule(p.ruleId);
  const picks = p.optimal.iso3.map(byIso3);
  const total = picks.reduce((s, c) => s + c.population, 0);
  const ratio = total / p.target;
  const fail = (msg: string) => failures.push(`#${day}: ${msg}`);

  if (total !== p.optimal.total) fail(`optimal total mismatch ${total} vs ${p.optimal.total}`);
  if (total > p.target) fail('optimal load sinks the ship');
  if (ratio < MIN_BEST_RATIO) fail(`optimal only reaches ${(ratio * 100).toFixed(2)}%`);
  if (picks.length > p.hold) fail('optimal load overflows the hold');
  if (new Set(p.optimal.iso3).size !== picks.length) fail('optimal load repeats a country');
  if (!picks.every(rule.test)) fail('optimal load breaks the manifest rule');
  if (p.greedy / p.target >= MAX_GREEDY_RATIO) fail('biggest-first solves it');
  // Independent re-solve as a cross-check.
  const eligible = eligibleFor(rule);
  const again = solve(eligible.map((c) => c.population), p.hold, p.target);
  if (again.total !== p.optimal.total) fail(`re-solve disagrees: ${again.total}`);
  if (Math.round((1000 * total) / p.target) === 1000) perfectPossible++;

  ruleCounts.set(p.ruleId, (ruleCounts.get(p.ruleId) ?? 0) + 1);
  holdCounts.set(p.hold, (holdCounts.get(p.hold) ?? 0) + 1);
  if (verbose) {
    console.log(
      `#${day} ${formatDayDate(day).padEnd(12)} ${rule.text.padEnd(38)} hold ${p.hold}  target ${p.target.toLocaleString('en-US').padStart(13)}` +
        `  best ${(ratio * 100).toFixed(2)}%  greedy ${((p.greedy / p.target) * 100).toFixed(1)}%  [${p.optimal.iso3.join(' ')}]`,
    );
  }
}

const ms = performance.now() - t0;
console.log(`Checked voyages #${from}-#${from + days - 1} in ${(ms / 1000).toFixed(1)}s (${(ms / days).toFixed(0)} ms each).`);
console.log(`Hold sizes: ${[...holdCounts].sort().map(([h, n]) => `${h}:${n}`).join('  ')}`);
console.log(`Rules used: ${ruleCounts.size}; a Perfect Trim (1000) is possible on ${perfectPossible}/${days} days.`);
if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('All puzzles OK.');
