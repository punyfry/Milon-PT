import type { Exercise, Profile, SessionRecord, WorkoutTemplate } from '../src/lib/model/types';

/** Builders for seeded files. Keep them minimal; tests add what they need. */

export function profile(overrides: Partial<Profile> = {}): Record<string, Profile> {
	return { 'profile.json': { onboardedAt: '2026-01-01', ...overrides } };
}

export function exercise(e: Partial<Exercise> & Pick<Exercise, 'id' | 'name'>): Record<string, Exercise> {
	return { [`exercises/${e.id}.json`]: { type: 'weight', instruction: '', log: [], ...e } };
}

export function workout(w: Partial<WorkoutTemplate> & Pick<WorkoutTemplate, 'slug' | 'name' | 'exercises'>): Record<string, WorkoutTemplate> {
	const t = { version: 1, createdAt: '2026-01-01', ...w };
	return { [`workouts/${t.slug}.v${t.version}.json`]: t };
}

/** A saved session record. Put matching entries in the exercises' logs (`exercise({ log })`) for its sets. */
export function session(s: Partial<SessionRecord> & Pick<SessionRecord, 'id' | 'workoutSlug' | 'startedAt' | 'endedAt' | 'exerciseIds'>): Record<string, SessionRecord> {
	return { [`sessions/${s.id}.json`]: { workoutVersion: 1, deviations: [], ...s } };
}
