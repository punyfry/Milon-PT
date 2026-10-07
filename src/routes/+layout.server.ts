import type { LayoutServerLoad } from './$types';

/** Signed-in user, so queued sessions are only sent for the right account. */
export const load: LayoutServerLoad = ({ locals }) => ({ userId: locals.user?.id ?? null });
