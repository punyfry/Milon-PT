/**
 * Theme: follows the phone by default, or dark/light chosen under Konto.
 * The choice is kept in localStorage and applied by static/theme-init.js
 * before first paint, so the page does not flash.
 */
export type Theme = 'system' | 'dark' | 'light';

const KEY = 'milonpt.theme';
const BG = { dark: '#0a0a0b', light: '#f3f2ee' } as const;

export function loadTheme(): Theme {
	try {
		const t = localStorage.getItem(KEY);
		return t === 'dark' || t === 'light' ? t : 'system';
	} catch {
		return 'system';
	}
}

export function applyTheme(theme: Theme): void {
	const root = document.documentElement;
	if (theme === 'system') delete root.dataset.theme;
	else root.dataset.theme = theme;
	// The status bar color follows the choice; for "system" the media variants in app.html apply.
	document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
		const scheme = m.media.includes('dark') ? 'dark' : 'light';
		m.content = theme === 'system' ? BG[scheme] : BG[theme];
	});
	try {
		if (theme === 'system') localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, theme);
	} catch {
		// The choice still applies to this page view.
	}
}
