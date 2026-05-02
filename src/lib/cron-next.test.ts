// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { nextRunAt, parseCron, fmtCountdown } from './cron-next';

// Use local time — cron-next reads getHours/getMinutes/etc which are
// local. CI / local-dev TZs differ, so building these via `new Date(...)`
// (local) keeps the test stable.
const FRI_NOON = new Date(2026, 4, 1, 12, 0, 0).getTime(); // local Fri 12:00

describe('parseCron', () => {
	it('rejects non-5-field input', () => {
		expect(parseCron('* * * *')).toBeNull();
		expect(parseCron('* * * * * *')).toBeNull();
		expect(parseCron('')).toBeNull();
	});
	it('parses bare star', () => {
		const c = parseCron('* * * * *');
		expect(c).not.toBeNull();
		expect(c!.minute.size).toBe(60);
		expect(c!.hour.size).toBe(24);
	});
	it('parses */n step', () => {
		const c = parseCron('*/5 * * * *');
		expect(Array.from(c!.minute).sort((a, b) => a - b)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
	});
	it('parses range', () => {
		const c = parseCron('0 9-17 * * *');
		expect(Array.from(c!.hour).sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
	});
	it('folds dow=7 to 0', () => {
		const c = parseCron('0 0 * * 7');
		expect(c!.dow.has(0)).toBe(true);
	});
});

describe('nextRunAt', () => {
	it('every minute → next minute boundary', () => {
		const got = nextRunAt('* * * * *', FRI_NOON);
		expect(got).toBe(new Date(2026, 4, 1, 12, 1, 0).getTime());
	});
	it('every 5 min from 12:00 → 12:05', () => {
		const got = nextRunAt('*/5 * * * *', FRI_NOON);
		expect(got).toBe(new Date(2026, 4, 1, 12, 5, 0).getTime());
	});
	it('daily at 02:00 → tomorrow 02:00', () => {
		const got = nextRunAt('0 2 * * *', FRI_NOON);
		expect(got).toBe(new Date(2026, 4, 2, 2, 0, 0).getTime());
	});
	it('returns null for invalid expression', () => {
		expect(nextRunAt('not a cron', FRI_NOON)).toBeNull();
	});
});

describe('fmtCountdown', () => {
	it('formats seconds', () => {
		expect(fmtCountdown(45_000)).toBe('45s');
	});
	it('formats minutes + seconds', () => {
		expect(fmtCountdown(125_000)).toBe('2m 5s');
	});
	it('formats hours + minutes', () => {
		expect(fmtCountdown(3 * 3600_000 + 7 * 60_000)).toBe('3h 7m');
	});
	it('shows now for negative', () => {
		expect(fmtCountdown(-100)).toBe('now');
	});
});
