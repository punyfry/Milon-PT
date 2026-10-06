/** Dagens datum (YYYY-MM-DD) i svensk tid, oavsett serverns tidszon. */
export function todayInStockholm(now = new Date()): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(now);
}
