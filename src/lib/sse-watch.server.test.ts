// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Done = (err: unknown) => void;
const state: { done?: Done; abort: ReturnType<typeof vi.fn>; gate?: Promise<void> } = {
	abort: vi.fn()
};

vi.mock('@kubernetes/client-node', () => ({
	Watch: class {
		async watch(_p: string, _q: unknown, _cb: unknown, done: Done) {
			state.done = done;
			if (state.gate) await state.gate;
			return { abort: state.abort } as unknown as AbortController;
		}
	}
}));
vi.mock('$lib/clusters.server', () => ({ isKnownCluster: () => true, getKubeConfig: () => ({}) }));

const { buildWatchResponse } = await import('./sse-watch.server');

function call(signal: AbortSignal = new AbortController().signal) {
	return buildWatchResponse(
		(cluster) => ({ cluster, pathFor: () => '/api/v1/namespaces', mapItem: (x) => x as never }),
		{
			params: { cluster: 'local' },
			url: new URL('http://x/'),
			locals: { auth: async () => ({ user: {}, roles: ['platform_admin'], expires: '' }) },
			request: { signal } as Request
		}
	);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('buildWatchResponse teardown', () => {
	beforeEach(() => {
		state.abort = vi.fn();
		state.done = undefined;
		state.gate = undefined;
	});

	it('aborts the upstream watch when the stream is cancelled', async () => {
		const res = await call();
		await tick();
		await res.body!.cancel();
		expect(state.abort).toHaveBeenCalledOnce();
	});

	it('closes the SSE stream when the upstream watch ends', async () => {
		const res = await call();
		const reader = res.body!.getReader();
		await tick();
		state.done!(null);
		await expect(reader.read()).resolves.toMatchObject({ done: true });
	});

	it('aborts a watch that finishes opening after the client left', async () => {
		let open!: () => void;
		state.gate = new Promise((r) => (open = r));
		const ac = new AbortController();
		const res = await call(ac.signal);
		res.body!.getReader();
		await tick();
		ac.abort();
		open();
		await tick();
		expect(state.abort).toHaveBeenCalledOnce();
	});
});
