<script lang="ts">
	/** Line icons per DESIGN.md: 20 px, 1.75 stroke, round caps. */
	const paths = {
		x: 'M6 6l12 12M18 6L6 18',
		check: 'M5 12.5l4.5 4.5L19 7.5',
		right: 'M9 5l7 7-7 7',
		left: 'M15 5l-7 7 7 7',
		down: 'M6 9l6 6 6-6',
		up: 'M6 15l6-6 6 6',
		plus: 'M12 5v14M5 12h14',
		home: 'M4 11l8-6.5 8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
		chart: 'M4 19h16M7 15l4-4 3 3 5-6',
		user: 'M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5',
		note: 'M5 19h4L19.5 8.5a2.1 2.1 0 0 0-3-3L6 16v3zM14 7l3 3',
		swap: 'M7 7.5h11l-3.5-3.5M17 16.5H6l3.5 3.5',
		chat: 'M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V16h.5A2.5 2.5 0 0 1 5 13.5z'
	} as const;

	interface Props {
		name: keyof typeof paths;
		size?: number;
		stroke?: number;
	}
	let { name, size = 20, stroke = 1.75 }: Props = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" stroke-width={stroke}><path d={paths[name]} /></svg>

<style>
	svg {
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		flex: none;
	}
</style>
