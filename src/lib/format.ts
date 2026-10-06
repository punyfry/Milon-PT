const rtf = new Intl.RelativeTimeFormat('sv', { numeric: 'always' });

/** Kalenderdagar mellan två datum (YYYY-MM-DD eller ISO-tid), i lokal tid. */
export function daysBetween(fromIso: string, now: Date): number {
	const from = new Date(fromIso.slice(0, 10) + 'T00:00:00');
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	return Math.round((today.getTime() - from.getTime()) / 86_400_000);
}

/** "i dag", "i går", "för 3 dagar sedan". */
export function daysAgo(fromIso: string, now: Date): string {
	const days = daysBetween(fromIso, now);
	if (days <= 0) return 'i dag';
	if (days === 1) return 'i går';
	return rtf.format(-days, 'day');
}

/** "nyss", "för 5 minuter sedan", "för 2 timmar sedan", "för 3 dagar sedan". */
export function timeAgo(fromIso: string, now: Date): string {
	const minutes = Math.floor((now.getTime() - Date.parse(fromIso)) / 60_000);
	if (minutes < 1) return 'nyss';
	if (minutes < 60) return rtf.format(-minutes, 'minute');
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return rtf.format(-hours, 'hour');
	return rtf.format(-Math.floor(hours / 24), 'day');
}

/** 42.5 → "42,5" */
export function formatNumber(n: number): string {
	return n.toLocaleString('sv-SE', { maximumFractionDigits: 2 });
}

/** 75 → "1:15" */
export function formatSeconds(total: number): string {
	const s = Math.max(0, Math.round(total));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
