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

/** "40 kg × 8", "8 reps", "45 s" */
export function formatSet(type: 'weight' | 'bodyweight' | 'time', set: { weight?: number; reps?: number; seconds?: number }): string {
	// Hårda mellanslag: ett set bryts aldrig mitt i ("62,5 kg × 8").
	if (type === 'weight' && set.weight !== undefined) return `${formatNumber(set.weight)}\u00a0kg\u00a0×\u00a0${set.reps ?? 0}`;
	if (type === 'time' && set.seconds !== undefined) return `${set.seconds} s`;
	if (set.reps !== undefined) return `${set.reps} reps`;
	return '?';
}

/** Värde i en övningstyps mått: "54 kg", "12 reps", "1:05". */
export function formatMetric(type: 'weight' | 'bodyweight' | 'time', value: number): string {
	if (type === 'weight') return `${formatNumber(value)} kg`;
	if (type === 'time') return formatSeconds(value);
	return `${formatNumber(value)} reps`;
}
