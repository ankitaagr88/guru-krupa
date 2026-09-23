import { describe, it, expect } from 'vitest';
import { ageFromDob, ageSexLabel, dobProblem, fmtDob, parseDobCell, phoneKey } from './format';

const ON = new Date(2026, 8, 23); // 23 Sep 2026

describe('age and date of birth helpers', () => {
  it('works the age out from the DOB (birthday not yet reached counts one less)', () => {
    expect(ageFromDob('1964-03-12', ON)).toBe(62);
    expect(ageFromDob('1964-12-01', ON)).toBe(61);
    expect(ageFromDob('', ON)).toBeNull();
  });

  it('labels age and sex as "62 y · F" and formats the DOB', () => {
    expect(ageSexLabel({ age: 62, sex: 'F' })).toBe('62 y · F');
    expect(ageSexLabel({ age: null, sex: 'M' })).toBe('M');
    expect(ageSexLabel({})).toBe('—');
    expect(fmtDob('1964-03-12')).toBe('12 Mar 1964');
  });

  it('refuses a DOB in the future or more than 120 years back', () => {
    expect(dobProblem('2027-01-01', ON)).toMatch(/future/);
    expect(dobProblem('1900-01-01', ON)).toMatch(/120 years/);
    expect(dobProblem('1964-03-12', ON)).toBe('');
    expect(dobProblem('', ON)).toBe('');
  });

  it('compares phones on the last 10 digits', () => {
    expect(phoneKey('+91 98250 12345')).toBe('9825012345');
    expect(phoneKey('098250-12345')).toBe('9825012345');
  });

  it('reads DOB cells from a spreadsheet', () => {
    expect(parseDobCell('12/03/1964', ON)).toBe('1964-03-12');
    expect(parseDobCell('12-03-1964', ON)).toBe('1964-03-12');
    expect(parseDobCell('5/3/64', ON)).toBe('1964-03-05');
    expect(parseDobCell('1964-03-12', ON)).toBe('1964-03-12');
    expect(parseDobCell('23448', ON)).toBe('1964-03-12'); // Excel serial number
    expect(parseDobCell('31/02/1964', ON)).toBeNull();
    expect(parseDobCell('01/01/2030', ON)).toBeNull();
    expect(parseDobCell('not known', ON)).toBeNull();
  });
});
