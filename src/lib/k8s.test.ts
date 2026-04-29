// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { age } from './k8s';

describe('age', () => {
	const NOW = new Date('2026-04-29T00:00:00Z').getTime();

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns "—" when timestamp is missing', () => {
		expect(age(undefined)).toBe('—');
	});

	it('formats sub-minute durations as seconds', () => {
		expect(age(new Date(NOW - 30_000))).toBe('30s');
		expect(age(new Date(NOW))).toBe('0s');
	});

	it('rolls over to minutes at 60s', () => {
		expect(age(new Date(NOW - 60_000))).toBe('1m');
		expect(age(new Date(NOW - 90_000))).toBe('1m');
		expect(age(new Date(NOW - 59 * 60_000))).toBe('59m');
	});

	it('rolls over to hours at 60m', () => {
		expect(age(new Date(NOW - 60 * 60_000))).toBe('1h');
		expect(age(new Date(NOW - 47 * 60 * 60_000))).toBe('47h');
	});

	it('rolls over to days at 48h', () => {
		expect(age(new Date(NOW - 48 * 60 * 60_000))).toBe('2d');
		expect(age(new Date(NOW - 7 * 24 * 60 * 60_000))).toBe('7d');
	});

	it('clamps negative deltas (clock skew) to 0s', () => {
		// Future timestamps shouldn't render as negative-N
		expect(age(new Date(NOW + 60_000))).toBe('0s');
	});

	it('accepts ISO strings as well as Date objects', () => {
		const ts = new Date(NOW - 5 * 60_000).toISOString();
		expect(age(ts)).toBe('5m');
	});
});
