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
