import { describe, expect, it } from 'vitest';
import { firstName, formatDuration } from './format';

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

describe('formatDuration', () => {
	it('shows minutes, hours and days', () => {
		expect(formatDuration(55 * 60_000)).toBe('55 min');
		expect(formatDuration(60 * 60_000)).toBe('1 h');
		expect(formatDuration(80 * 60_000)).toBe('1 h 20 min');
		expect(formatDuration(51 * 3600_000)).toBe('2 d 3 h');
		expect(formatDuration(48 * 3600_000)).toBe('2 d');
		expect(formatDuration(-5)).toBe('0 min');
	});
});
