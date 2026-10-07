import { describe, expect, it } from 'vitest';
import type { WorkoutTemplate } from '$lib/model';
import {
	addSet,
	adjust,
	completeExpiredTimers,
	createActiveSession,
	localIsoString,
	prefillSets,
	remainingMs,
	removeSet,
	setField,
	startTimer,
	stopTimer,
	summarize,
	type ExerciseInfo
} from './active';

const deadlift: ExerciseInfo = {
	id: 'ex_marklyft',
	name: 'Marklyft',
	type: 'weight',
	loadClass: 'heavy',
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

	it('never prefills with fields of the wrong type', () => {
		const odd: ExerciseInfo = { ...pullup, lastEntry: { date: '2026-10-01', sets: [{ weight: 10, reps: 7 }] } };
		expect(prefillSets(odd, 1)).toEqual([{ reps: 7, done: false }]);
	});

	it('steps weight by loadClass, reps by 1 and time by 5 s, never below zero', () => {
		const heavy = { weight: 40, reps: 8, done: false };
		adjust(heavy, 'weight', 1, 'heavy');
		adjust(heavy, 'reps', -1);
		expect(heavy).toMatchObject({ weight: 45, reps: 7 });
		const light = { weight: 10, reps: 8, done: false };
		adjust(light, 'weight', 1, 'light');
		adjust(light, 'weight', 1, 'light');
		expect(light.weight).toBe(12.5);
		const time = { seconds: 3, done: false };
		adjust(time, 'seconds', -1);
		expect(time.seconds).toBe(0);
		adjust(time, 'seconds', 1);
		expect(time.seconds).toBe(5);
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
		expect(set).toEqual({ seconds: 30, done: true });
	});

	it('fills in the reached time when the timer hit zero, even after the page was closed', () => {
		const s = createActiveSession(workout, infos, t0);
		startTimer(s.exercises[1].sets[0], t0);
		expect(completeExpiredTimers(s, at(44))).toBe(0);
		expect(completeExpiredTimers(s, at(600))).toBe(1);
		expect(s.exercises[1].sets[0]).toEqual({ seconds: 45, done: true });
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
