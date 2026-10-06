import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../model';
import { createExercise, getExercise, listLatestWorkouts, saveWorkoutVersion } from '../data';
import { MemoryUserStorage } from '../storage/memory';
import { applyImport, parseImportFile, planImportFor } from './craft';

const example = JSON.parse(readFileSync('scripts/import-example.json', 'utf8'));
const TODAY = '2026-10-06';

async function runImport(storage: MemoryUserStorage, raw: unknown) {
	const plan = await planImportFor(storage, parseImportFile(raw), TODAY);
	await applyImport(storage, plan);
	return plan;
}

describe('import från Craft', () => {
	it('importerar exempelfilen till tom lagring', async () => {
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

	it('är idempotent när samma fil körs igen', async () => {
		const storage = new MemoryUserStorage('u1');
		await runImport(storage, example);
		const second = await runImport(storage, example);
		expect(second.exercises.every((p) => p.action === 'unchanged')).toBe(true);
		expect(second.workouts.every((p) => p.action === 'unchanged')).toBe(true);
		expect((await storage.list('workouts/')).length).toBe(1);
	});

	it('matchar befintliga övningar på namn och slår ihop loggen', async () => {
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

	it('skapar en ny passversion när innehållet ändrats', async () => {
		const storage = new MemoryUserStorage('u1');
		await runImport(storage, example);
		const changed = structuredClone(example);
		changed.workouts[0].exercises[0].sets = 4;
		const plan = await runImport(storage, changed);
		expect(plan.workouts[0]).toMatchObject({ action: 'new-version', workout: { version: 2 } });
		expect((await storage.list('workouts/')).length).toBe(2);
	});

	it('kan referera till övningar som bara finns i appen', async () => {
		const storage = new MemoryUserStorage('u1');
		await createExercise(storage, { name: 'Axelpress', type: 'weight', loadClass: 'light', instruction: '' });
		await saveWorkoutVersion(storage, { slug: 'pass-c', name: 'Pass C', createdAt: TODAY, exercises: [] });
		const plan = await runImport(storage, {
			workouts: [{ name: 'Pass C', exercises: [{ name: 'axelpress', sets: 3, target: { reps: 10 } }] }]
		});
		expect(plan.workouts[0]).toMatchObject({ action: 'new-version', workout: { version: 2 } });
	});

	it('sätter loadClass light med varning när den saknas', async () => {
		const storage = new MemoryUserStorage('u1');
		const plan = await runImport(storage, {
			exercises: [{ name: 'Bicepscurl', type: 'weight', log: [] }]
		});
		expect(plan.exercises[0].exercise.loadClass).toBe('light');
		expect(plan.warnings).toHaveLength(1);
	});

	it('samlar alla fel i filen och skriver ingenting', async () => {
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

	it('stoppar okända övningar, fel måltyp och typkrockar före skrivning', async () => {
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
