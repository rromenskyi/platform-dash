// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { redactHeaders } from './http-headers';

describe('redactHeaders', () => {
	it('blanks credential headers and keeps the rest', () => {
		const out = redactHeaders([
			{ key: 'Authorization', value: 'Bearer abc', on: true },
			{ key: 'cookie', value: 'a=b', on: true },
			{ key: 'X-Auth-Token', value: 't', on: false },
			{ key: 'X-API-Key', value: 'k', on: true },
			{ key: 'Accept', value: 'application/json', on: true }
		]);
		expect(out.map((h) => h.value)).toEqual(['', '', '', '', 'application/json']);
		expect(out[2].on).toBe(false);
	});
});
