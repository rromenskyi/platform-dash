// Header values that are credentials. The HTTP tester persists its
// draft and history to localStorage; these values are blanked first
// so a bearer token used for one test doesn't sit on disk forever.
const SENSITIVE = /^(authorization|proxy-authorization|cookie|set-cookie)$|token|secret|api[-_]?key|password/i;

export function isSensitiveHeader(key: string): boolean {
	return SENSITIVE.test(key.trim());
}

export function redactHeaders<H extends { key: string; value: string }>(headers: H[]): H[] {
	return headers.map((h) => (isSensitiveHeader(h.key) ? { ...h, value: '' } : h));
}
