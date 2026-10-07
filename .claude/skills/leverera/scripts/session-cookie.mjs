#!/usr/bin/env node
/**
 * Skapar en Auth.js-sessionscookie för lokala webbläsartester, så att man
 * slipper logga in med Google. Används bara mot en lokal server som startats
 * med samma AUTH_SECRET.
 *
 *   node .claude/skills/leverera/scripts/session-cookie.mjs <AUTH_SECRET> [e-post] [userId]
 *
 * Skriver cookievärdet på stdout. Cookienamnet är authjs.session-token
 * (http://localhost; på https heter den __Secure-authjs.session-token).
 */
import { encode } from '@auth/core/jwt';

const [secret, email = 'test@example.com', userId = 'testuser1'] = process.argv.slice(2);
if (!secret) {
	console.error('Användning: session-cookie.mjs <AUTH_SECRET> [e-post] [userId]');
	process.exit(1);
}
const salt = 'authjs.session-token';
const token = await encode({ token: { name: 'Test', email, sub: userId, userId }, secret, salt, maxAge: 60 * 60 });
process.stdout.write(token);
