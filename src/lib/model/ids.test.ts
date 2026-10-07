import { describe, expect, it } from 'vitest';
import { exerciseIdBase, normalizeName, parseWorkoutFileName, sessionIdFor, slugify, uniqueId } from './ids';

describe('ids', () => {
	it('slugifies Swedish names', () => {
		expect(slugify('Pass B')).toBe('pass-b');
		expect(slugify('  Böj & sträck  ')).toBe('boj-strack');
		expect(exerciseIdBase('Marklyft')).toBe('ex_marklyft');
		expect(exerciseIdBase('Hantelpress, sittande')).toBe('ex_hantelpress_sittande');
		expect(exerciseIdBase('!!!')).toBe('ex_ovning');
	});

	it('finds free ids', () => {
		expect(uniqueId('ex_a', new Set())).toBe('ex_a');
		expect(uniqueId('ex_a', new Set(['ex_a', 'ex_a_2']))).toBe('ex_a_3');
		expect(sessionIdFor('2026-10-06', new Set(['s_20261006']))).toBe('s_20261006_2');
	});

	it('matches names regardless of case and whitespace', () => {
		expect(normalizeName('  Pull-Up ')).toBe(normalizeName('pull-up'));
		expect(normalizeName('Böj  och sträck')).toBe(normalizeName('böj och Sträck'));
		expect(normalizeName('Bröstpress')).not.toBe(normalizeName('Brostpress'));
	});

	it('parses workout version file names', () => {
		expect(parseWorkoutFileName('pass-b.v12.json')).toEqual({ slug: 'pass-b', version: 12 });
		expect(parseWorkoutFileName('pass-b.json')).toBeNull();
	});
});
