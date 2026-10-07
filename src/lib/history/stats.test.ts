import { describe, expect, it } from 'vitest';
import type { Exercise, SessionRecord } from '$lib/model';
import {
	addDays,
	bestEver,
	bestSet,
	estimated1RM,
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

const marklyft: Exercise = {
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
const plankan: Exercise = {
	id: 'ex_plankan',
	name: 'Plankan',
	type: 'time',
	instruction: '',
	archived: false,
	log: [{ sessionId: 's3', date: '2026-10-06', sets: [{ seconds: 45 }, { seconds: 60 }] }]
};

describe('bästa set och rekord', () => {
	it('räknar 1RM enligt specen', () => {
		expect(estimated1RM(40, 8)).toBe(50.7);
		expect(estimated1RM(100, 0)).toBe(0);
	});

	it('väljer bästa set per typ', () => {
		expect(bestSet('weight', marklyft.log[0].sets)).toEqual({ value: 54, set: { weight: 45, reps: 6 } });
		expect(bestSet('time', plankan.log[0].sets)?.value).toBe(60);
		expect(bestSet('bodyweight', [{ reps: 5 }, { reps: 8 }])?.value).toBe(8);
		expect(bestSet('weight', [])).toBeNull();
	});

	it('ger en serie per datum, äldst först', () => {
		expect(progressSeries(marklyft).map((p) => [p.date, p.value])).toEqual([
			['2026-09-29', 50.7],
			['2026-10-01', 55],
			['2026-10-06', 54]
		]);
	});

	it('hittar rekord och bästa värde utan ett visst pass', () => {
		// 2026-10-01 (55) slog 2026-09-29 (50,7); 2026-10-06 (54) gjorde det inte.
		expect([...recordEntries(marklyft)]).toEqual([[1, ['best', 'heaviest']]]);
		expect(bestEver(marklyft)).toBe(55);
		expect(bestEver(marklyft, 's2')).toBe(54);
	});
});

describe('tyngsta vikt', () => {
	it('räknar bara viktövningar och set med reps', () => {
		expect(heaviestWeight('weight', [{ weight: 40, reps: 8 }, { weight: 60, reps: 0 }, { weight: 45, reps: 2 }])).toBe(45);
		expect(heaviestWeight('bodyweight', [{ reps: 8 }])).toBeNull();
		expect(heaviestEver(marklyft)).toBe(50);
		expect(heaviestEver(marklyft, 's2')).toBe(45);
	});

	it('ger rekord för tyngre vikt även när 1RM inte slås', () => {
		const ex: Exercise = {
			...marklyft,
			log: [
				{ date: '2026-10-06', sets: [{ weight: 52.5, reps: 1 }] },
				{ date: '2026-10-01', sets: [{ weight: 50, reps: 3 }] }
			]
		};
		// 52,5 × 1 ger 1RM 54,3 < 55, men vikten är ny högsta.
		expect([...recordEntries(ex)]).toEqual([[0, ['heaviest']]]);
		expect(recordEntries(plankan).size).toBe(0);
	});
});

describe('vecka', () => {
	it('börjar på måndag och har rätt veckonummer', () => {
		expect(weekStartOf('2026-10-06')).toBe('2026-10-05');
		expect(weekStartOf('2026-10-11')).toBe('2026-10-05');
		expect(weekStartOf('2026-10-05')).toBe('2026-10-05');
		expect(isoWeek('2026-10-06')).toBe(41);
		expect(isoWeek('2027-01-01')).toBe(53);
		expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
	});

	it('sammanfattar dagar, pass och volym', () => {
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
		const week = weekSummary('2026-09-28', [marklyft, plankan], sessions);
		// 09-29 importerad dag (utan session), 10-01 loggad med sessionId utan sessionspost i listan.
		expect(week.days.filter((d) => d.trained).map((d) => d.date)).toEqual(['2026-09-29', '2026-10-01']);
		expect(week.sessionCount).toBe(1);
		expect(week.volumeByType).toEqual({ weight: 470, bodyweight: 0, time: 0 });

		const next = weekSummary('2026-10-05', [marklyft, plankan], sessions);
		expect(next.days[1]).toEqual({ date: '2026-10-06', trained: true });
		expect(next.sessionCount).toBe(1);
		expect(next.volumeByType).toEqual({ weight: 590, bodyweight: 0, time: 105 });
	});
});

describe('milstolpar', () => {
	it('känner igen pull-up och handstående på namn', () => {
		const ex = (name: string): Exercise => ({ ...plankan, id: name, name });
		const found = milestoneExercises([ex('Pull-ups'), ex('Handstående mot vägg'), ex('Pull-up med gummiband')]);
		expect(found.map((m) => m.exercise?.name ?? null)).toEqual(['Pull-ups', 'Handstående mot vägg']);
	});

	it('väljer den matchande övningen som tränats senast', () => {
		const empty: Exercise = { ...plankan, id: 'ex_chin_ups', name: 'Chin-ups', log: [] };
		const used: Exercise = { ...plankan, id: 'ex_pull_up', name: 'Pull-up', type: 'bodyweight', log: [{ date: '2026-10-01', sets: [{ reps: 5 }] }] };
		const archived: Exercise = { ...used, id: 'ex_pullup_old', name: 'Pullup', archived: true, log: [{ date: '2026-10-05', sets: [{ reps: 6 }] }] };
		expect(milestoneExercises([empty, archived, used])[0].exercise?.id).toBe('ex_pull_up');
	});
});

describe('milstolpar med progression', () => {
	const bw = (id: string, name: string, date?: string): Exercise => ({
		...plankan,
		id,
		name,
		type: 'bodyweight',
		log: date ? [{ date, sets: [{ reps: 5 }] }] : []
	});

	it('visar senaste progressionsövningen tills målet har loggats', () => {
		const neg = bw('ex_neg', 'Negativa pull-ups', '2026-10-01');
		const band = bw('ex_band', 'Pull-up med gummiband', '2026-09-20');
		const headstand = { ...bw('ex_huvud', 'Huvudstående-progression', '2026-10-02'), type: 'time' as const };
		const [pullup, handstand] = milestoneExercises([band, neg, bw('ex_pull_up', 'Pull-up'), headstand]);
		expect(pullup).toMatchObject({ exercise: { id: 'ex_neg' }, progress: true });
		expect(pullup.others.map((e) => e.id)).toEqual(['ex_band']);
		expect(handstand).toMatchObject({ exercise: { id: 'ex_huvud' }, progress: true, others: [] });

		const done = milestoneExercises([neg, bw('ex_pull_up', 'Pull-up', '2026-10-05')])[0];
		expect(done).toMatchObject({ exercise: { id: 'ex_pull_up' }, progress: false });
		expect(done.others.map((e) => e.id)).toEqual(['ex_neg']);
	});
});

describe('datumkontroll', () => {
	it('godtar bara riktiga datum inom rimliga år', () => {
		expect(isValidDate('2026-10-06')).toBe(true);
		expect(isValidDate('2028-02-29')).toBe(true);
		for (const bad of ['2026-02-30', '2026-13-01', '0001-01-01', '9999-12-31', 'abc', '2026-1-1']) {
			expect(isValidDate(bad), bad).toBe(false);
		}
	});
});
