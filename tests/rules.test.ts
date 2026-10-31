import { describe, expect, it } from 'vitest';
import { RULES, getRule } from '../src/data/rules';
import { COUNTRIES, byIso3 } from '../src/core/countries';

const allowed = (ruleId: string, iso3: string) => getRule(ruleId).test(byIso3(iso3));

describe('manifest rules', () => {
  it('have unique ids, text and enough eligible countries', () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    for (const r of RULES) {
      expect(r.text.length).toBeGreaterThan(3);
      expect(COUNTRIES.filter(r.test).length).toBeGreaterThanOrEqual(6);
    }
  });

  it('explain every rejection', () => {
    for (const r of RULES) {
      for (const c of COUNTRIES.filter((c) => !r.test(c))) {
        expect(r.why(c)).toMatch(/\.$/);
        expect(r.why(c)).not.toMatch(/\d{2},\d{3}/); // never leak an exact population
      }
    }
  });

  it('filter continents', () => {
    expect(allowed('africa', 'EGY')).toBe(true);
    expect(allowed('africa', 'BRA')).toBe(false);
    expect(allowed('americas', 'MEX')).toBe(true);
    expect(allowed('americas', 'ESP')).toBe(false);
    expect(allowed('oceania', 'FJI')).toBe(true);
    expect(getRule('africa').why(byIso3('BRA'))).toBe('Brazil sails from South America, not Africa.');
  });

  it('filter by population', () => {
    expect(allowed('under-30m', 'NPL')).toBe(true); // 29.6M
    expect(allowed('under-30m', 'CMR')).toBe(false); // 30.6M
    expect(allowed('under-10m', 'TGO')).toBe(true);
    expect(allowed('under-10m', 'SWE')).toBe(false);
    expect(allowed('over-25m', 'IND')).toBe(true);
    expect(allowed('over-25m', 'CHL')).toBe(false);
  });

  it('filter by first letter, ignoring accents', () => {
    expect(allowed('starts-b', 'BRA')).toBe(true);
    expect(allowed('starts-b', 'BEL')).toBe(true);
    expect(allowed('starts-c', 'CIV')).toBe(true);
    expect(allowed('starts-s', 'STP')).toBe(true);
    expect(allowed('starts-b', 'ARG')).toBe(false);
  });

  it('filter geography', () => {
    expect(allowed('landlocked', 'BOL')).toBe(true);
    expect(allowed('landlocked', 'KAZ')).toBe(true);
    expect(allowed('landlocked', 'PER')).toBe(false);
    expect(allowed('island', 'JPN')).toBe(true);
    expect(allowed('island', 'AUS')).toBe(false);
    expect(allowed('mediterranean', 'ITA')).toBe(true);
    expect(allowed('mediterranean', 'PRT')).toBe(false);
    expect(allowed('southern', 'ARG')).toBe(true);
    expect(allowed('southern', 'IDN')).toBe(true);
    expect(allowed('southern', 'KEN')).toBe(true);
    expect(allowed('southern', 'MEX')).toBe(false);
    expect(allowed('equator', 'ECU')).toBe(true);
    expect(allowed('equator', 'PER')).toBe(false);
    expect(allowed('borders-chn', 'NPL')).toBe(true);
    expect(allowed('borders-chn', 'CHN')).toBe(false);
    expect(allowed('borders-chn', 'JPN')).toBe(false);
    expect(allowed('pacific', 'CHL')).toBe(true);
    expect(allowed('indian-ocean', 'IND')).toBe(true);
  });

  it('filter name shapes', () => {
    expect(allowed('contains-land', 'FIN')).toBe(true);
    expect(allowed('contains-land', 'SLB')).toBe(true);
    expect(allowed('ends-ia', 'ZMB')).toBe(true);
    expect(allowed('short-name', 'PER')).toBe(true);
    expect(allowed('short-name', 'FRA')).toBe(false);
    expect(allowed('multi-word', 'LKA')).toBe(true);
    expect(allowed('multi-word', 'GNB')).toBe(false);
  });
});

describe('country data', () => {
  it('has sane populations for the largest countries', () => {
    const top = COUNTRIES.slice().sort((a, b) => b.population - a.population).slice(0, 5).map((c) => c.iso3);
    expect(top).toEqual(['IND', 'CHN', 'USA', 'IDN', 'PAK']);
    for (const c of COUNTRIES) {
      expect(c.population % 1000).toBe(0);
      expect(c.population).toBeGreaterThan(0);
    }
  });
});
