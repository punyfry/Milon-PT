import { describe, expect, it } from 'vitest';
import { MAX_RULES } from '$lib/model';
import { FactError, OTHER, QUESTIONS, answerFromFact, composeMessage, factValue, knownFacts, withFacts, type Answers } from './questionnaire';

const q = (id: string) => QUESTIONS.find((x) => x.id === id)!;
const none = { rules: [] };

describe('the message from the questionnaire (#102)', () => {
	it('puts the answers together and leaves skipped questions out', () => {
		const answers: Answers = {
			focus: { selected: ['ben', 'core', OTHER], other: ' rumpa ' },
			time: { selected: ['45'], other: '' },
			warmup: { selected: ['warmup'], other: '' },
			place: { selected: ['gym'], other: '' },
			avoid: { selected: [], other: 'Ont i vänster knä' },
			more: { selected: [], other: 'Gärna supersets.' }
		};
		expect(composeMessage(answers, none)).toBe(
			[
				'Hej! Hjälp mig bygga ett nytt pass.',
				'Fokus: ben, core och rumpa.',
				'Tid: 45 minuter.',
				'Ta med uppvärmning men ingen stretch.',
				'Jag tränar på gym.',
				'Undvik: Ont i vänster knä.',
				'Gärna supersets.'
			].join('\n')
		);
		expect(composeMessage({}, none)).toBe('Hej! Hjälp mig bygga ett nytt pass.');
	});

	it('uses the "Annat…" text, and ignores it when empty or not chosen', () => {
		expect(composeMessage({ intensity: { selected: [OTHER], other: 'lagom\n tufft' } }, none)).toContain('Intensitet: lagom tufft.');
		expect(composeMessage({ intensity: { selected: [OTHER], other: '  ' } }, none)).not.toContain('Intensitet');
		expect(composeMessage({ intensity: { selected: ['lugnt'], other: 'ignoreras' } }, none)).toContain('Intensitet: lugnt.');
		expect(composeMessage({ warmup: { selected: [OTHER], other: 'kort uppvärmning' } }, none)).toContain('Uppvärmning och stretch: kort uppvärmning.');
	});

	it('leaves out what Milon already knows from the profile, so nothing is said twice', () => {
		const known = { place: 'hemma med hantlar', experience: 'ny på styrketräning', rules: ['Ont i knät'] };
		const answers: Answers = {
			place: { selected: ['hantlar'], other: '' },
			experience: { selected: ['van'], other: '' },
			avoid: { selected: [], other: 'Ont i knät' }
		};
		expect(composeMessage(answers, known)).toBe('Hej! Hjälp mig bygga ett nytt pass.\nErfarenhet: van vid styrketräning.');
	});

	it('keeps the message within the builder limit', () => {
		expect(Array.from(composeMessage({ more: { selected: [], other: 'x'.repeat(3000) } }, none))).toHaveLength(2000);
	});
});

describe('answers saved to the profile (#102)', () => {
	it('reads the saved lines back and preselects them', () => {
		const known = knownFacts({ coachContext: 'Tränar: på gym\nAnnat: hej\nErfarenhet: klättrare', rules: ['Inga hopp', ' '] });
		expect(known).toEqual({ place: 'på gym', experience: 'klättrare', rules: ['Inga hopp'] });
		expect(answerFromFact(q('place'), known.place)).toEqual({ selected: ['gym'], other: '' });
		expect(answerFromFact(q('experience'), known.experience)).toEqual({ selected: [OTHER], other: 'klättrare' });
		expect(answerFromFact(q('place'), undefined)).toBeUndefined();
		expect(knownFacts({})).toEqual({ rules: [] });
	});

	it('gives the value to save for each profile question', () => {
		expect(factValue(q('place'), { selected: ['kroppsvikt'], other: '' })).toBe('bara med kroppsvikt');
		expect(factValue(q('place'), { selected: [OTHER], other: ' utomhus\n i parken ' })).toBe('utomhus i parken');
		expect(factValue(q('avoid'), { selected: [], other: '  ' })).toBeUndefined();
	});

	it('replaces its own lines in coachContext, keeps the rest, and adds a rule once', () => {
		const profile = { goals: 'Starkare', coachContext: 'Tränar med en kompis.\nTränar: på gym', rules: ['Inga hopp'] };
		const next = withFacts(profile, { place: 'hemma\nmed hantlar', experience: 'van vid styrketräning', avoid: 'Ont i knät' });
		expect(next).toEqual({
			goals: 'Starkare',
			coachContext: 'Tränar med en kompis.\nTränar: hemma med hantlar\nErfarenhet: van vid styrketräning',
			rules: ['Inga hopp', 'Ont i knät']
		});
		expect(withFacts(next, { avoid: 'Ont i knät' }).rules).toEqual(['Inga hopp', 'Ont i knät']);
		expect(withFacts({}, { experience: 'ny' })).toEqual({ coachContext: 'Erfarenhet: ny' });
		expect(withFacts(profile, {})).toEqual(profile);
	});

	it('refuses answers past the profile limits', () => {
		expect(() => withFacts({}, { place: 'x'.repeat(201) })).toThrow(FactError);
		expect(() => withFacts({}, { avoid: 'x'.repeat(301) })).toThrow(/högst 300/);
		expect(() => withFacts({ rules: Array.from({ length: MAX_RULES }, (_, i) => `r${i}`) }, { avoid: 'ny' })).toThrow(/30 regler/);
		expect(() => withFacts({ coachContext: 'x'.repeat(1990) }, { place: 'på gym' })).toThrow(/full/);
	});
});
