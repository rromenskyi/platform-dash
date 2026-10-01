// Kubernetes name validation. The SDK's generated API clients
// percent-encode path params, but `Log.log()`, `Exec.exec()` and our
// raw `Watch` paths interpolate them verbatim into the request URL —
// a decoded `../` in a route param would let a namespace-scoped user
// steer the request at a different API path (e.g. `/api/v1/secrets`).
// Validate before any authz decision or SDK call that builds a raw path.

// DNS-1123 label: namespaces, container names.
const DNS1123_LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
// DNS-1123 subdomain: most object names (pods, deployments, …).
const DNS1123_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

export function isNamespaceName(s: string | null | undefined): s is string {
	return typeof s === 'string' && DNS1123_LABEL.test(s);
}

export function isObjectName(s: string | null | undefined): s is string {
	return typeof s === 'string' && s.length <= 253 && DNS1123_SUBDOMAIN.test(s);
}
