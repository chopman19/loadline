// Expands scripts/country-source.ts into src/data/countries.json and validates it.
// Run with: npm run data
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ROWS, SUBREGIONS, SEAS, TERRITORIES } from './country-source';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors: string[] = [];

const countries = ROWS.map(([name, iso2, iso3, pop, sub, tags, seas, neighbors, aliases, fact]) => {
  const region = SUBREGIONS[sub];
  if (!region) errors.push(`${name}: unknown subregion ${sub}`);
  const south = tags.includes('S');
  const equator = tags.includes('E');
  return {
    name,
    aliases: aliases ? aliases.split('|') : [],
    iso2,
    iso3,
    population: Math.max(1000, Math.round(pop / 1000) * 1000),
    continent: region?.[0] ?? '',
    subregion: region?.[1] ?? '',
    landlocked: tags.includes('L'),
    island: tags.includes('I'),
    hemisphere: equator ? 'both' : south ? 'S' : 'N',
    seas: [...seas].map((s) => {
      if (!SEAS[s]) errors.push(`${name}: unknown sea ${s}`);
      return SEAS[s];
    }),
    neighbors: neighbors ? neighbors.split(' ') : [],
    unMember: !TERRITORIES.includes(iso3),
    fact,
  };
});

const byIso3 = new Map(countries.map((c) => [c.iso3, c]));
const seen = new Set<string>();
for (const c of countries) {
  for (const key of [c.iso2, c.iso3, c.name]) {
    if (seen.has(key)) errors.push(`duplicate key ${key}`);
    seen.add(key);
  }
  for (const n of c.neighbors) {
    const other = byIso3.get(n);
    if (!other) errors.push(`${c.name}: unknown neighbour ${n}`);
    else if (!other.neighbors.includes(c.iso3)) errors.push(`${c.name} -> ${other.name} border is not mutual`);
  }
  if (c.landlocked && c.seas.some((s) => s !== 'Caspian Sea')) errors.push(`${c.name}: landlocked but has seas`);
  if (c.island && c.landlocked) errors.push(`${c.name}: island and landlocked`);
  if (!existsSync(join(root, 'node_modules/flag-icons/flags/4x3', `${c.iso2.toLowerCase()}.svg`))) {
    errors.push(`${c.name}: no flag-icons SVG for ${c.iso2}`);
  }
  if (!c.fact.endsWith('.')) errors.push(`${c.name}: fact should be a sentence`);
}

const unCount = countries.filter((c) => c.unMember).length;
if (unCount !== 193) errors.push(`expected 193 UN member states, found ${unCount}`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

countries.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(join(root, 'src/data/countries.json'), JSON.stringify(countries, null, 1) + '\n');
console.log(`Wrote ${countries.length} countries (${unCount} UN members) to src/data/countries.json`);
