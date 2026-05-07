// Shared "is this pod currently in trouble" predicate. Used by the
// topbar incident pill (`incident-summary.server.ts`) and the full
// `/incident` page (`incident/+page.server.ts`) so both surfaces
// agree on what counts as failing.
//
// Older versions of this code used `containers.reduce(restartCount) >= 3`
// as part of the predicate. That signal was sticky: a pod that
// crashed a few times last week but has been Running+Ready for days
// stayed flagged as an "incident" forever. The count-up never
// reverted to clean even when the pod recovered, which read to
// operators as "incidents добавляются но не чистятся правильно" —
// a number that only grows.
//
// Current rule (transient signals only — they self-clear when k8s
// itself stops complaining):
//   - phase === 'Failed' / 'Unknown'                       (terminal trouble)
//   - phase === 'Pending' with a container waiting        (ImagePullBackOff,
//                                                          CreateContainerConfigError,
//                                                          etc — covers cluster
//                                                          /scheduling problems)
//   - phase === 'Running' with at least one un-ready
//     container                                            (CrashLoopBackOff
//                                                          surfaces here:
//                                                          backing-off containers
//                                                          report ready=false)
//
// "Succeeded" pods (Job/CronJob terminations) never count, even if
// they accumulated restarts on the way to success.

type ContainerLike = {
	ready?: boolean;
	state?: { waiting?: { reason?: string } };
};

type PodLike = {
	status?: {
		phase?: string;
		containerStatuses?: ContainerLike[];
	};
};

export function isPodFailing(p: PodLike): boolean {
	const phase = p.status?.phase ?? '?';
	if (phase === 'Succeeded') return false;
	if (phase === 'Failed' || phase === 'Unknown') return true;

	const containers = p.status?.containerStatuses ?? [];
	const waiting = containers.find((c) => c.state?.waiting)?.state?.waiting?.reason;
	if (phase === 'Pending' && !!waiting) return true;
	if (phase === 'Running' && containers.some((c) => !c.ready)) return true;
	return false;
}
