// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { withDeadline } from './index';

describe('withDeadline', () => {
	it('hands a value that arrives after the deadline to onLate', async () => {
		vi.useFakeTimers();
		let resolve!: (v: string) => void;
		const p = new Promise<string>((r) => (resolve = r));
		const onLate = vi.fn();
		const raced = withDeadline(p, 100, 'conn', onLate);
		const assertion = expect(raced).rejects.toThrow('conn timed out after 100ms');
		await vi.advanceTimersByTimeAsync(100);
		await assertion;
		resolve('client');
		await vi.runAllTimersAsync();
		expect(onLate).toHaveBeenCalledWith('client');
		vi.useRealTimers();
	});

	it('does not call onLate when the value wins the race', async () => {
		const onLate = vi.fn();
		await expect(withDeadline(Promise.resolve(1), 100, 'x', onLate)).resolves.toBe(1);
		expect(onLate).not.toHaveBeenCalled();
	});
});
