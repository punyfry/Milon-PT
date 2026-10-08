import type { Profile } from './types';

/** Milon is on unless the user has turned him off. */
export function coachEnabled(profile: Profile): boolean {
	return profile.coach !== false;
}
