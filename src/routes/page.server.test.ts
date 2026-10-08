import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createExercise, createSession, prependLogEntry, saveWorkoutVersion } from '$lib/server/data';
import { MemoryUserStorage } from '$lib/server/storage/memory';

const state = vi.hoisted(() => ({ storage: null as unknown as MemoryUserStorage }));
vi.mock('$lib/server/storage', async (original) => ({
	...(await original<typeof import('$lib/server/storage')>()),
	storageFor: () => state.storage
}));
vi.mock('$lib/time', async (original) => ({
	...(await original<typeof import('$lib/time')>()),
	todayInStockholm: () => '2026-10-08' // Thursday, week 41 (5–11 Oct)
}));

const { load } = await import('./+page.server');

beforeEach(async () => {
	state.storage = new MemoryUserStorage('u1');
	const s = state.storage;
	await createExercise(s, { name: 'Dips', type: 'bodyweight', instruction: '' });
	await saveWorkoutVersion(s, { slug: 'pass-a', name: 'Pass A', createdAt: '2026-10-01', exercises: [{ exerciseId: 'ex_dips', sets: 2, target: { reps: 8 } }] });
	// A saved session on Monday, an imported entry without a session on Wednesday, and one last week.
	await prependLogEntry(s, 'ex_dips', { date: '2026-10-02', sets: [{ reps: 5 }] });
	await prependLogEntry(s, 'ex_dips', { sessionId: 's_20261005', date: '2026-10-05', sets: [{ reps: 8 }] });
	await prependLogEntry(s, 'ex_dips', { date: '2026-10-07', sets: [{ reps: 6 }] });
	await createSession(s, {
		id: 's_20261005',
		workoutSlug: 'pass-a',
		workoutVersion: 1,
		startedAt: '2026-10-05T17:00:00+02:00',
		endedAt: '2026-10-05T18:00:00+02:00',
		exerciseIds: ['ex_dips'],
		deviations: []
	});
});

describe('start page load', () => {
	it('counts the week like the history page: sessions plus days with only imported entries (#39)', async () => {
		const data = (await load({ locals: { user: { id: 'u1' } } } as never)) as { week: { number: number; sessions: number } };
		expect(data.week).toMatchObject({ number: 41, sessions: 2 });
	});
});
