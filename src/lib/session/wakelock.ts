/**
 * Håller skärmen tänd medan en timer går (Screen Wake Lock). Låset släpps av
 * webbläsaren när fliken göms, så det begärs igen när den syns.
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
