import { error } from '@sveltejs/kit';
import { getSessionDetail } from '$lib/server/data';
import { storageFor } from '$lib/server/storage';
import type { PageServerLoad } from './$types';

/** One saved session with its sets, for viewing and correcting afterwards. */
export const load: PageServerLoad = async ({ locals, params, depends }) => {
	depends('app:session');
	const detail = await getSessionDetail(storageFor(locals), params.id);
	if (!detail) error(404, 'Passet finns inte');
	return detail;
};
