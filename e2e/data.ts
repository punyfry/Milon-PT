import type { Exercise, Profile, WorkoutTemplate } from '../src/lib/model/types';

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
