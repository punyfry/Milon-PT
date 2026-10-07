import type { LayoutServerLoad } from './$types';

/** Signed-in user: id so queued workouts are only sent for the right account, first name for the greeting. */
export const load: LayoutServerLoad = ({ locals }) => ({
	userId: locals.user?.id ?? null,
	firstName: locals.user?.name?.trim().split(/\s+/)[0] ?? null
});
