import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Page from './+page.svelte';

describe('secret detail page', () => {
	it('renders unrevealed keys without throwing', () => {
		const { getAllByText } = render(Page, {
			props: {
				data: {
					cluster: 'local',
					ns: 'default',
					name: 's',
					type: 'Opaque',
					creationTimestamp: undefined,
					keys: [{ key: 'password', len: 12 }]
				}
			} as never
		});
		expect(getAllByText('reveal').length).toBe(1);
	});
});
