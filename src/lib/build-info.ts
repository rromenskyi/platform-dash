// Build-time identity, populated by vite.config.ts via `define`. The
// CI Docker build passes `GIT_SHA=${{ github.sha }}` as a build-arg;
// local `npm run build` falls back to the current HEAD; dev mode and
// tests resolve to the string "dev".

declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

export const BUILD_SHA: string = __BUILD_SHA__;
export const BUILD_TIME: string = __BUILD_TIME__;
export const BUILD_SHA_SHORT: string = BUILD_SHA.slice(0, 7);

export const REPO_URL = 'https://github.com/rromenskyi/platform-dash';
export const COMMIT_URL: string =
	BUILD_SHA === 'dev' ? REPO_URL : `${REPO_URL}/commit/${BUILD_SHA}`;
