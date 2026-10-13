<script lang="ts">
	/**
	 * The logo (assets/logo/logo.svg), inline so it takes the accent color in
	 * both themes, cropped to the drawing so it lines up with text. Decorative:
	 * the wordmark next to it names the app.
	 */
	let { width = 72 }: { width?: number } = $props();
</script>

<svg class="logo" viewBox="12 24 72 48" {width} height={(width * 2) / 3} aria-hidden="true">
	<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
		<path d="M30 28V68M66 28V68" />
		<path d="M16 40V56M80 40V56" />
		<path d="M30 40L48 58L66 40" />
	</g>
</svg>

<style>
	.logo {
		display: block;
		color: var(--accent);
	}
</style>
