import { describe, expect, it } from 'vitest';
import { editDistance, normalize, resolve, search } from '../src/core/match';

const iso = (q: string) => resolve(q)?.iso3 ?? null;

describe('country name matcher', () => {
  it('normalizes accents, case, punctuation and "the"', () => {
    expect(normalize("Côte d'Ivoire")).toBe('cote divoire');
    expect(normalize('  The Gambia ')).toBe('gambia');
    expect(normalize('São Tomé & Príncipe')).toBe('sao tome and principe');
    expect(normalize('St. Lucia')).toBe('saint lucia');
  });

  it('matches exact names case-insensitively', () => {
    expect(iso('france')).toBe('FRA');
    expect(iso('NIGER')).toBe('NER');
    expect(iso('Nigeria')).toBe('NGA');
    expect(iso('Dominica')).toBe('DMA');
    expect(iso('Guinea')).toBe('GIN');
  });

  it('handles common aliases', () => {
    expect(iso('USA')).toBe('USA');
    expect(iso('US')).toBe('USA');
    expect(iso('America')).toBe('USA');
    expect(iso('UK')).toBe('GBR');
    expect(iso('Great Britain')).toBe('GBR');
    expect(iso('Czechia')).toBe('CZE');
    expect(iso('Czech Republic')).toBe('CZE');
    expect(iso('Ivory Coast')).toBe('CIV');
    expect(iso("Côte d'Ivoire")).toBe('CIV');
    expect(iso('Burma')).toBe('MMR');
    expect(iso('Holland')).toBe('NLD');
    expect(iso('DRC')).toBe('COD');
    expect(iso('East Timor')).toBe('TLS');
    expect(iso('Swaziland')).toBe('SWZ');
    expect(iso('Türkiye')).toBe('TUR');
    expect(iso('Korea')).toBe('KOR');
    expect(iso('Macedonia')).toBe('MKD');
    expect(iso('Cape Verde')).toBe('CPV');
    expect(iso('St Kitts')).toBe('KNA');
  });

  it('is accent-insensitive both ways', () => {
    expect(iso('Cote dIvoire')).toBe('CIV');
    expect(iso('sao tome')).toBe('STP');
    expect(iso('Turkiye')).toBe('TUR');
    expect(iso('Mexico')).toBe('MEX');
    expect(iso('méxico')).toBe('MEX');
  });

  it('accepts ISO alpha-3 codes', () => {
    expect(iso('DEU')).toBe('DEU');
    expect(iso('bra')).toBe('BRA');
  });

  it('tolerates small typos', () => {
    expect(iso('Brazl')).toBe('BRA');
    expect(iso('Phillipines')).toBe('PHL');
    expect(iso('Kazakstan')).toBe('KAZ');
    expect(iso('Columbia')).toBe('COL');
    expect(iso('Argentinia')).toBe('ARG');
    expect(iso('Zimbawe')).toBe('ZWE');
  });

  it('completes prefixes, biggest first on ties', () => {
    const names = search('ger').map((s) => s.country.name);
    expect(names[0]).toBe('Germany');
    expect(search('new').map((s) => s.country.name)).toEqual(expect.arrayContaining(['New Zealand', 'Papua New Guinea']));
    expect(search('south').slice(0, 3).map((s) => s.country.iso3)).toEqual(expect.arrayContaining(['ZAF', 'KOR', 'SSD']));
    expect(search('nige').map((s) => s.country.iso3).slice(0, 2)).toEqual(['NER', 'NGA']);
  });

  it('rejects nonsense', () => {
    expect(resolve('xyzzy')).toBeNull();
    expect(resolve('')).toBeNull();
    expect(resolve('Atlantis')).toBeNull();
  });

  it('computes edit distance with transpositions', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('ab', 'ba')).toBe(1);
    expect(editDistance('same', 'same')).toBe(0);
  });
});
