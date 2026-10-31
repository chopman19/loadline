// Manifest rules: each day's puzzle uses one of these to limit which countries may board.
// To add a rule, append an entry. `test` decides eligibility; `why` explains a rejection
// in a short, friendly sentence (it receives a country that failed `test`).
import type { Country } from '../core/countries';
import { normalize } from '../core/match';

export interface ManifestRule {
  id: string;
  /** Shown on the manifest card, e.g. "Only African ports". */
  text: string;
  /** One-line explanation under the rule. */
  detail: string;
  test: (c: Country) => boolean;
  why: (c: Country) => string;
}

const letters = (c: Country) => normalize(c.name).replace(/[^a-z]/g, '');

function continentRule(id: string, text: string, continents: Country['continent'][], label: string): ManifestRule {
  return {
    id,
    text,
    detail: `Every container must ship from ${label}.`,
    test: (c) => continents.includes(c.continent),
    why: (c) => `${c.name} sails from ${c.continent}, not ${label}.`,
  };
}

function letterRule(letter: string): ManifestRule {
  return {
    id: `starts-${letter.toLowerCase()}`,
    text: `Names starting with ${letter}`,
    detail: `Only countries whose name begins with ${letter}.`,
    test: (c) => letters(c).startsWith(letter.toLowerCase()),
    why: (c) => `${c.name} doesn't start with ${letter}.`,
  };
}

function bordersRule(iso3: string, name: string): ManifestRule {
  return {
    id: `borders-${iso3.toLowerCase()}`,
    text: `Neighbours of ${name}`,
    detail: `Only countries sharing a land border with ${name}.`,
    test: (c) => c.neighbors.includes(iso3),
    why: (c) => (c.iso3 === iso3 ? `${name} can't be its own neighbour.` : `${c.name} doesn't share a land border with ${name}.`),
  };
}

function seaRule(id: string, text: string, sea: string): ManifestRule {
  return {
    id,
    text,
    detail: `Only countries with a coast on the ${sea}.`,
    test: (c) => c.seas.includes(sea),
    why: (c) => `${c.name} has no ${sea} coast.`,
  };
}

function subregionRule(id: string, text: string, subregions: string[], label: string): ManifestRule {
  return {
    id,
    text,
    detail: `Only countries in ${label}.`,
    test: (c) => subregions.includes(c.subregion),
    why: (c) => `${c.name} isn't in ${label}.`,
  };
}

const MIDDLE_EAST = ['BHR','EGY', 'IRN', 'IRQ', 'ISR', 'JOR', 'KWT', 'LBN', 'OMN', 'PSE', 'QAT', 'SAU', 'SYR', 'TUR', 'ARE', 'YEM'];

export const RULES: ManifestRule[] = [
  {
    id: 'open',
    text: 'Open cargo',
    detail: 'No restrictions today. Any country may board.',
    test: () => true,
    why: () => '',
  },
  continentRule('africa', 'Only African ports', ['Africa'], 'Africa'),
  continentRule('europe', 'Only European ports', ['Europe'], 'Europe'),
  continentRule('asia', 'Only Asian ports', ['Asia'], 'Asia'),
  continentRule('americas', 'Only ports in the Americas', ['North America', 'South America'], 'the Americas'),
  continentRule('south-america', 'Only South American ports', ['South America'], 'South America'),
  continentRule('oceania', 'Only Oceania ports', ['Oceania'], 'Oceania'),
  {
    id: 'under-30m',
    text: 'No country over 30M',
    detail: 'Every country must have 30 million people or fewer.',
    test: (c) => c.population <= 30_000_000,
    why: (c) => `${c.name} is too heavy: over 30M.`,
  },
  {
    id: 'under-10m',
    text: 'No country over 10M',
    detail: 'Every country must have 10 million people or fewer.',
    test: (c) => c.population <= 10_000_000,
    why: (c) => `${c.name} is too heavy: over 10M.`,
  },
  {
    id: 'over-25m',
    text: 'Heavy cargo only: over 25M',
    detail: 'Every country must have more than 25 million people.',
    test: (c) => c.population > 25_000_000,
    why: (c) => `${c.name} is too light: under 25M.`,
  },
  letterRule('B'),
  letterRule('S'),
  letterRule('M'),
  letterRule('C'),
  letterRule('G'),
  letterRule('T'),
  letterRule('P'),
  letterRule('A'),
  {
    id: 'landlocked',
    text: 'Landlocked countries only',
    detail: 'Only countries with no ocean coastline. (Yes, really, on a ship.)',
    test: (c) => c.landlocked,
    why: (c) => `${c.name} has a coastline, so it's not landlocked.`,
  },
  {
    id: 'island',
    text: 'Island nations',
    detail: 'Only countries made up entirely of islands.',
    test: (c) => c.island,
    why: (c) => `${c.name} isn't an island nation.`,
  },
  {
    id: 'southern',
    text: 'Southern hemisphere',
    detail: 'Only countries with land south of the Equator.',
    test: (c) => c.hemisphere !== 'N',
    why: (c) => `${c.name} lies entirely north of the Equator.`,
  },
  {
    id: 'equator',
    text: 'The Equator runs through it',
    detail: 'Only countries the Equator crosses.',
    test: (c) => c.hemisphere === 'both',
    why: (c) => `The Equator doesn't cross ${c.name}.`,
  },
  seaRule('mediterranean', 'Countries bordering the Mediterranean', 'Mediterranean Sea'),
  seaRule('baltic', 'Baltic Sea ports', 'Baltic Sea'),
  seaRule('red-sea', 'Red Sea ports', 'Red Sea'),
  seaRule('indian-ocean', 'Indian Ocean ports', 'Indian Ocean'),
  seaRule('pacific', 'Pacific Rim ports', 'Pacific Ocean'),
  bordersRule('CHN', 'China'),
  bordersRule('RUS', 'Russia'),
  bordersRule('BRA', 'Brazil'),
  bordersRule('DEU', 'Germany'),
  bordersRule('TZA', 'Tanzania'),
  subregionRule('southeast-asia', 'Southeast Asian ports', ['South-eastern Asia'], 'Southeast Asia'),
  subregionRule('west-africa', 'West African ports', ['Western Africa'], 'West Africa'),
  subregionRule('east-africa', 'East African ports', ['Eastern Africa'], 'East Africa'),
  subregionRule('caribbean-central', 'Central America & Caribbean', ['Central America', 'Caribbean'], 'Central America or the Caribbean'),
  {
    id: 'middle-east',
    text: 'Middle Eastern ports',
    detail: 'Only countries in the Middle East.',
    test: (c) => MIDDLE_EAST.includes(c.iso3),
    why: (c) => `${c.name} isn't in the Middle East.`,
  },
  {
    id: 'contains-land',
    text: "Names containing 'LAND'",
    detail: "Only countries with 'land' somewhere in the name.",
    test: (c) => letters(c).includes('land'),
    why: (c) => `There's no 'land' in ${c.name}.`,
  },
  {
    id: 'ends-ia',
    text: "Names ending in '-IA'",
    detail: "Only countries whose name ends in 'ia'.",
    test: (c) => letters(c).endsWith('ia'),
    why: (c) => `${c.name} doesn't end in '-ia'.`,
  },
  {
    id: 'short-name',
    text: 'Five letters or fewer',
    detail: "Only countries whose name has at most five letters (like Peru or Chile).",
    test: (c) => letters(c).length <= 5,
    why: (c) => `${c.name} has ${letters(c).length} letters. Too long for today's labels.`,
  },
  {
    id: 'multi-word',
    text: 'Names of two words or more',
    detail: "Only countries whose name has more than one word (like Sri Lanka).",
    test: (c) => c.name.includes(' '),
    why: (c) => `${c.name} is a single word.`,
  },
];

export const RULES_BY_ID = new Map(RULES.map((r) => [r.id, r]));

export function getRule(id: string): ManifestRule {
  const r = RULES_BY_ID.get(id);
  if (!r) throw new Error(`Unknown rule ${id}`);
  return r;
}
