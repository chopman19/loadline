import data from '../data/countries.json';

export interface Country {
  name: string;
  aliases: string[];
  iso2: string;
  iso3: string;
  population: number;
  continent: 'Africa' | 'Asia' | 'Europe' | 'North America' | 'South America' | 'Oceania';
  subregion: string;
  landlocked: boolean;
  island: boolean;
  hemisphere: 'N' | 'S' | 'both';
  seas: string[];
  neighbors: string[];
  unMember: boolean;
  fact: string;
}

export const COUNTRIES = data as Country[];

const BY_ISO3 = new Map(COUNTRIES.map((c) => [c.iso3, c]));

export function byIso3(iso3: string): Country {
  const c = BY_ISO3.get(iso3);
  if (!c) throw new Error(`Unknown country ${iso3}`);
  return c;
}

export function findIso3(iso3: string): Country | undefined {
  return BY_ISO3.get(iso3);
}
