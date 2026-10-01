import type { HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { handle as authHandle } from './auth';
import { csrfHandle } from '$lib/csrf.server';

export const handle = sequence(csrfHandle, authHandle);

export const handleError: HandleServerError = ({ error, event, status, message }) => {
	console.error('[handleError]', event.request.method, event.url.pathname, status, message);
	console.error(error);
	return { message: 'Internal Error' };
};
