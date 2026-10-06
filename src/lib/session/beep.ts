let ctx: AudioContext | null = null;

/**
 * Låser upp ljudet. Webbläsare tillåter bara ljud efter en användarhandling,
 * så det här anropas när timern startas.
 */
export function unlockAudio(): void {
	try {
		ctx ??= new AudioContext();
		if (ctx.state === 'suspended') void ctx.resume();
	} catch {
		ctx = null;
	}
}

/** Kort signal som tystnar av sig själv. */
export function beep(): void {
	if (!ctx) return;
	try {
		const t = ctx.currentTime;
		for (const [offset, freq] of [
			[0, 880],
			[0.25, 880],
			[0.5, 1320]
		] as const) {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(0.0001, t + offset);
			gain.gain.exponentialRampToValueAtTime(0.3, t + offset + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.18);
			osc.connect(gain).connect(ctx.destination);
			osc.start(t + offset);
			osc.stop(t + offset + 0.2);
		}
	} catch {
		// Inget ljud är bättre än en krasch.
	}
	navigator.vibrate?.(200);
}
