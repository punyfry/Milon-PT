import { describe, expect, it } from 'vitest';
import type { Exercise, SessionRecord } from '$lib/model';
import {
	addDays,
	bestEver,
	bestSet,
	estimated1RM,
	groupByWorkout,
	heaviestEver,
	heaviestWeight,
	isoWeek,
	isValidDate,
	milestoneExercises,
	progressSeries,
	recordEntries,
	weekStartOf,
	weekSummary
} from './stats';

const deadlift: Exercise = {
	id: 'ex_marklyft',
	name: 'Marklyft',
	type: 'weight',
	loadClass: 'heavy',
	instruction: '',
	archived: false,
	log: [
		{ sessionId: 's3', date: '2026-10-06', sets: [{ weight: 45, reps: 6 }, { weight: 40, reps: 8 }] },
		{ sessionId: 's2', date: '2026-10-01', sets: [{ weight: 50, reps: 3 }] },
		{ date: '2026-09-29', sets: [{ weight: 40, reps: 8 }] }
	]
};
const plank: Exercise = {
	id: 'ex_plankan',
	name: 'Plankan',
	type: 'time',
	instruction: '',
	archived: false,
	log: [{ sessionId: 's3', date: '2026-10-06', sets: [{ seconds: 45 }, { seconds: 60 }] }]
};

describe('best set and records', () => {
	it('computes 1RM per the spec', () => {
		expect(estimated1RM(40, 8)).toBe(50.7);
		expect(estimated1RM(100, 0)).toBe(0);
	});

	it('picks the best set per type', () => {
		expect(bestSet('weight', deadlift.log[0].sets)).toEqual({ value: 54, set: { weight: 45, reps: 6 } });
		expect(bestSet('time', plank.log[0].sets)?.value).toBe(60);
		expect(bestSet('bodyweight', [{ reps: 5 }, { reps: 8 }])?.value).toBe(8);
		expect(bestSet('weight', [])).toBeNull();
	});

	it('gives one series point per date, oldest first', () => {
		expect(progressSeries(deadlift).map((p) => [p.date, p.value])).toEqual([
			['2026-09-29', 50.7],
			['2026-10-01', 55],
			['2026-10-06', 54]
		]);
	});

	it('finds records and the best value excluding a given session', () => {
		// 2026-10-01 (55) beat 2026-09-29 (50.7); 2026-10-06 (54) did not.
		expect([...recordEntries(deadlift)]).toEqual([[1, ['best', 'heaviest']]]);
		expect(bestEver(deadlift)).toBe(55);
		expect(bestEver(deadlift, 's2')).toBe(54);
	});
});

describe('heaviest weight', () => {
	it('counts only weight exercises and sets with reps', () => {
		expect(heaviestWeight('weight', [{ weight: 40, reps: 8 }, { weight: 60, reps: 0 }, { weight: 45, reps: 2 }])).toBe(45);
		expect(heaviestWeight('bodyweight', [{ reps: 8 }])).toBeNull();
		expect(heaviestEver(deadlift)).toBe(50);
		expect(heaviestEver(deadlift, 's2')).toBe(45);
	});

	it('gives a record for a heavier weight even when 1RM is not beaten', () => {
		const ex: Exercise = {
			...deadlift,
			log: [
				{ date: '2026-10-06', sets: [{ weight: 52.5, reps: 1 }] },
				{ date: '2026-10-01', sets: [{ weight: 50, reps: 3 }] }
			]
		};
		// 52.5 × 1 gives 1RM 54.3 < 55, but the weight is a new high.
		expect([...recordEntries(ex)]).toEqual([[0, ['heaviest']]]);
		expect(recordEntries(plank).size).toBe(0);
	});
});

describe('week', () => {
	it('starts on Monday and has the right week number', () => {
		expect(weekStartOf('2026-10-06')).toBe('2026-10-05');
		expect(weekStartOf('2026-10-11')).toBe('2026-10-05');
		expect(weekStartOf('2026-10-05')).toBe('2026-10-05');
		expect(isoWeek('2026-10-06')).toBe(41);
		expect(isoWeek('2027-01-01')).toBe(53);
		expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
	});

	it('summarises days, sessions and volume', () => {
		const sessions: SessionRecord[] = [
			{
				id: 's3',
				workoutSlug: 'pass-a',
				workoutVersion: 1,
				startedAt: '2026-10-06T17:00:00+02:00',
				endedAt: '2026-10-06T18:00:00+02:00',
				exerciseIds: [],
				deviations: []
			}
		];
		const week = weekSummary('2026-09-28', [deadlift, plank], sessions);
		// 09-29 is an imported day (no session), 10-01 is logged with a sessionId that has no session record in the list.
		expect(week.days.filter((d) => d.trained).map((d) => d.date)).toEqual(['2026-09-29', '2026-10-01']);
		expect(week.sessionCount).toBe(1);
		expect(week.volumeByType).toEqual({ weight: 470, bodyweight: 0, time: 0 });

		const next = weekSummary('2026-10-05', [deadlift, plank], sessions);
		expect(next.days[1]).toEqual({ date: '2026-10-06', trained: true });
		expect(next.sessionCount).toBe(1);
		expect(next.volumeByType).toEqual({ weight: 590, bodyweight: 0, time: 105 });
	});
});

describe('milestones', () => {
	it('recognises pull-up and handstand by name', () => {
		const ex = (name: string): Exercise => ({ ...plank, id: name, name });
		const found = milestoneExercises([ex('Pull-ups'), ex('Handstående mot vägg'), ex('Pull-up med gummiband')]);
		expect(found.map((m) => m.exercise?.name ?? null)).toEqual(['Pull-ups', 'Handstående mot vägg']);
	});

	it('picks the most recently trained matching exercise', () => {
		const empty: Exercise = { ...plank, id: 'ex_chin_ups', name: 'Chin-ups', log: [] };
		const used: Exercise = { ...plank, id: 'ex_pull_up', name: 'Pull-up', type: 'bodyweight', log: [{ date: '2026-10-01', sets: [{ reps: 5 }] }] };
		const archived: Exercise = { ...used, id: 'ex_pullup_old', name: 'Pullup', archived: true, log: [{ date: '2026-10-05', sets: [{ reps: 6 }] }] };
		expect(milestoneExercises([empty, archived, used])[0].exercise?.id).toBe('ex_pull_up');
	});
});

describe('milestones with progression', () => {
	const bw = (id: string, name: string, date?: string): Exercise => ({
		...plank,
		id,
		name,
		type: 'bodyweight',
		log: date ? [{ date, sets: [{ reps: 5 }] }] : []
	});

	it('shows the latest progression exercise until the goal has been logged', () => {
		const neg = bw('ex_neg', 'Negativa pull-ups', '2026-10-01');
		const band = bw('ex_band', 'Pull-up med gummiband', '2026-09-20');
		const headstand = { ...bw('ex_huvud', 'Huvudstående-progression', '2026-10-02'), type: 'time' as const };
		const hang = bw('ex_hang', 'Dead hang i pull-up-stång', '2026-10-03');
		const [pullup, handstand] = milestoneExercises([band, neg, hang, bw('ex_pull_up', 'Pull-up'), headstand]);
		expect(pullup).toMatchObject({ exercise: { id: 'ex_neg' }, progress: true });
		expect(pullup.others.map((e) => e.id)).toEqual(['ex_band']);
		expect(handstand).toMatchObject({ exercise: { id: 'ex_huvud' }, progress: true, others: [] });

		const done = milestoneExercises([neg, bw('ex_pull_up', 'Pull-up', '2026-10-05')])[0];
		expect(done).toMatchObject({ exercise: { id: 'ex_pull_up' }, progress: false });
		expect(done.others.map((e) => e.id)).toEqual(['ex_neg']);
	});
});

describe('date check', () => {
	it('accepts only real dates within reasonable years', () => {
		expect(isValidDate('2026-10-06')).toBe(true);
		expect(isValidDate('2028-02-29')).toBe(true);
		for (const bad of ['2026-02-30', '2026-13-01', '0001-01-01', '9999-12-31', 'abc', '2026-1-1']) {
			expect(isValidDate(bad), bad).toBe(false);
		}
	});
});

describe('groupByWorkout', () => {
	const ex = (id: string, archived = false) => ({ id, archived });
	const workouts = [
		{ name: 'Pass B', exercises: [{ exerciseId: 'squat' }, { exerciseId: 'plank' }] },
		{ name: 'Pass A', exercises: [{ exerciseId: 'deadlift' }, { exerciseId: 'plank' }, { exerciseId: 'gone' }] }
	];

	it('groups by workout name, in each workout\'s own order', () => {
		const groups = groupByWorkout([ex('plank'), ex('squat'), ex('deadlift')], workouts);
		expect(groups.map((g) => [g.name, g.exercises.map((e) => e.id)])).toEqual([
			['Pass A', ['deadlift', 'plank']],
			['Pass B', ['squat']]
		]);
	});

	it('shows an exercise in several workouts only under the first', () => {
		const groups = groupByWorkout([ex('plank')], workouts);
		expect(groups).toEqual([{ name: 'Pass A', exercises: [ex('plank')] }]);
	});

	it('puts exercises in no workout under Övrigt, last', () => {
		const groups = groupByWorkout([ex('curl'), ex('squat')], workouts);
		expect(groups.map((g) => g.name)).toEqual(['Pass B', 'Övrigt']);
		expect(groups[1].exercises).toEqual([ex('curl')]);
	});

	it('leaves out archived exercises and empty workouts', () => {
		expect(groupByWorkout([ex('squat', true), ex('curl', true)], workouts)).toEqual([]);
	});
});
