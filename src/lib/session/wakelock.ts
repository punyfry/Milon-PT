/**
 * Keeps the screen on while a timer runs (Screen Wake Lock). The browser
 * releases the lock when the tab is hidden, so it is requested again when visible.
 */
export function createWakeLock() {
	let sentinel: WakeLockSentinel | null = null;
	let wanted = false;

	async function acquire() {
		if (!wanted || sentinel || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
		try {
			sentinel = await navigator.wakeLock.request('screen');
			sentinel.addEventListener('release', () => (sentinel = null));
		} catch {
			sentinel = null;
		}
	}

	const onVisibility = () => void acquire();
	document.addEventListener('visibilitychange', onVisibility);

	return {
		set(on: boolean) {
			wanted = on;
			if (on) void acquire();
			else if (sentinel) {
				void sentinel.release();
				sentinel = null;
			}
		},
		destroy() {
			document.removeEventListener('visibilitychange', onVisibility);
			wanted = false;
			void sentinel?.release();
			sentinel = null;
		}
	};
}
