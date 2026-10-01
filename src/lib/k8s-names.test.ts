// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isNamespaceName, isObjectName } from './k8s-names';

describe('isNamespaceName', () => {
	it.each(['default', 'kube-system', 'a', 'team-a1'])('accepts %s', (s) => {
		expect(isNamespaceName(s)).toBe(true);
	});

	it.each([
		'',
		'..',
		'../secrets',
		'team-a/../platform',
		'Team',
		'-a',
		'a-',
		'a.b',
		'a%2Fb',
		'a?b',
		'a#',
		'x'.repeat(64),
		null,
		undefined
	])('rejects %s', (s) => {
		expect(isNamespaceName(s)).toBe(false);
	});
});

describe('isObjectName', () => {
	it.each(['nginx-7d9f8-abcde', 'a.b.c', 'x'.repeat(253)])('accepts %s', (s) => {
		expect(isObjectName(s)).toBe(true);
	});

	it.each([
		'',
		'..',
		'a..b',
		'../../../secrets#',
		'..%2F..%2Fsecrets',
		'pod/exec',
		'pod?x=1',
		'Pod',
		'.a',
		'a.',
		'x'.repeat(254),
		null
	])('rejects %s', (s) => {
		expect(isObjectName(s)).toBe(false);
	});
});
