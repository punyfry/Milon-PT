#!/usr/bin/env node
/**
 * Creates an Auth.js session cookie for local browser tests, so you don't
 * have to sign in with Google. Only for a local server started with the
 * same AUTH_SECRET.
 *
 *   node .claude/skills/deliver/scripts/session-cookie.mjs <AUTH_SECRET> [email] [userId]
 *
 * Prints the cookie value to stdout. The cookie name is authjs.session-token
 * (on http://localhost; over https it is __Secure-authjs.session-token).
 */
import { encode } from '@auth/core/jwt';

const [secret, email = 'test@example.com', userId = 'testuser1'] = process.argv.slice(2);
if (!secret) {
	console.error('Usage: session-cookie.mjs <AUTH_SECRET> [email] [userId]');
	process.exit(1);
}
const salt = 'authjs.session-token';
const token = await encode({ token: { name: 'Test', email, sub: userId, userId }, secret, salt, maxAge: 60 * 60 });
process.stdout.write(token);
