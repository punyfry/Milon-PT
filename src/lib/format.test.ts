import { describe, expect, it } from 'vitest';
import { firstName } from './format';

describe('firstName', () => {
	it('takes the first word and trims whitespace', () => {
		expect(firstName('  Sofie  Andersson ')).toBe('Sofie');
		expect(firstName('Sofie')).toBe('Sofie');
	});

	it('is null without a name', () => {
		expect(firstName(null)).toBeNull();
		expect(firstName(undefined)).toBeNull();
		expect(firstName('   ')).toBeNull();
	});
});
