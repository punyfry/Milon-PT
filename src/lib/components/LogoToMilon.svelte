<script lang="ts">
	/**
	 * The logo turning into Milon once, then staying as his face (after
	 * assets/avatar/logo-to-milon.svg, which loops). SMIL ignores reduced
	 * motion, so then the finished face is shown. Inline so it takes the
	 * accent color.
	 */
	interface Props {
		size?: number;
		reducedMotion?: boolean;
	}
	let { size = 120, reducedMotion = false }: Props = $props();

	/** Logo and Milon per path: the outer plates fade out, the inner ones become the eyes and the V the mouth. */
	const paths = [
		{ logo: 'M30 28V68', milon: 'M8 28V68', fade: true },
		{ logo: 'M66 28V68', milon: 'M88 28V68', fade: true },
		{ logo: 'M16 40V56', milon: 'M30 26V46', fade: false },
		{ logo: 'M80 40V56', milon: 'M66 26V46', fade: false },
		{ logo: 'M30 40L48 58L66 40', milon: 'M34 62L48 74L62 62', fade: false }
	];
</script>

<svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true">
	<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
		{#each paths as p (p.logo)}
			{#if reducedMotion}
				{#if !p.fade}<path d={p.milon} />{/if}
			{:else}
				<path d={p.logo}>
					<animate
						attributeName="d"
						values="{p.logo};{p.milon}"
						begin="0.6s"
						dur="1.8s"
						fill="freeze"
						calcMode="spline"
						keyTimes="0;1"
						keySplines="0.4 0 0.2 1"
					/>
					{#if p.fade}
						<animate attributeName="opacity" values="1;0" begin="0.6s" dur="1s" fill="freeze" />
					{/if}
				</path>
			{/if}
		{/each}
	</g>
</svg>
