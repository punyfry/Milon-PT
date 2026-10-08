import { describe, expect, it } from 'vitest';
import { assertValid, validateExercise, validateSession, validateWorkout, ValidationError } from './validate';

const deadlift = {
	id: 'ex_marklyft',
	name: 'Marklyft',
	type: 'weight',
	instruction: 'Stång över mellanfoten.',
	archived: false,
	log: [{ sessionId: 's_20261006', date: '2026-10-06', sets: [{ weight: 40, reps: 8 }] }]
};

describe('validation', () => {
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
			assertValid('övning', { ...deadlift, name: '', archived: 'nej', id: 'ex marklyft' }, validateExercise);
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(ValidationError);
			expect((e as ValidationError).issues).toHaveLength(3);
		}
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
