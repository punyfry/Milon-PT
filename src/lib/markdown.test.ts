import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

describe('enkel markdown', () => {
	it('tolkar fet, kursiv och kod', () => {
		expect(parseInline('Kör **3 set** av *Marklyft* med `heavy`')).toEqual([
			{ text: 'Kör ' },
			{ text: '3 set', bold: true },
			{ text: ' av ' },
			{ text: 'Marklyft', italic: true },
			{ text: ' med ' },
			{ text: 'heavy', code: true }
		]);
		expect(parseInline('**fet med *kursiv***')).toEqual([
			{ text: 'fet med ', bold: true },
			{ text: 'kursiv', bold: true, italic: true }
		]);
	});

	it('lämnar ensamma tecken och understreck i ord orörda', () => {
		expect(parseInline('3 * 10 reps, pass_a och 2*3')).toEqual([{ text: '3 * 10 reps, pass_a och 2*3' }]);
	});

	it('delar upp i stycken, rubriker och listor', () => {
		const text = '## Förslag\nPass A:\nfokus ben\n\n- Knäböj 3 × 8\n- Utfall\n1. Värm upp\n2) Kör\n\n---\nKlart?';
		expect(parseMarkdown(text)).toEqual([
			{ type: 'heading', line: [{ text: 'Förslag' }] },
			{ type: 'p', lines: [[{ text: 'Pass A:' }], [{ text: 'fokus ben' }]] },
			{ type: 'ul', items: [[{ text: 'Knäböj 3 × 8' }], [{ text: 'Utfall' }]] },
			{ type: 'ol', items: [[{ text: 'Värm upp' }], [{ text: 'Kör' }]], start: 1 },
			{ type: 'p', lines: [[{ text: 'Klart?' }]] }
		]);
	});

	it('håller ihop listor med tomma rader och indragna fortsättningar', () => {
		expect(parseMarkdown('1. Uppvärmning\n\n2. Knäböj\n   3 set\n\n3. Stretch\n\nKlart')).toEqual([
			{
				type: 'ol',
				start: 1,
				items: [[{ text: 'Uppvärmning' }], [{ text: 'Knäböj' }, { text: ' ' }, { text: '3 set' }], [{ text: 'Stretch' }]]
			},
			{ type: 'p', lines: [[{ text: 'Klart' }]] }
		]);
		expect(parseMarkdown('3. Tredje')).toEqual([{ type: 'ol', start: 3, items: [[{ text: 'Tredje' }]] }]);
	});

	it('tolkar inte stjärnor mellan siffror som kursiv', () => {
		expect(parseInline('Knäböj 3*10 och 2*5 reps')).toEqual([{ text: 'Knäböj 3*10 och 2*5 reps' }]);
		expect(parseInline('5*5 med *paus*')).toEqual([{ text: '5*5 med ' }, { text: 'paus', italic: true }]);
	});

	it('hanterar avdelare, tomma punkter, årtal och kursiv med mellanslag', () => {
		expect(parseMarkdown('A\n* * *\n- - -\n- \n2024. Bra år')).toEqual([
			{ type: 'p', lines: [[{ text: 'A' }]] },
			{ type: 'p', lines: [[{ text: '- ' }], [{ text: '2024. Bra år' }]] }
		]);
		expect(parseInline('*a * och _b _')).toEqual([{ text: '*a * och _b _' }]);
	});

	it('släpper igenom HTML som vanlig text', () => {
		expect(parseMarkdown('<img src=x onerror=alert(1)>')).toEqual([
			{ type: 'p', lines: [[{ text: '<img src=x onerror=alert(1)>' }]] }
		]);
	});
});
