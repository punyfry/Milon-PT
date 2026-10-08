import { describe, expect, it } from 'vitest';
import type { ActiveSet, WorkoutTemplate } from '$lib/model';
import {
	addSet,
	applySwap,
	cancelTimer,
	completeExpiredTimers,
	createActiveSession,
	localIsoString,
	prefillSets,
	remainingMs,
	removeSet,
	setField,
	startPreparedSession,
	startTimer,
	stopTimer,
	summarize,
	swapCandidates,
	timerStartSeconds,
	type ExerciseInfo
} from './active';

const deadlift: ExerciseInfo = {
	id: 'ex_marklyft',
	name: 'Marklyft',
	type: 'weight',
	instruction: '',
	lastEntry: { sessionId: 's_1', date: '2026-10-01', sets: [{ weight: 40, reps: 8 }, { weight: 42.5, reps: 6 }] }
};
const plank: ExerciseInfo = { id: 'ex_plankan', name: 'Plankan', type: 'time', instruction: '' };
const pullup: ExerciseInfo = { id: 'ex_pull_up', name: 'Pull-up', type: 'bodyweight', instruction: '' };
const infos = new Map([deadlift, plank, pullup].map((e) => [e.id, e]));

const workout: WorkoutTemplate = {
	slug: 'pass-a',
	name: 'Pass A',
	version: 2,
	createdAt: '2026-10-01',
	exercises: [
		{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } },
		{ exerciseId: 'ex_plankan', sets: 2, target: { seconds: 45 } },
		{ exerciseId: 'ex_pull_up', sets: 2, target: { reps: 5 } }
	]
};

describe('active session', () => {
	it('creates the session with sets prefilled from last time, otherwise from the target', () => {
		const s = createActiveSession(workout, infos, new Date(2026, 9, 6, 17, 10));
		expect(s.sessionId).toBe('s_20261006');
		expect(s.workoutVersion).toBe(2);
		expect(s.startedAt.slice(0, 16)).toBe('2026-10-06T17:10');
		expect(s.exercises[0].sets).toEqual([
			{ weight: 40, reps: 8, done: false },
			{ weight: 42.5, reps: 6, done: false },
			{ weight: 42.5, reps: 6, done: false }
		]);
		expect(s.exercises[1].sets).toEqual([
			{ seconds: 45, done: false },
			{ seconds: 45, done: false }
		]);
		expect(s.exercises[2].sets[0]).toEqual({ reps: 5, done: false });
	});

	it('prefills a timed set stopped early last time with the planned target', () => {
		const stopped: ExerciseInfo = { ...plank, lastEntry: { date: '2026-10-01', sets: [{ seconds: 20 }, { seconds: 60 }] } };
		expect(prefillSets(stopped, 2, { seconds: 45 }).map((s) => ('seconds' in s ? s.seconds : 0))).toEqual([45, 60]);
		expect(prefillSets(stopped, 2).map((s) => ('seconds' in s ? s.seconds : 0))).toEqual([20, 60]); // no target to go by
	});

	it('never prefills with fields of the wrong type', () => {
		const odd: ExerciseInfo = { ...pullup, lastEntry: { date: '2026-10-01', sets: [{ weight: 10, reps: 7 }] } };
		expect(prefillSets(odd, 1)).toEqual([{ reps: 7, done: false }]);
	});

	it('sets typed values and ignores invalid ones', () => {
		const set = { weight: 40, reps: 8, done: false };
		setField(set, 'weight', 41.255);
		setField(set, 'reps', -3);
		setField(set, 'seconds', 30);
		expect(set).toEqual({ weight: 41.26, reps: 8, done: false });
	});

	it('adds and removes sets', () => {
		const sets = [{ weight: 40, reps: 8, done: true }];
		addSet(sets, 'weight');
		expect(sets[1]).toEqual({ weight: 40, reps: 8, done: false });
		removeSet(sets, 0);
		expect(sets).toHaveLength(1);
		const empty: never[] = [];
		addSet(empty, 'time');
		expect(empty[0]).toEqual({ seconds: 30, done: false });
	});

	it('keeps a swapped-in exercise on its own logged times, not the replaced target', () => {
		const s = createActiveSession(workout, infos, new Date('2026-10-06T15:00:00Z'));
		const sidePlank: ExerciseInfo = { id: 'ex_sidoplanka', name: 'Sidoplanka', type: 'time', instruction: '', lastEntry: { date: '2026-10-01', sets: [{ seconds: 30 }] } };
		applySwap(s, 'ex_plankan', sidePlank, { seconds: 45 });
		expect(s.exercises[1].sets).toEqual([
			{ seconds: 30, done: false },
			{ seconds: 30, done: false }
		]);
		const fresh: ExerciseInfo = { ...sidePlank, id: 'ex_ny', lastEntry: undefined };
		applySwap(s, 'ex_sidoplanka', fresh, { seconds: 45 });
		expect(s.exercises[1].sets[0]).toEqual({ seconds: 45, done: false }); // no history: the target
	});

	it('copies a time changed by hand, and the plan while a timer runs', () => {
		const edited: ActiveSet[] = [{ seconds: 30, done: false }];
		startTimer(edited[0], new Date(0));
		stopTimer(edited[0], new Date(10_000));
		setField(edited[0], 'seconds', 15);
		addSet(edited, 'time');
		expect(edited[1]).toEqual({ seconds: 15, done: false });

		const running: ActiveSet[] = [{ seconds: 30, done: false }];
		startTimer(running[0], new Date(0));
		addSet(running, 'time');
		expect(running[1]).toEqual({ seconds: 30, done: false });
	});

	it('leaves the done flag alone when a timer starts or is discarded', () => {
		const ticked: ActiveSet = { seconds: 30, done: true };
		startTimer(ticked, new Date(0));
		cancelTimer(ticked);
		expect(ticked).toEqual({ seconds: 30, done: true });
		const open: ActiveSet = { seconds: 30, done: false };
		startTimer(open, new Date(0));
		expect(open.done).toBe(false);
	});

	it('copies the plan, not the reached time, when adding a set after an early stop (#37)', () => {
		const sets: ActiveSet[] = [{ seconds: 30, done: false }];
		startTimer(sets[0], new Date(0));
		stopTimer(sets[0], new Date(5000));
		addSet(sets, 'time');
		expect(sets[1]).toEqual({ seconds: 30, done: false });
	});
});

describe('timer', () => {
	const t0 = new Date('2026-10-06T15:00:00Z');
	const at = (s: number) => new Date(t0.getTime() + s * 1000);

	it('counts down from the end time', () => {
		const set = { seconds: 45, done: false };
		startTimer(set, t0);
		expect(set).toMatchObject({ timerDuration: 45, timerEndsAt: at(45).toISOString() });
		expect(remainingMs(set, at(10))).toBe(35_000);
	});

	it('saves the elapsed time on an early stop', () => {
		const set = { seconds: 45, done: false };
		startTimer(set, t0);
		stopTimer(set, at(30.4));
		expect(set).toEqual({ seconds: 30, done: true, plannedSeconds: 45 });
	});

	it('restarts from the planned time after an early stop (#32)', () => {
		const set: ActiveSet = { seconds: 30, done: false };
		startTimer(set, t0);
		stopTimer(set, at(5));
		expect(set).toMatchObject({ seconds: 5, plannedSeconds: 30 });
		expect(timerStartSeconds(set)).toBe(30);
		startTimer(set, at(10));
		expect(set).toMatchObject({ timerDuration: 30, timerEndsAt: at(40).toISOString(), done: true });
		stopTimer(set, at(35));
		expect(set).toEqual({ seconds: 25, done: true, plannedSeconds: 30 });
	});

	it('keeps the plan when a restarted timer is cancelled', () => {
		const set: ActiveSet = { seconds: 30, done: false };
		startTimer(set, t0);
		stopTimer(set, at(5));
		startTimer(set, at(10));
		cancelTimer(set);
		// Discarding the restarted timer leaves the set as it was: done, with the reached time and the plan (#37).
		expect(set).toEqual({ seconds: 5, done: true, plannedSeconds: 30 });
		expect(timerStartSeconds(set)).toBe(30);
	});

	it('forgets the plan when the timer runs to zero or the time is changed by hand', () => {
		const ran: ActiveSet = { seconds: 30, done: false };
		startTimer(ran, t0);
		stopTimer(ran, at(5));
		startTimer(ran, at(10));
		stopTimer(ran, at(41));
		expect(ran).toEqual({ seconds: 30, done: true });

		const stepped: ActiveSet = { seconds: 30, done: false };
		startTimer(stepped, t0);
		stopTimer(stepped, at(5));
		setField(stepped, 'seconds', 10);
		expect(stepped).toEqual({ seconds: 10, done: true });
		expect(timerStartSeconds(stepped)).toBe(10);

		const typed: ActiveSet = { seconds: 30, done: false };
		startTimer(typed, t0);
		stopTimer(typed, at(5));
		setField(typed, 'seconds', 20);
		expect(timerStartSeconds(typed)).toBe(20);
	});

	it('keeps the plan when an edit leaves the time unchanged', () => {
		const set: ActiveSet = { seconds: 30, done: false };
		startTimer(set, t0);
		stopTimer(set, at(5));
		setField(set, 'seconds', 5); // e.g. −5 clamped to the 5 s minimum
		expect(timerStartSeconds(set)).toBe(30);
	});

	it('clears the plan when a restarted timer is stopped at the full time', () => {
		const set: ActiveSet = { seconds: 30, done: false };
		startTimer(set, t0);
		stopTimer(set, at(5));
		startTimer(set, at(10));
		stopTimer(set, at(39.6));
		expect(set).toEqual({ seconds: 30, done: true });
	});

	it('has no timer start time for sets without seconds', () => {
		expect(timerStartSeconds({ reps: 5, done: false })).toBe(0);
	});

	it('can restart a set that was stopped at zero seconds', () => {
		const set: ActiveSet = { seconds: 30, done: false };
		startTimer(set, t0);
		stopTimer(set, at(0.2));
		expect(set).toMatchObject({ seconds: 0, plannedSeconds: 30 });
		startTimer(set, at(1));
		expect(set.timerDuration).toBe(30);
	});

	it('fills in the reached time when the timer hit zero, even after the page was closed', () => {
		const s = createActiveSession(workout, infos, t0);
		startTimer(s.exercises[1].sets[0], t0);
		expect(completeExpiredTimers(s, at(44))).toBe(0);
		expect(completeExpiredTimers(s, at(600))).toBe(1);
		expect(s.exercises[1].sets[0]).toEqual({ seconds: 45, done: true });
	});

	it('clears the plan when an expired timer is completed', () => {
		const s = createActiveSession(workout, infos, t0);
		const set = s.exercises[1].sets[0];
		startTimer(set, t0);
		stopTimer(set, at(5));
		startTimer(set, at(10));
		expect(completeExpiredTimers(s, at(600))).toBe(1);
		expect(set).toEqual({ seconds: 45, done: true });
	});
});

describe('prepared session', () => {
	// Prepared one day, started the next (midday, so the date is the same in any time zone).
	const t0 = new Date('2026-10-06T12:00:00Z');
	const t1 = new Date('2026-10-07T12:00:00Z');

	it('starts as an overview and gets the start time and id when started', () => {
		const s = createActiveSession(workout, infos, t0, { preparing: true });
		expect(s).toMatchObject({ preparing: true, sessionId: 's_20261006' });
		s.current = 2;
		startPreparedSession(s, t1);
		expect(s.preparing).toBeUndefined();
		expect(s).toMatchObject({ sessionId: 's_20261007', startedAt: localIsoString(t1), lastActivityAt: localIsoString(t1), current: 0 });
	});

	it('keeps swaps made while preparing', () => {
		const s = createActiveSession(workout, infos, t0, { preparing: true });
		const sidePlank: ExerciseInfo = { id: 'ex_sidoplanka', name: 'Sidoplanka', type: 'time', instruction: '' };
		applySwap(s, 'ex_plankan', sidePlank, { seconds: 45 });
		startPreparedSession(s, t1);
		expect(s.exercises.map((e) => e.exerciseId)).toEqual(['ex_marklyft', 'ex_sidoplanka', 'ex_pull_up']);
		expect(s.deviations).toEqual([{ type: 'swap', from: 'ex_plankan', to: 'ex_sidoplanka' }]);
	});

	it('does not restart a session that is already running', () => {
		const s = createActiveSession(workout, infos, t0);
		const before = structuredClone(s);
		startPreparedSession(s, t1);
		expect(s).toEqual(before);
	});
});

describe('swap candidates', () => {
	const row: ExerciseInfo = { id: 'ex_hantelrodd', name: 'Hantelrodd', type: 'weight', instruction: '' };
	const bench: ExerciseInfo = { id: 'ex_bankpress', name: 'Bänkpress', type: 'weight', instruction: '' };
	const sidePlank: ExerciseInfo = { id: 'ex_sidoplanka', name: 'Sidoplanka', type: 'time', instruction: '' };
	const catalog = [deadlift, plank, pullup, row, bench, sidePlank];
	const s = createActiveSession(workout, infos, new Date('2026-10-06T15:00:00Z'));

	it('leaves out exercises already in the session and puts the same type first, then by name', () => {
		expect(swapCandidates(catalog, s, 'time').map((e) => e.id)).toEqual(['ex_sidoplanka', 'ex_bankpress', 'ex_hantelrodd']);
		expect(swapCandidates(catalog, s, 'weight').map((e) => e.id)).toEqual(['ex_bankpress', 'ex_hantelrodd', 'ex_sidoplanka']);
	});

	it('sorts by name only when the type is unknown', () => {
		expect(swapCandidates(catalog, s, undefined).map((e) => e.id)).toEqual(['ex_bankpress', 'ex_hantelrodd', 'ex_sidoplanka']);
	});

	it('filters by name, ignoring case and extra spaces', () => {
		expect(swapCandidates(catalog, s, 'weight', '  RODD ').map((e) => e.id)).toEqual(['ex_hantelrodd']);
		expect(swapCandidates(catalog, s, 'weight', 'bänk').map((e) => e.id)).toEqual(['ex_bankpress']);
		expect(swapCandidates(catalog, s, 'weight', 'marklyft')).toEqual([]);
	});
});

describe('summary', () => {
	it('computes volume per type over done sets', () => {
		const s = createActiveSession(workout, infos, new Date());
		s.exercises[0].sets[0].done = true; // 40 × 8
		s.exercises[0].sets[1].done = true; // 42.5 × 6
		s.exercises[1].sets[0].done = true; // 45 s
		const sum = summarize(s, infos);
		expect(sum.doneSets).toBe(3);
		expect(sum.volumeByType).toEqual({ weight: 575, bodyweight: 0, time: 45 });
		expect(sum.exercises[2]).toMatchObject({ doneSets: 0, totalSets: 2, volume: 0 });
	});
});

describe('time', () => {
	it('formats local time with time zone', () => {
		expect(localIsoString(new Date(2026, 9, 6, 7, 5, 9))).toMatch(/^2026-10-06T07:05:09[+-]\d{2}:\d{2}$/);
	});
});
