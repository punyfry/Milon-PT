import { describe, expect, it } from 'vitest';
import { stockholmIso, stockholmOffset } from './time';

describe('stockholmIso', () => {
	it('uses the offset in force at that wall time, also on the days the clocks change', () => {
		expect(stockholmOffset('2026-07-01')).toBe('+02:00');
		expect(stockholmIso('2026-07-01', '18:00')).toBe('2026-07-01T18:00:00+02:00');
		expect(stockholmIso('2026-01-10', '07:15')).toBe('2026-01-10T07:15:00+01:00');
		// Clocks go forward at 02:00 on 29 March 2026, back at 03:00 on 25 October.
		expect(stockholmIso('2026-03-29', '01:30')).toBe('2026-03-29T01:30:00+01:00');
		expect(stockholmIso('2026-03-29', '03:30')).toBe('2026-03-29T03:30:00+02:00');
		expect(stockholmIso('2026-10-25', '01:30')).toBe('2026-10-25T01:30:00+02:00');
		expect(stockholmIso('2026-10-25', '04:00')).toBe('2026-10-25T04:00:00+01:00');
	});
});
