import { describe, expect, it } from 'vitest';
import { MAX_GOALS, MAX_RULES } from './validate';
import { MAX_CONTEXT_LINES, coachNotes, notesDiff, parseNotes, sameNotes, withNotes } from './notes';

describe('what Milon knows (#110)', () => {
	it('reads rules and context lines, one line each, without empty ones', () => {
		expect(coachNotes({ rules: ['Inga hopp', '  ', 'Ont\ni knät'], coachContext: 'Tränar: på gym\n\n  Erfarenhet: ny ' })).toEqual({
			rules: ['Inga hopp', 'Ont i knät'],
			context: ['Tränar: på gym', 'Erfarenhet: ny']
		});
		expect(coachNotes({})).toEqual({ rules: [], context: [] });
	});

	it('writes them back and leaves the rest of the profile alone', () => {
		const profile = { goals: 'Starkare', rules: ['a'], coachContext: 'b' };
		expect(withNotes(profile, { rules: ['x'], context: ['y', 'z'] })).toEqual({ goals: 'Starkare', rules: ['x'], coachContext: 'y\nz' });
		expect(withNotes(profile, { rules: [], context: [] })).toEqual({ goals: 'Starkare' });
		expect(sameNotes(coachNotes(profile), { rules: ['a'], context: ['b'] })).toBe(true);
	});

	it('checks notes from the client or Milon', () => {
		expect(parseNotes({ rules: [' a ', 'a', ''], context: ['b\nc'] })).toEqual({ rules: ['a'], context: ['b c'] });
		expect(() => parseNotes({ rules: 'a', context: [] })).toThrow(/Regler måste vara en lista/);
		expect(() => parseNotes({ rules: [1], context: [] })).toThrow(/Regler/);
		expect(() => parseNotes(null)).toThrow(/Regler[\s\S]*Om dig/);
		expect(() => parseNotes({ rules: Array.from({ length: MAX_RULES + 1 }, (_, i) => `r${i}`), context: [] })).toThrow(/högst 30 rader/);
		expect(() => parseNotes({ rules: ['x'.repeat(301)], context: [] })).toThrow(/högst 300 tecken/);
		expect(() => parseNotes({ rules: [], context: Array.from({ length: MAX_CONTEXT_LINES + 1 }, (_, i) => `c${i}`) })).toThrow(/Om dig/);
		expect(() => parseNotes({ rules: [], context: Array.from({ length: 8 }, () => 'x'.repeat(290)).map((x, i) => x + i) })).toThrow(
			new RegExp(`högst ${MAX_GOALS} tecken`)
		);
	});

	it('tells what a proposal changes', () => {
		expect(notesDiff({ rules: ['a', 'b'], context: ['c'] }, { rules: ['b', 'd'], context: ['c'] })).toEqual({
			rules: { removed: ['a'], added: ['d'] },
			context: { removed: [], added: [] }
		});
	});
});
