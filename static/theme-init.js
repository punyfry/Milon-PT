// Applies the theme chosen under Konto › Tema before first paint, so the page does not flash.
// Loaded from app.html as a file because the CSP only allows scripts from 'self'.
try {
	const t = localStorage.getItem('milonpt.theme');
	if (t === 'dark' || t === 'light') {
		document.documentElement.dataset.theme = t;
		// The status bar follows the chosen theme, not the system one.
		const bg = t === 'dark' ? '#0a0a0b' : '#f3f2ee';
		document.querySelectorAll('meta[name="theme-color"]').forEach((m) => (m.content = bg));
	}
} catch {
	// No storage (private mode etc.): follow the system theme.
}
