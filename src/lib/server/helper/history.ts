import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { HelperTurn } from './ask';

/**
 * The helper keeps no conversation on the server: the client sends back the
 * earlier questions and answers with each question. To stop a client from
 * inventing what Milon said, the server signs the history it returns, and a
 * history whose signature doesn't match is not sent to the model.
 *
 * The signature covers the user and the workout, so a history can't be
 * moved to another account or another workout.
 */
function key(): string {
	if (!env.AUTH_SECRET) throw new Error('AUTH_SECRET is missing');
	return env.AUTH_SECRET;
}

export function signHistory(userId: string, workoutSlug: string, history: readonly HelperTurn[]): string {
	return createHmac('sha256', key())
		.update('milon-pt helper history\n')
		.update(JSON.stringify([userId, workoutSlug, history]))
		.digest('base64url');
}

export function verifyHistory(userId: string, workoutSlug: string, history: readonly HelperTurn[], token: string): boolean {
	const expected = Buffer.from(signHistory(userId, workoutSlug, history));
	const given = Buffer.from(token);
	return given.length === expected.length && timingSafeEqual(given, expected);
}
