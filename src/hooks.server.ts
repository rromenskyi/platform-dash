import type { HandleServerError } from '@sveltejs/kit';
import { handle } from './auth';

export { handle };

export const handleError: HandleServerError = ({ error, event, status, message }) => {
	console.error('[handleError]', event.request.method, event.url.pathname, status, message);
	console.error(error);
	return { message: 'Internal Error' };
};
