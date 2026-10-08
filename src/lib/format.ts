const rtf = new Intl.RelativeTimeFormat('sv', { numeric: 'always' });

/** Calendar days between two dates (YYYY-MM-DD or ISO time), in local time. */
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
	// Non-breaking spaces: a set never wraps in the middle ("62,5 kg × 8").
	if (type === 'weight' && set.weight !== undefined) return `${formatNumber(set.weight)}\u00a0kg\u00a0×\u00a0${set.reps ?? 0}`;
	if (type === 'time' && set.seconds !== undefined) return `${set.seconds} s`;
	if (set.reps !== undefined) return `${set.reps} reps`;
	return '?';
}

/** Value in an exercise type's unit: "54 kg", "12 reps", "1:05". */
export function formatMetric(type: 'weight' | 'bodyweight' | 'time', value: number): string {
	if (type === 'weight') return `${formatNumber(value)} kg`;
	if (type === 'time') return formatSeconds(value);
	return `${formatNumber(value)} reps`;
}

/** "  Sofie Andersson " → "Sofie". Null when there is no name. */
export function firstName(name: string | null | undefined): string | null {
	return name?.trim().split(/\s+/)[0] || null;
}

/** Length of a session: "55 min", "1 h 20 min", "2 d 3 h". */
export function formatDuration(ms: number): string {
	const minutes = Math.max(0, Math.round(ms / 60_000));
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
	const days = Math.floor(hours / 24);
	return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}
