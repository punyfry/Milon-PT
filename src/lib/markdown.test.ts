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
			{ type: 'ol', items: [[{ text: 'Värm upp' }], [{ text: 'Kör' }]] },
			{ type: 'p', lines: [[{ text: 'Klart?' }]] }
		]);
	});

	it('släpper igenom HTML som vanlig text', () => {
		expect(parseMarkdown('<img src=x onerror=alert(1)>')).toEqual([
			{ type: 'p', lines: [[{ text: '<img src=x onerror=alert(1)>' }]] }
		]);
	});
});
