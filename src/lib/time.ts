/** Today's date (YYYY-MM-DD) in Swedish time, regardless of the server's time zone. */
export function todayInStockholm(now = new Date()): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(now);
}

/** Stockholm UTC offset on a given date, e.g. "+02:00" (summer time) or "+01:00". */
export function stockholmOffset(date: string): string {
	const part = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Stockholm', timeZoneName: 'longOffset' })
		.formatToParts(new Date(`${date}T12:00:00Z`))
		.find((p) => p.type === 'timeZoneName')?.value;
	const m = part?.match(/GMT([+-]\d{2}:\d{2})/);
	return m ? m[1] : '+01:00';
}

/**
 * ISO time with the Stockholm offset that applies at that wall time, e.g.
 * ("2026-03-29", "01:30") → "2026-03-29T01:30:00+01:00" and 03:30 → "+02:00".
 * A wall time skipped when the clocks go forward gets the offset from before.
 */
export function stockholmIso(date: string, time: string): string {
	const candidates = [...new Set([stockholmOffset(addDay(date, -1)), stockholmOffset(date), stockholmOffset(addDay(date, 1))])];
	for (const offset of candidates) {
		const iso = `${date}T${time}:00${offset}`;
		const p = Object.fromEntries(wallClock.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
		if (`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` === `${date}T${time}`) return iso;
	}
	return `${date}T${time}:00${candidates[0]}`;
}

const wallClock = new Intl.DateTimeFormat('en-US', {
	timeZone: 'Europe/Stockholm',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

function addDay(date: string, days: number): string {
	const d = new Date(`${date}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}
