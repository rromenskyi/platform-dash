// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { roleBadge } from './authz';

const s = (roles: string[]) => ({ user: {}, roles, expires: '' });

describe('roleBadge', () => {
	it('labels the broadest access', () => {
		expect(roleBadge(s(['platform_admin']), ['local'])).toBe('admin');
		expect(roleBadge(s(['cluster_local_admin']), ['local'])).toBe('admin');
		expect(roleBadge(s(['platform_sre', 'namespace_a_admin']), ['local'])).toBe('sre');
		expect(roleBadge(s(['namespace_a_admin', 'namespace_b_sre']), ['local'])).toBe('ns admin');
		expect(roleBadge(s(['namespace_b_sre']), ['local'])).toBe('ns read');
		expect(roleBadge(s(['cluster_other_admin']), ['local'])).toBe('');
		expect(roleBadge(null, ['local'])).toBe('');
	});
});
