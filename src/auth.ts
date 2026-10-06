import { SvelteKitAuth } from '@auth/sveltekit';
import Google from '@auth/sveltekit/providers/google';
import { env } from '$env/dynamic/private';
import { isAllowedEmail } from '$lib/server/allowlist';

export const { handle, signIn, signOut } = SvelteKitAuth(async () => ({
	providers: [
		// Auth.js looks for AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET by default, so the
		// credentials are passed in explicitly from our own variable names.
		Google({
			clientId: env.GOOGLE_OAUTH_CLIENT_ID,
			clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET
		})
	],
	secret: env.AUTH_SECRET,
	trustHost: true,
	session: { strategy: 'jwt' },
	pages: {
		signIn: '/login',
		error: '/login'
	},
	callbacks: {
		signIn({ account, profile }) {
			if (account?.provider !== 'google') return false;
			if (!profile?.email_verified) return false;
			return isAllowedEmail(profile.email);
		},
		jwt({ token, account }) {
			// Google's stable user ID (the `sub` claim) is our userId.
			if (account?.provider === 'google') token.userId = account.providerAccountId;
			return token;
		},
		session({ session, token }) {
			if (typeof token.userId === 'string') session.user.id = token.userId;
			return session;
		}
	}
}));
