// Applies the theme chosen under Konto › Tema before first paint, so the page does not flash.
// Loaded from app.html as a file because the CSP only allows scripts from 'self'.
try {
	const t = localStorage.getItem('milonpt.theme');
	if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch {
	// No storage (private mode etc.): follow the system theme.
}
