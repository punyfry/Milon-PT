// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Set by hooks.server.ts for signed-in, allowlisted users. */
			user: { id: string; email: string; name: string | null } | null;
		}
		// interface PageData {}
		interface PageState {
			/** The intro's step and choice, for its history entries (see src/routes/valkommen). */
			introStep?: number;
			introChoice?: 'on' | 'off' | null;
			/** How many intro entries were pushed up to this one, so its back arrow never leaves the intro. */
			introDepth?: number;
		}
		// interface Platform {}
	}
}

declare module '@auth/core/jwt' {
	interface JWT {
		userId?: string;
	}
}

export {};
