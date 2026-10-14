import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_SESSION_KEY, type ActiveSession } from '$lib/model';
import { pendingKey, pendingSaves, queueSave } from './outbox';
import { clearActiveSession, clearUserData, loadActiveSession, saveActiveSession } from './storage';

let store: Map<string, string>;
beforeEach(() => {
	store = new Map();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k)
	});
});

const session: ActiveSession = {
	sessionId: 's_20261013',
	workoutSlug: 'pass-a',
	workoutVersion: 1,
	startedAt: '2026-10-13T17:00:00+02:00',
	lastActivityAt: '2026-10-13T17:10:00+02:00',
	exercises: [],
	deviations: []
};

describe('active session per account', () => {
	it('is only shown to the account that saved it', () => {
		saveActiveSession(session, 'u1');
		expect(loadActiveSession('u1')).toEqual(session);
		expect(loadActiveSession('u2')).toBeNull();
		expect(loadActiveSession(null)).toBeNull();
		// Hidden from another account, not deleted.
		expect(loadActiveSession('u1')).toEqual(session);
	});

	it('lets the first account take over a session saved before the owner was stored', () => {
		store.set(ACTIVE_SESSION_KEY, JSON.stringify(session));
		expect(loadActiveSession('u1')).toEqual(session);
		expect(loadActiveSession('u2')).toBeNull();
	});

	it('forgets the owner with the session', () => {
		saveActiveSession(session, 'u1');
		clearActiveSession();
		expect(store.size).toBe(0);
	});

	it('ignores a broken session without taking it over', () => {
		store.set(ACTIVE_SESSION_KEY, '{broken');
		expect(loadActiveSession('u1')).toBeNull();
		expect(store.has('milonpt.activeSessionOwner')).toBe(false);
	});
});

const queued = (id: string, userId: string) => ({ key: pendingKey(id, session.startedAt), userId, workoutName: 'Pass', body: {} });

describe('sign-out', () => {
	it("empties the account's active session and unsent workouts, but keeps the theme", () => {
		store.set('milonpt.theme', 'dark');
		saveActiveSession(session, 'u1');
		queueSave(queued('s1', 'u1'));
		clearUserData('u1');
		expect(loadActiveSession('u1')).toBeNull();
		expect(pendingSaves('u1')).toEqual([]);
		expect([...store.keys()]).toEqual(['milonpt.theme']);
	});

	it("leaves another account's active session and unsent workouts alone", () => {
		saveActiveSession(session, 'u1');
		queueSave(queued('s1', 'u1'));
		queueSave(queued('s2', 'u2'));
		clearUserData('u2');
		expect(loadActiveSession('u1')).toEqual(session);
		expect(pendingSaves('u1')).toHaveLength(1);
		expect(pendingSaves('u2')).toEqual([]);
	});

	it('clears a session from before the owner was stored, and nothing without an account', () => {
		store.set(ACTIVE_SESSION_KEY, JSON.stringify(session));
		clearUserData(null);
		expect(store.has(ACTIVE_SESSION_KEY)).toBe(true);
		clearUserData('u1');
		expect(store.has(ACTIVE_SESSION_KEY)).toBe(false);
	});
});
