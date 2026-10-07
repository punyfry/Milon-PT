let ctx: AudioContext | null = null;

/**
 * Unlocks audio. Browsers only allow sound after a user gesture, so this is
 * called when the timer starts.
 */
export function unlockAudio(): void {
	try {
		ctx ??= new AudioContext();
		if (ctx.state === 'suspended') void ctx.resume();
	} catch {
		ctx = null;
	}
}

/** Short beep that fades out by itself. */
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
		// No sound is better than a crash.
	}
	navigator.vibrate?.(200);
}
