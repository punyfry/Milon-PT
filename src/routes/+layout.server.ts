import type { LayoutServerLoad } from './$types';

/** Inloggad användare, så att köade pass bara skickas för rätt konto. */
export const load: LayoutServerLoad = ({ locals }) => ({ userId: locals.user?.id ?? null });
