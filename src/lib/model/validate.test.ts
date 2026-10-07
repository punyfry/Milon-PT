import { describe, expect, it } from 'vitest';
import { assertValid, validateExercise, validateSession, validateWorkout, ValidationError } from './validate';

const marklyft = {
	id: 'ex_marklyft',
	name: 'Marklyft',
	type: 'weight',
	loadClass: 'heavy',
	instruction: 'Stång över mellanfoten.',
	archived: false,
	log: [{ sessionId: 's_20261006', date: '2026-10-06', sets: [{ weight: 40, reps: 8 }] }]
};

describe('validering', () => {
	it('godkänner exemplen i README.md', () => {
		expect(assertValid('övning', marklyft, validateExercise)).toEqual(marklyft);
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
	});

	it('kräver set som passar övningstypen', () => {
		const bad = { ...marklyft, log: [{ date: '2026-10-06', sets: [{ reps: 8 }] }] };
		expect(() => assertValid('övning', bad, validateExercise)).toThrow(/log\[0\]\.sets\[0\]\.weight/);
	});

	it('kräver loadClass för weight och samlar alla fel', () => {
		try {
			assertValid('övning', { ...marklyft, loadClass: undefined, archived: 'nej', id: 'ex marklyft' }, validateExercise);
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(ValidationError);
			expect((e as ValidationError).issues).toHaveLength(3);
		}
	});

	it('tar bort okända fält', () => {
		const result = assertValid('övning', { ...marklyft, extra: 1 }, validateExercise);
		expect(result).not.toHaveProperty('extra');
	});
});
