import { describe, expect, it } from 'vitest';
import { coachEnabled } from './profile';
import { assertValid, countsAsWorkout, Issues, validateLoggedSet, fitsPhase, notAWorkoutMessage, issueText, sortByPhase, validateExercise, validateProfile, validateSession, validateWorkout, ValidationError } from './validate';

const deadlift = {
	id: 'ex_marklyft',
	name: 'Marklyft',
	type: 'weight',
	instruction: 'Stång över mellanfoten.',
	log: [{ sessionId: 's_20261006', date: '2026-10-06', sets: [{ weight: 40, reps: 8 }] }]
};

describe('validation', () => {
	it("keeps a log entry's startedAt and refuses one that is not an ISO time (#66)", () => {
		const entry = { ...deadlift.log[0], startedAt: '2026-10-06T17:10:00+02:00' };
		expect(assertValid('övning', { ...deadlift, log: [entry] }, validateExercise).log).toEqual([entry]);
		expect(assertValid('övning', deadlift, validateExercise).log[0]).not.toHaveProperty('startedAt');
		expect(() => assertValid('övning', { ...deadlift, log: [{ ...entry, startedAt: '2026-10-06' }] }, validateExercise)).toThrow(
			/startedAt/
		);
	});

	it('accepts the examples in README.md', () => {
		expect(assertValid('övning', deadlift, validateExercise)).toEqual(deadlift);
		const workout = {
			slug: 'pass-b',
			name: 'Pass B',
			version: 2,
			createdAt: '2026-10-06',
			changeNote: 'Byt hantelpress mot axelpress',
			exercises: [
				{ exerciseId: 'ex_marklyft', sets: 3, target: { reps: 8 } },
				{ exerciseId: 'ex_plankan', sets: 3, target: { seconds: 45 } }
			]
		};
		expect(assertValid('pass', workout, validateWorkout)).toEqual(workout);
		const session = {
			id: 's_20261006',
			workoutSlug: 'pass-b',
			workoutVersion: 2,
			startedAt: '2026-10-06T17:10:00+02:00',
			endedAt: '2026-10-06T18:05:00+02:00',
			exerciseIds: ['ex_marklyft', 'ex_plankan'],
			deviations: [{ type: 'swap', from: 'ex_hantelpress', to: 'ex_axelpress' }],
			kcalEstimate: 300
		};
		expect(assertValid('pass', session, validateSession)).toEqual(session);
		const edited = { ...session, originalStartedAt: '2026-10-06T17:00:00+02:00' };
		expect(assertValid('pass', edited, validateSession)).toEqual(edited);
		expect(() => assertValid('pass', { ...session, originalStartedAt: 'x' }, validateSession)).toThrow(/originalStartedAt/);
	});

	it('requires sets that match the exercise type', () => {
		const bad = { ...deadlift, log: [{ date: '2026-10-06', sets: [{ reps: 8 }] }] };
		expect(() => assertValid('övning', bad, validateExercise)).toThrow(/log\[0\]\.sets\[0\]\.weight/);
	});

	it('collects all issues', () => {
		try {
			assertValid('övning', { ...deadlift, name: '', deleted: 'nej', id: 'ex marklyft' }, validateExercise);
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(ValidationError);
			expect((e as ValidationError).issues).toHaveLength(3);
		}
	});

	it('keeps a note, drops an empty one and ignores the old archived flag', () => {
		expect(assertValid('övning', { ...deadlift, note: ' Prova ' }, validateExercise).note).toBe('Prova');
		expect(assertValid('övning', { ...deadlift, note: '' }, validateExercise)).not.toHaveProperty('note');
		expect(assertValid('övning', { ...deadlift, archived: true }, validateExercise)).not.toHaveProperty('archived');
		expect(() => assertValid('övning', { ...deadlift, note: 5 }, validateExercise)).toThrow(/note: måste vara text/);
	});

	it('drops the old loadClass field', () => {
		const result = assertValid('övning', { ...deadlift, loadClass: 'heavy' }, validateExercise);
		expect(result).not.toHaveProperty('loadClass');
	});

	it('strips unknown fields', () => {
		const result = assertValid('övning', { ...deadlift, extra: 1 }, validateExercise);
		expect(result).not.toHaveProperty('extra');
	});
});

describe('profile', () => {
	const profileOf = (v: unknown) => assertValid('profil', v, validateProfile);

	it('keeps the coach setting and rejects anything but a boolean', () => {
		expect(assertValid('profil', { coach: false }, validateProfile)).toEqual({ coach: false });
		expect(assertValid('profil', {}, validateProfile)).toEqual({});
		expect(() => assertValid('profil', { coach: 'nej' }, validateProfile)).toThrow(/coach/);
	});

	it('keeps the date the intro was done', () => {
		expect(profileOf({ onboardedAt: '2026-10-09' })).toEqual({ onboardedAt: '2026-10-09' });
		expect(() => profileOf({ onboardedAt: 'igår' })).toThrow(/onboardedAt/);
	});

	it('treats a missing setting as on', () => {
		expect(coachEnabled({})).toBe(true);
		expect(coachEnabled({ coach: true })).toBe(true);
		expect(coachEnabled({ coach: false })).toBe(false);
	});
});

describe('issue text for the user', () => {
	it('drops the path, starts with a capital letter and ends with a period', () => {
		expect(issueText('name: övningen behöver ett namn')).toBe('Övningen behöver ett namn.');
		expect(issueText('exercises[2].log[0].sets[1].reps: måste vara ett heltal')).toBe('Måste vara ett heltal.');
		expect(issueText('Passet finns inte längre.')).toBe('Passet finns inte längre.');
	});
});

describe('phase (#100)', () => {
	const workout = (phase: unknown) => ({
		slug: 'pass-a',
		name: 'Pass A',
		version: 1,
		createdAt: '2026-10-01',
		exercises: [{ exerciseId: 'ex_plankan', sets: 1, target: { seconds: 30 }, phase }]
	});

	it('keeps warm-up and stretch on a workout exercise and drops main', () => {
		expect(assertValid('pass', workout('warmup'), validateWorkout).exercises[0].phase).toBe('warmup');
		expect(assertValid('pass', workout('cooldown'), validateWorkout).exercises[0].phase).toBe('cooldown');
		expect(assertValid('pass', workout('main'), validateWorkout).exercises[0]).not.toHaveProperty('phase');
		expect(assertValid('pass', workout(undefined), validateWorkout).exercises[0]).not.toHaveProperty('phase');
	});

	it('rejects an unknown phase', () => {
		expect(() => assertValid('pass', workout('stretch'), validateWorkout)).toThrow(/exercises\[0\]\.phase/);
		expect(() => assertValid('pass', workout(null), validateWorkout)).toThrow(/phase/);
	});

	it('validates the phase on a log entry', () => {
		const entry = (phase: unknown) => ({ ...deadlift, log: [{ ...deadlift.log[0], phase }] });
		expect(assertValid('övning', entry('cooldown'), validateExercise).log[0].phase).toBe('cooldown');
		expect(assertValid('övning', entry('main'), validateExercise).log[0]).not.toHaveProperty('phase');
		expect(() => assertValid('övning', entry('x'), validateExercise)).toThrow(/log\[0\]\.phase/);
	});

	it('warm-up and stretch take time or reps, never weights', () => {
		expect(fitsPhase('weight', 'warmup')).toBe(false);
		expect(fitsPhase('weight', 'cooldown')).toBe(false);
		expect(fitsPhase('time', 'cooldown')).toBe(true);
		expect(fitsPhase('bodyweight', 'warmup')).toBe(true);
		expect(fitsPhase('weight', 'main')).toBe(true);
		expect(fitsPhase('weight', undefined)).toBe(true);
	});

	it('sorts by phase and keeps the order within each part', () => {
		const list = [{ id: 'a', phase: 'cooldown' as const }, { id: 'b' }, { id: 'c', phase: 'warmup' as const }, { id: 'd' }];
		expect(sortByPhase(list).map((e) => e.id)).toEqual(['c', 'b', 'd', 'a']);
	});
});

describe('countsAsWorkout', () => {
	const ex = (phase: 'warmup' | 'cooldown' | undefined, done: boolean) => ({ ...(phase ? { phase } : {}), sets: [{ reps: 10, done }] });

	it('counts a done main part, or a warm-up and a stretch together', () => {
		expect(countsAsWorkout([ex('warmup', false), ex(undefined, true), ex('cooldown', false)])).toBe(true);
		expect(countsAsWorkout([ex('warmup', true), ex(undefined, false), ex('cooldown', true)])).toBe(true);
	});

	it('does not count only a warm-up, only a stretch or nothing', () => {
		expect(countsAsWorkout([ex('warmup', true), ex(undefined, false), ex('cooldown', false)])).toBe(false);
		expect(countsAsWorkout([ex('warmup', false), ex(undefined, false), ex('cooldown', true)])).toBe(false);
		expect(countsAsWorkout([ex('warmup', false), ex(undefined, false)])).toBe(false);
	});

	it('needs any done set in a workout without a main part', () => {
		expect(countsAsWorkout([ex('cooldown', true)])).toBe(true);
		expect(countsAsWorkout([ex('cooldown', false)])).toBe(false);
	});

	it('ignores sets that are not objects', () => {
		expect(countsAsWorkout([{ sets: [null, 'x'] }])).toBe(false);
	});
});

describe('notAWorkoutMessage', () => {
	it('offers "both warm-up and stretch" only when the workout has both parts', () => {
		expect(notAWorkoutMessage([{ phase: 'warmup' }, {}, { phase: 'cooldown' }])).toContain('både uppvärmning och stretch');
		expect(notAWorkoutMessage([{ phase: 'warmup' }, {}])).not.toContain('både');
		expect(notAWorkoutMessage([{}, { phase: 'cooldown' }])).not.toContain('både');
	});
});

describe('upper bounds for a logged set (#89)', () => {
	it('accepts values up to the bounds and refuses values above them', () => {
		const check = (set: unknown, type: 'weight' | 'bodyweight' | 'time') => {
			const issues = new Issues();
			return { set: validateLoggedSet(set, type, issues, 's'), issues: issues.list };
		};
		expect(check({ weight: 500, reps: 200 }, 'weight')).toEqual({ set: { weight: 500, reps: 200 }, issues: [] });
		expect(check({ seconds: 10800 }, 'time').set).toEqual({ seconds: 10800 });
		expect(check({ weight: 500.5, reps: 201 }, 'weight')).toEqual({ set: null, issues: ['s.weight: får vara högst 500', 's.reps: får vara högst 200'] });
		expect(check({ reps: 201 }, 'bodyweight').set).toBeNull();
		expect(check({ seconds: 10801 }, 'time').issues).toEqual(['s.seconds: får vara högst 10800']);
		expect(check({ weight: -1, reps: 5 }, 'weight').issues).toEqual(['s.weight: måste vara minst 0']);
	});

	it('does not apply the bounds when stored files are read', () => {
		const heavy = { ...deadlift, log: [{ ...deadlift.log[0], sets: [{ weight: 1000, reps: 300 }] }] };
		expect(assertValid('övning', heavy, validateExercise).log[0].sets).toEqual([{ weight: 1000, reps: 300 }]);
	});
});
