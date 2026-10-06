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
		// interface PageState {}
		// interface Platform {}
	}
}

declare module '@auth/core/jwt' {
	interface JWT {
		userId?: string;
	}
}

export {};
