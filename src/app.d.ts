// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

declare module '@auth/core/types' {
	interface Session {
		roles?: string[];
	}
}

declare module '@auth/core/jwt' {
	interface JWT {
		accessToken?: string;
		idToken?: string;
		roles?: string[];
		authAt?: number;
	}
}

export {};
