import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../model';
import { createExercise, createSession, getExercise, getProfile, listLatestWorkouts, listSessions, saveProfile, saveWorkoutVersion } from '../data';
import { kcalSuggestion } from '../../session/active';
import { MemoryUserStorage } from '../storage/memory';
import { applyImport, countWrites, parseImportFile, planImportFor } from './craft';

const example = JSON.parse(readFileSync('scripts/import-example.json', 'utf8'));
const TODAY = '2026-10-06';

async function runImport(storage: MemoryUserStorage, raw: unknown) {
	const plan = await planImportFor(storage, parseImportFile(raw), TODAY);
	await applyImport(storage, plan);
	return plan;
}

describe('import from Craft', () => {
	it('imports the example file into empty storage', async () => {
		const storage = new MemoryUserStorage('u1');
		const plan = await runImport(storage, example);
		expect(plan.exercises.map((p) => [p.action, p.exercise.id])).toEqual([
			['create', 'ex_marklyft'],
			['create', 'ex_plankan'],
			['create', 'ex_pull_up']
		]);
		const [workout] = await listLatestWorkouts(storage);
		expect(workout).toMatchObject({ slug: 'pass-a', version: 1, createdAt: TODAY });
		expect(workout.exercises.map((e) => e.exerciseId)).toEqual(['ex_marklyft', 'ex_plankan', 'ex_pull_up']);
	});

	it('is idempotent when the same file is run again', async () => {
		const storage = new MemoryUserStorage('u1');
		await runImport(storage, example);
		const second = await runImport(storage, example);
		expect(second.exercises.every((p) => p.action === 'unchanged')).toBe(true);
		expect(second.workouts.every((p) => p.action === 'unchanged')).toBe(true);
		expect((await storage.list('workouts/')).length).toBe(1);
	});

	it('matches existing exercises by name and merges the log', async () => {
		const storage = new MemoryUserStorage('u1');
		await createExercise(storage, {
			name: 'marklyft',
			type: 'weight',
			loadClass: 'heavy',
			instruction: 'Befintlig instruktion',
			log: [{ sessionId: 's_20261001', date: '2026-10-01', sets: [{ weight: 42.5, reps: 8 }] }]
		});
		const plan = await runImport(storage, {
			exercises: [
				{
					name: 'Marklyft',
					type: 'weight',
					instruction: 'Ny instruktion',
					log: [
						{ date: '2026-09-29', sets: [{ weight: 40, reps: 8 }] },
						{ date: '2026-10-03', sets: [{ weight: 45, reps: 6 }] }
					]
				}
			]
		});
		expect(plan.exercises[0]).toMatchObject({ action: 'update', addedLogEntries: 2 });
		const ex = (await getExercise(storage, 'ex_marklyft'))!.data;
		expect(ex.instruction).toBe('Befintlig instruktion');
		expect(ex.log.map((l) => l.date)).toEqual(['2026-10-03', '2026-10-01', '2026-09-29']);
	});

	it('creates a new workout version when the content changed', async () => {
		const storage = new MemoryUserStorage('u1');
		await runImport(storage, example);
		const changed = structuredClone(example);
		changed.workouts[0].exercises[0].sets = 4;
		const plan = await runImport(storage, changed);
		expect(plan.workouts[0]).toMatchObject({ action: 'new-version', workout: { version: 2 } });
		expect((await storage.list('workouts/')).length).toBe(2);
	});

	it('can reference exercises that only exist in the app', async () => {
		const storage = new MemoryUserStorage('u1');
		await createExercise(storage, { name: 'Axelpress', type: 'weight', loadClass: 'light', instruction: '' });
		await saveWorkoutVersion(storage, { slug: 'pass-c', name: 'Pass C', createdAt: TODAY, exercises: [] });
		const plan = await runImport(storage, {
			workouts: [{ name: 'Pass C', exercises: [{ name: 'axelpress', sets: 3, target: { reps: 10 } }] }]
		});
		expect(plan.workouts[0]).toMatchObject({ action: 'new-version', workout: { version: 2 } });
	});

	it('sets loadClass light with a warning when missing', async () => {
		const storage = new MemoryUserStorage('u1');
		const plan = await runImport(storage, {
			exercises: [{ name: 'Bicepscurl', type: 'weight', log: [] }]
		});
		expect(plan.exercises[0].exercise.loadClass).toBe('light');
		expect(plan.warnings).toHaveLength(1);
	});

	it('collects all errors in the file and writes nothing', async () => {
		const bad = {
			exercises: [
				{ name: 'Marklyft', type: 'weight', log: [{ date: '29/9', sets: [{ reps: 8 }] }] },
				{ name: 'marklyft', type: 'styrka' }
			],
			workouts: [{ name: 'Pass A', exercises: [{ name: 'Marklyft', sets: 0, target: { reps: 8 } }] }]
		};
		try {
			parseImportFile(bad);
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(ValidationError);
			const issues = (e as ValidationError).issues.join('\n');
			expect(issues).toMatch(/exercises\[0\]\.log\[0\]\.date/);
			expect(issues).toMatch(/exercises\[0\]\.log\[0\]\.sets\[0\]\.weight/);
			expect(issues).toMatch(/exercises\[1\]\.name/);
			expect(issues).toMatch(/exercises\[1\]\.type/);
			expect(issues).toMatch(/workouts\[0\]\.exercises\[0\]\.sets/);
		}
	});

	it('stops unknown exercises, wrong target type and type clashes before writing', async () => {
		const storage = new MemoryUserStorage('u1');
		await createExercise(storage, { name: 'Plankan', type: 'time', instruction: '' });
		const input = parseImportFile({
			exercises: [{ name: 'Plankan', type: 'bodyweight', log: [] }],
			workouts: [
				{
					name: 'Pass A',
					exercises: [
						{ name: 'Okänd', sets: 3, target: { reps: 8 } },
						{ name: 'Plankan', sets: 3, target: { reps: 8 } }
					]
				}
			]
		});
		const error = await planImportFor(storage, input, TODAY).catch((e: ValidationError) => e);
		expect(error).toBeInstanceOf(ValidationError);
		expect((error as ValidationError).issues).toEqual([
			'"Plankan" är bodyweight i filen men time i appen (ex_plankan)',
			'Passet "Pass A" använder "Okänd", som varken finns i filen eller i appen',
			'Passet "Pass A": målet för "Plankan" ska anges i seconds (time)'
		]);
		expect((await storage.list()).length).toBe(1);
	});
});

describe('import with profile, notes and sessions', () => {
	const full = {
		profile: {
			goals: ['Klara en pull-up', 'Stå på händerna'],
			rules: ['Tränar kvällar'],
			kcalEstimates: { strength: { min: 250, max: 350 }, hiit: { min: 300, max: 450 } }
		},
		exercises: [
			{
				name: 'Marklyft',
				type: 'weight',
				loadClass: 'heavy',
				instruction: '',
				log: [
					{ date: '2026-09-29', sets: [{ weight: 30, reps: 10 }], note: 'Marginal kvar' },
					{ date: '2026-09-21', sets: [{ weight: 25, reps: 10 }] }
				]
			},
			{
				name: 'Planka',
				type: 'time',
				instruction: '',
				log: [{ date: '2026-09-29', sets: [{ seconds: 30 }] }]
			},
			{ name: 'Wheel out', type: 'bodyweight', archived: true, instruction: '', log: [{ date: '2026-09-27', sets: [{ reps: 8 }] }] }
		],
		workouts: [
			{ name: 'Pass A', exercises: [{ name: 'Marklyft', sets: 3, target: { reps: 10 } }, { name: 'Planka', sets: 3, target: { seconds: 30 } }] },
			{ name: 'Pass C – HIIT', exercises: [{ name: 'Planka', sets: 4, target: { seconds: 40 } }] }
		],
		sessions: [
			{ date: '2026-09-29', workout: 'Pass A', kcalEstimate: 300 },
			{ date: '2026-09-21', workout: 'Pass A' }
		]
	};

	it('creates profile and sessions and links log entries to their sessions', async () => {
		const storage = new MemoryUserStorage('u1');
		const plan = await runImport(storage, full);
		expect(plan.profile).toMatchObject({ action: 'create', changes: ['mål', '1 regler', 'kcal för styrka', 'kcal för HIIT'] });

		const profile = (await getProfile(storage)).data;
		expect(profile.goals).toBe('- Klara en pull-up\n- Stå på händerna');
		expect(profile.kcalEstimates?.hiit).toEqual({ min: 300, max: 450 });

		const sessions = await listSessions(storage);
		expect(sessions.map((s) => [s.id, s.workoutSlug, s.workoutVersion, s.startedAt, s.exerciseIds, s.kcalEstimate])).toEqual([
			['s_20260929', 'pass-a', 1, '2026-09-29T12:00:00+02:00', ['ex_marklyft', 'ex_planka'], 300],
			['s_20260921', 'pass-a', 1, '2026-09-21T12:00:00+02:00', ['ex_marklyft'], undefined]
		]);

		const marklyft = (await getExercise(storage, 'ex_marklyft'))!.data;
		expect(marklyft.log[0]).toEqual({ sessionId: 's_20260929', date: '2026-09-29', sets: [{ weight: 30, reps: 10 }], note: 'Marginal kvar' });
		expect(marklyft.log[1].sessionId).toBe('s_20260921');
		// Day without a session in the file: no link.
		expect((await getExercise(storage, 'ex_wheel_out'))!.data).toMatchObject({ archived: true, log: [{ date: '2026-09-27' }] });
		expect((await getExercise(storage, 'ex_wheel_out'))!.data.log[0].sessionId).toBeUndefined();
	});

	it('is idempotent and never overwrites an existing profile', async () => {
		const storage = new MemoryUserStorage('u1');
		await saveProfile(storage, { goals: 'Mina egna mål', rules: ['Tränar kvällar'], weeklySessionGoal: 3 });
		const first = await runImport(storage, full);
		expect(first.profile).toMatchObject({ action: 'update', changes: ['kcal för styrka', 'kcal för HIIT'] });
		expect((await getProfile(storage)).data).toMatchObject({ goals: 'Mina egna mål', rules: ['Tränar kvällar'], weeklySessionGoal: 3 });

		const second = await runImport(storage, full);
		expect(countWrites(second)).toBe(0);
		expect(second.sessions.every((s) => s.action === 'unchanged')).toBe(true);
		expect((await listSessions(storage)).length).toBe(2);
	});

	it('enriches existing log entries with note and session link', async () => {
		const storage = new MemoryUserStorage('u1');
		await runImport(storage, { exercises: [{ ...full.exercises[0], log: full.exercises[0].log.map((e) => ({ date: e.date, sets: e.sets })) }] });
		expect((await getExercise(storage, 'ex_marklyft'))!.data.log[0].note).toBeUndefined();

		const plan = await runImport(storage, full);
		expect(plan.exercises[0]).toMatchObject({ action: 'update', addedLogEntries: 0, changes: ['2 loggposter kompletterade'] });
		const log = (await getExercise(storage, 'ex_marklyft'))!.data.log;
		expect(log).toHaveLength(2);
		expect(log[0]).toMatchObject({ note: 'Marginal kvar', sessionId: 's_20260929' });
	});

	it('gives the second session on the same day its own id and avoids clashing with existing sessions', async () => {
		const storage = new MemoryUserStorage('u1');
		await runImport(storage, { ...full, sessions: [] });
		await createSession(storage, {
			id: 's_20260929',
			workoutSlug: 'pass-c-hiit',
			workoutVersion: 1,
			startedAt: '2026-09-29T18:00:00+02:00',
			endedAt: '2026-09-29T19:00:00+02:00',
			exerciseIds: [],
			deviations: []
		});
		const plan = await runImport(storage, full);
		expect(plan.sessions.map((s) => s.session.id)).toEqual(['s_20260921', 's_20260929_2']);
	});

	it('reuses a session on the same day already logged in the app', async () => {
		const storage = new MemoryUserStorage('u1');
		await runImport(storage, { ...full, sessions: [] });
		await createSession(storage, {
			id: 's_20260929',
			workoutSlug: 'pass-a',
			workoutVersion: 1,
			startedAt: '2026-09-29T18:00:00+02:00',
			endedAt: '2026-09-29T19:00:00+02:00',
			exerciseIds: ['ex_marklyft'],
			deviations: []
		});
		const plan = await runImport(storage, full);
		expect(plan.sessions.map((s) => [s.session.id, s.action])).toEqual([
			['s_20260921', 'create'],
			['s_20260929', 'unchanged']
		]);
		expect((await listSessions(storage)).length).toBe(2);
		expect((await getExercise(storage, 'ex_marklyft'))!.data.log[0].sessionId).toBe('s_20260929');
	});

	it('ignores session ids in the file and writes sessions first', async () => {
		const storage = new MemoryUserStorage('u1');
		const written: string[] = [];
		const write = storage.writeJson.bind(storage);
		storage.writeJson = (path, data, opts) => (written.push(path), write(path, data, opts));
		const input = {
			...full,
			exercises: [full.exercises[0], { ...full.exercises[1], log: [{ sessionId: 's_20261007', date: '2026-09-27', sets: [{ seconds: 30 }] }] }]
		};
		await runImport(storage, input);
		expect((await getExercise(storage, 'ex_planka'))!.data.log[0].sessionId).toBeUndefined();
		expect(written.slice(0, 2).every((p) => p.startsWith('sessions/'))).toBe(true);
	});

	it('rejects dates that don\'t exist', () => {
		expect(() => parseImportFile({ sessions: [{ date: '2025-02-29', workout: 'Pass A' }] })).toThrow(/sessions\[0\]\.date/);
		expect(() =>
			parseImportFile({ exercises: [{ name: 'X', type: 'bodyweight', instruction: '', log: [{ date: '2026-04-31', sets: [{ reps: 1 }] }] }] })
		).toThrow(/date/);
	});

	it('stops sessions with invalid fields and an invalid profile', () => {
		expect(() => parseImportFile({ profile: { goals: [1], kcalEstimates: { yoga: { min: 1, max: 2 } } } })).toThrow(
			/profile\.goals[\s\S]*profile\.kcalEstimates\.yoga/
		);
		expect(() => parseImportFile({ sessions: [{ date: '29/9', workout: '' }] })).toThrow(/sessions\[0\]\.date[\s\S]*sessions\[0\]\.workout/);
	});

	it('rejects a session for a workout that doesn\'t exist', async () => {
		const storage = new MemoryUserStorage('u1');
		const input = parseImportFile({ sessions: [{ date: '2026-09-29', workout: 'Pass X' }] });
		await expect(planImportFor(storage, input, TODAY)).rejects.toThrow(/Pass X/);
	});

	it('suggests kcal per workout, per workout type, otherwise the default', () => {
		const profile = { kcalEstimates: { strength: { min: 250, max: 350 }, hiit: { min: 300, max: 450 } }, kcalPerWorkout: { 'pass-b': 280 } };
		expect(kcalSuggestion(profile, { slug: 'pass-b', name: 'Pass B' })).toBe(280);
		expect(kcalSuggestion(profile, { slug: 'pass-a', name: 'Pass A' })).toBe(300);
		expect(kcalSuggestion(profile, { slug: 'pass-c-hiit', name: 'Pass C – HIIT' })).toBe(380);
		expect(kcalSuggestion({}, { slug: 'pass-a', name: 'Pass A' })).toBe(300);
	});
});
