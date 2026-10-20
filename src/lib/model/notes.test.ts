import { describe, expect, it } from 'vitest';
import { MAX_GOALS, MAX_RULES } from './validate';
import { coachNotes, notesDiff, parseNotes, sameNotes, withNotes } from './notes';

const empty = { goals: [], rules: [], context: [] };

describe('what Milon knows (#110)', () => {
	it('reads goals, rules and context lines, one line each, without empty ones', () => {
		expect(
			coachNotes({ goals: 'Starkare rygg\n\nOrka 10 armhävningar', rules: ['Inga hopp', '  ', 'Ont\ni knät'], coachContext: 'Tränar: på gym\n\n  Erfarenhet: ny ' })
		).toEqual({
			goals: ['Starkare rygg', 'Orka 10 armhävningar'],
			rules: ['Inga hopp', 'Ont i knät'],
			context: ['Tränar: på gym', 'Erfarenhet: ny']
		});
		expect(coachNotes({})).toEqual(empty);
		// Duplicates are read once, as parseNotes reads them, so a stored profile compares equal to a checked proposal.
		const dup = coachNotes({ goals: 'x\nx', rules: ['Inga hopp', 'Inga  hopp'], coachContext: 'a\na' });
		expect(dup).toEqual({ goals: ['x'], rules: ['Inga hopp'], context: ['a'] });
		expect(sameNotes(dup, parseNotes(dup))).toBe(true);
	});

	it('reads a list marker of its own as part of the line', () => {
		expect(coachNotes({ goals: '- Starkare\n• Snabbare\n-1 kg', rules: ['- Inga hopp'] })).toMatchObject({
			goals: ['Starkare', 'Snabbare', '-1 kg'],
			rules: ['Inga hopp']
		});
	});

	it('only rewrites the lists that changed, so an imported text is kept as it was', () => {
		const profile = { goals: '  - Starkare rygg\n\n  - Orka mer', rules: ['a', 'b'], coachContext: 'x\ny' };
		const notes = coachNotes(profile);
		expect(withNotes(profile, { ...notes, rules: ['a'] })).toEqual({ ...profile, rules: ['a'] });
		expect(withNotes(profile, { ...notes, goals: ['Starkare rygg'] })).toEqual({ ...profile, goals: 'Starkare rygg' });
		expect(withNotes(profile, notes)).toEqual(profile);
	});

	it('writes them back and leaves the rest of the profile alone', () => {
		const profile = { weeklySessionGoal: 3, goals: 'g', rules: ['a'], coachContext: 'b' };
		expect(withNotes(profile, { goals: ['g1', 'g2'], rules: ['x'], context: ['y', 'z'] })).toEqual({
			weeklySessionGoal: 3,
			goals: 'g1\ng2',
			rules: ['x'],
			coachContext: 'y\nz'
		});
		expect(withNotes(profile, empty)).toEqual({ weeklySessionGoal: 3 });
		expect(sameNotes(coachNotes(profile), { goals: ['g'], rules: ['a'], context: ['b'] })).toBe(true);
	});

	it('checks notes from the client or Milon', () => {
		expect(parseNotes({ goals: ['g'], rules: [' a ', 'a', ''], context: ['b\nc'] })).toEqual({ goals: ['g'], rules: ['a'], context: ['b c'] });
		expect(() => parseNotes({ goals: [], rules: 'a', context: [] })).toThrow(/Regler måste vara en lista/);
		expect(() => parseNotes({ rules: [], context: [] })).toThrow(/Mål måste vara en lista/);
		expect(() => parseNotes({ goals: [], rules: [1], context: [] })).toThrow(/Regler/);
		expect(() => parseNotes(null)).toThrow(/Mål[\s\S]*Regler[\s\S]*Om dig/);
		expect(() => parseNotes({ ...empty, rules: Array.from({ length: MAX_RULES + 1 }, (_, i) => `r${i}`) })).toThrow(/högst 30 rader/);
		expect(() => parseNotes({ ...empty, rules: ['x'.repeat(301)] })).toThrow(/högst 300 tecken/);
		// Goals and context have no line limit, like the import: 40 short goals are fine.
		expect(parseNotes({ ...empty, goals: Array.from({ length: 40 }, (_, i) => `g${i}`) }).goals).toHaveLength(40);
		const long = Array.from({ length: 8 }, (_, i) => 'x'.repeat(290) + i);
		expect(() => parseNotes({ ...empty, context: long })).toThrow(new RegExp(`Om dig får vara högst ${MAX_GOALS} tecken`));
		expect(() => parseNotes({ ...empty, goals: long })).toThrow(new RegExp(`Mål får vara högst ${MAX_GOALS} tecken`));
		// A goal or context line from the free-text profile may be longer than a rule.
		expect(parseNotes({ ...empty, goals: ['x'.repeat(500)] }).goals[0]).toHaveLength(500);
	});

	it('tells what a proposal changes', () => {
		expect(notesDiff({ goals: ['g'], rules: ['a', 'b'], context: ['c'] }, { goals: [], rules: ['b', 'd'], context: ['c'] })).toEqual({
			goals: { removed: ['g'], added: [] },
			rules: { removed: ['a'], added: ['d'] },
			context: { removed: [], added: [] }
		});
	});
});
