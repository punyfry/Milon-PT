/** "Pass B" → "pass-b", "Böj & sträck" → "boj-strack". */
export function slugify(name: string): string {
	return name
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

/** "Marklyft" → "ex_marklyft", "Hantel­press sittande" → "ex_hantelpress_sittande". */
export function exerciseIdBase(name: string): string {
	const slug = slugify(name).replace(/-/g, '_');
	return `ex_${slug || 'ovning'}`;
}

/** Appends `_2`, `_3`, … until the id is free. */
export function uniqueId(base: string, taken: ReadonlySet<string>, sep = '_'): string {
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}${sep}${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** "2026-10-06" → "s_20261006", with a suffix for several sessions on the same day. */
export function sessionIdFor(date: string, taken: ReadonlySet<string>): string {
	return uniqueId(`s_${date.replaceAll('-', '')}`, taken);
}

/** Temporary id for an exercise written in during a session (see `NewSessionExercise`). */
export const NEW_EXERCISE_ID = /^new_[a-z0-9]{1,40}$/;

export function newExerciseId(): string {
	return `new_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Comparison key for exercise names: ignores case and whitespace. */
export function normalizeName(name: string): string {
	return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('sv');
}

/** The exercise in `list` that is the same as `input`: same type and the same name by `normalizeName`. */
export function findSameExercise<T extends { name: string; type: string }>(list: readonly T[], input: { name: string; type: string }): T | undefined {
	const key = normalizeName(input.name);
	return list.find((e) => e.type === input.type && normalizeName(e.name) === key);
}

export function workoutFileName(slug: string, version: number): string {
	return `${slug}.v${version}.json`;
}

const WORKOUT_FILE = /^([a-z0-9-]+)\.v(\d+)\.json$/;

export function parseWorkoutFileName(file: string): { slug: string; version: number } | null {
	const m = WORKOUT_FILE.exec(file);
	return m ? { slug: m[1], version: Number(m[2]) } : null;
}
