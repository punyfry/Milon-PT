import { describe, expect, it } from 'vitest';
import { SESSION_ABSOLUTE_SECONDS, checkSessionAge } from './session';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const nowSeconds = NOW / 1000;

describe('session age', () => {
	it('stamps the sign-in time when signing in, also over an older stamp', () => {
		expect(checkSessionAge({ userId: 'u1' }, true, NOW)).toEqual({ userId: 'u1', signedInAt: nowSeconds });
		expect(checkSessionAge({ signedInAt: 1 }, true, NOW)).toEqual({ signedInAt: nowSeconds });
	});

	it('keeps a session younger than the absolute limit', () => {
		const token = { userId: 'u1', signedInAt: nowSeconds - SESSION_ABSOLUTE_SECONDS };
		expect(checkSessionAge(token, false, NOW)).toBe(token);
	});

	it('ends a session older than the absolute limit, however much it is used', () => {
		expect(checkSessionAge({ userId: 'u1', signedInAt: nowSeconds - SESSION_ABSOLUTE_SECONDS - 1 }, false, NOW)).toBeNull();
	});

	it('stamps tokens from before the stamp existed instead of ending them', () => {
		expect(checkSessionAge({ userId: 'u1' }, false, NOW)).toEqual({ userId: 'u1', signedInAt: nowSeconds });
		expect(checkSessionAge({ userId: 'u1', signedInAt: 'x' }, false, NOW)).toEqual({ userId: 'u1', signedInAt: nowSeconds });
	});
});
