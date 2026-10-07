import { sequence } from '@sveltejs/kit/hooks';
import { handle as authHandle } from './auth';
import { authorization } from '$lib/server/security/guard';
import { securityHeaders } from '$lib/server/security/headers';

export const handle = sequence(securityHeaders, authHandle, authorization);
