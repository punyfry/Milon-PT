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
});

describe('sign-out', () => {
	it('empties the active session and the queue of unsent workouts, but keeps the theme', () => {
		store.set('milonpt.theme', 'dark');
		saveActiveSession(session, 'u1');
		queueSave({ key: pendingKey('s1', session.startedAt), userId: 'u1', workoutName: 'Pass A', body: {} });
		queueSave({ key: pendingKey('s2', session.startedAt), userId: 'u2', workoutName: 'Pass B', body: {} });
		clearUserData();
		expect(loadActiveSession('u1')).toBeNull();
		expect(pendingSaves('u1')).toEqual([]);
		expect(pendingSaves('u2')).toEqual([]);
		expect([...store.keys()]).toEqual(['milonpt.theme']);
	});
});
