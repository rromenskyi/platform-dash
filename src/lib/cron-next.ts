// Tiny 5-field cron parser → next-run timestamp. Standard Unix syntax:
// minute hour day-of-month month day-of-week.
// Each field accepts:
//   *           — every value in range
//   n           — exact
//   a,b,c       — enumeration
//   a-b         — inclusive range
//   */n         — step from 0
//   a-b/n       — step within range
//
// Day-of-month and day-of-week use OR semantics when both are
// restricted, matching `man 5 crontab`. We compute by walking
// candidate minutes from `from + 1` upward, capped at 366 days so a
// pathological schedule (e.g. Feb 30) returns null instead of looping.

const RANGES: Array<[number, number]> = [
	[0, 59], // minute
	[0, 23], // hour
	[1, 31], // day-of-month
	[1, 12], // month
	[0, 6] // day-of-week (0 = Sun, 7 also Sun)
];

function parseField(raw: string, idx: number): Set<number> {
	const [lo, hi] = RANGES[idx];
	const out = new Set<number>();
	for (const part of raw.split(',')) {
		const [rangePart, stepStr] = part.split('/');
		const step = stepStr ? parseInt(stepStr, 10) : 1;
		if (!Number.isFinite(step) || step < 1) {
			throw new Error(`bad step in field ${idx}: ${part}`);
		}
		let a = lo;
		let b = hi;
		if (rangePart === '*') {
			// keep lo..hi
		} else if (rangePart.includes('-')) {
			const [s, e] = rangePart.split('-').map((x) => parseInt(x, 10));
			if (!Number.isFinite(s) || !Number.isFinite(e)) {
				throw new Error(`bad range in field ${idx}: ${rangePart}`);
			}
			a = s;
			b = e;
		} else {
			const n = parseInt(rangePart, 10);
			if (!Number.isFinite(n)) throw new Error(`bad value in field ${idx}: ${rangePart}`);
			a = n;
			b = stepStr ? hi : n; // bare `5/3` interprets as `5-hi/3`
		}
		for (let v = a; v <= b; v += step) {
			// Day-of-week 7 means Sunday too — fold into 0.
			out.add(idx === 4 && v === 7 ? 0 : v);
		}
	}
	return out;
}

export type CronExpr = {
	minute: Set<number>;
	hour: Set<number>;
	dom: Set<number>;
	month: Set<number>;
	dow: Set<number>;
	domStar: boolean;
	dowStar: boolean;
};

export function parseCron(schedule: string): CronExpr | null {
	const fields = schedule.trim().split(/\s+/);
	if (fields.length !== 5) return null;
	try {
		return {
			minute: parseField(fields[0], 0),
			hour: parseField(fields[1], 1),
			dom: parseField(fields[2], 2),
			month: parseField(fields[3], 3),
			dow: parseField(fields[4], 4),
			domStar: fields[2] === '*',
			dowStar: fields[4] === '*'
		};
	} catch {
		return null;
	}
}

export function nextRunAt(schedule: string, fromMs: number): number | null {
	const c = parseCron(schedule);
	if (!c) return null;
	// Round up to the next whole minute boundary.
	const start = new Date(fromMs);
	start.setSeconds(0, 0);
	start.setMinutes(start.getMinutes() + 1);
	for (let i = 0; i < 366 * 24 * 60; i++) {
		const m = start.getMinutes();
		const h = start.getHours();
		const dom = start.getDate();
		const mo = start.getMonth() + 1;
		const dow = start.getDay();
		if (c.month.has(mo) && c.minute.has(m) && c.hour.has(h)) {
			// dom + dow OR semantics: when both restricted, match either;
			// when one is `*`, only the other restricts.
			const domMatch = c.dom.has(dom);
			const dowMatch = c.dow.has(dow);
			const ok =
				c.domStar && c.dowStar
					? true
					: c.domStar
						? dowMatch
						: c.dowStar
							? domMatch
							: domMatch || dowMatch;
			if (ok) return start.getTime();
		}
		start.setMinutes(start.getMinutes() + 1);
	}
	return null;
}

export function fmtCountdown(ms: number): string {
	if (ms < 0) return 'now';
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ${m % 60}m`;
	const d = Math.floor(h / 24);
	return `${d}d ${h % 24}h`;
}
