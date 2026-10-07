<script lang="ts">
	/**
	 * Small line chart for one series over time. Thin line (2 px), faint area,
	 * ringed end point and the value labelled only at the last point. Tap or
	 * hover for a crosshair with value and date; arrow keys move between
	 * points. A table with the same values is shown alongside the chart.
	 */
	interface Point {
		date: string;
		value: number;
	}
	interface Props {
		points: Point[];
		format: (value: number) => string;
		label: string;
		/** Controls y-axis steps: integers (reps) and seconds get no half steps. */
		kind?: 'number' | 'integer' | 'seconds';
		height?: number;
	}

	let { points, format, label, kind = 'number', height = 160 }: Props = $props();

	let width = $state(320);
	let active = $state<number | null>(null);

	const time = (d: string) => Date.parse(`${d}T12:00:00Z`);
	/** Approximate text width in px for an 11–12 px system font. */
	const textWidth = (t: string, px = 6.6) => t.length * px;

	/** "Nice" values for the y-axis. */
	function niceStep(range: number, count: number) {
		const raw = range / Math.max(count, 1);
		if (kind === 'seconds') {
			const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
			return steps.find((s) => s >= raw) ?? 3600;
		}
		const mag = 10 ** Math.floor(Math.log10(raw || 1));
		const n = raw / mag;
		const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
		return kind === 'integer' ? Math.max(1, Math.round(step)) : step;
	}

	const scale = $derived.by(() => {
		const values = points.map((p) => p.value);
		let lo = Math.min(...values);
		let hi = Math.max(...values);
		if (lo === hi) {
			lo = Math.max(0, lo - Math.max(1, lo * 0.1));
			hi = hi + Math.max(1, hi * 0.1);
		}
		const step = niceStep(hi - lo, 3);
		const min = Math.floor(lo / step) * step;
		const max = Math.ceil(hi / step) * step;
		const ticks: number[] = [];
		for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);

		// Margins sized to the labels so nothing is clipped.
		const pad = {
			top: 16,
			bottom: 22,
			left: Math.max(...ticks.map((t) => textWidth(format(t)))) + 10,
			right: textWidth(format(points.at(-1)?.value ?? 0), 7.4) + 14
		};
		const t0 = time(points[0]?.date ?? '2000-01-01');
		const t1 = time(points.at(-1)?.date ?? '2000-01-01');
		const innerW = Math.max(width - pad.left - pad.right, 10);
		const innerH = height - pad.top - pad.bottom;
		const x = (d: string) => pad.left + (t1 === t0 ? innerW / 2 : ((time(d) - t0) / (t1 - t0)) * innerW);
		const y = (v: number) => pad.top + innerH - ((v - min) / (max - min || 1)) * innerH;
		return { x, y, ticks, innerW, pad };
	});
	const pad = $derived(scale.pad);

	const xy = $derived(points.map((p) => ({ ...p, cx: scale.x(p.date), cy: scale.y(p.value) })));
	const line = $derived(xy.map((p, i) => `${i ? 'L' : 'M'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' '));
	const area = $derived(
		xy.length > 1
			? `${line} L${xy.at(-1)!.cx.toFixed(1)},${height - pad.bottom} L${xy[0].cx.toFixed(1)},${height - pad.bottom} Z`
			: ''
	);
	const last = $derived(xy.at(-1));

	/** The year is shown when the series spans several years or is not this year. */
	const withYear = $derived.by(() => {
		const years = new Set(points.map((p) => p.date.slice(0, 4)));
		return years.size > 1 || !years.has(String(new Date().getFullYear()));
	});
	const dateLabel = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('sv-SE', {
			day: 'numeric',
			month: 'short',
			...(withYear ? { year: 'numeric' } : {}),
			timeZone: 'UTC'
		});

	/** The first date label is only shown if it does not overlap the last one. */
	const showFirstDate = $derived(
		xy.length < 2 || textWidth(dateLabel(xy[0].date)) + textWidth(dateLabel(xy.at(-1)!.date)) + 12 <= scale.innerW
	);

	function nearest(clientX: number, rect: DOMRect) {
		// The chart scales to the container width; convert to chart coordinates.
		const px = ((clientX - rect.left) / (rect.width || 1)) * width;
		let best = 0;
		for (let i = 1; i < xy.length; i++) if (Math.abs(xy[i].cx - px) < Math.abs(xy[best].cx - px)) best = i;
		return best;
	}

	function onPointer(e: PointerEvent) {
		active = nearest(e.clientX, (e.currentTarget as HTMLElement).getBoundingClientRect());
	}

	/** On tap the value stays until the next tap; with a mouse it disappears when the pointer leaves. */
	function onLeave(e: PointerEvent) {
		if (e.pointerType !== 'touch') active = null;
	}

	function onKey(e: KeyboardEvent) {
		if (!xy.length) return;
		if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
			e.preventDefault();
			const i = active ?? xy.length - 1;
			active = Math.min(xy.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1)));
		} else if (e.key === 'Escape') active = null;
	}

	const hover = $derived(active === null ? null : xy[active]);
	const valueText = $derived.by(() => {
		const p = xy[active ?? xy.length - 1];
		return p ? `${format(p.value)}, ${dateLabel(p.date)}` : 'Inga värden';
	});
</script>

<div
	class="chart"
	bind:clientWidth={width}
	role="slider"
	aria-roledescription="diagram"
	aria-label="{label}. Piltangenterna går mellan punkterna."
	aria-valuemin={0}
	aria-valuemax={Math.max(points.length - 1, 0)}
	aria-valuenow={active ?? Math.max(points.length - 1, 0)}
	aria-valuetext={valueText}
	tabindex={points.length ? 0 : -1}
	onpointermove={onPointer}
	onpointerdown={onPointer}
	onpointerleave={onLeave}
	onkeydown={onKey}
	onblur={() => (active = null)}
>
	{#if points.length}
		<svg viewBox="0 0 {width} {height}" {height} aria-hidden="true">
			{#each scale.ticks as t (t)}
				<line class="grid" x1={pad.left} x2={pad.left + scale.innerW} y1={scale.y(t)} y2={scale.y(t)} />
				<text class="tick" x={pad.left - 6} y={scale.y(t)} dy="0.32em" text-anchor="end">{format(t)}</text>
			{/each}
			{#if showFirstDate}
				<text class="tick" x={xy[0].cx} y={height - 4} text-anchor={xy.length > 1 ? 'start' : 'middle'}>{dateLabel(xy[0].date)}</text>
			{/if}
			{#if xy.length > 1}
				<text class="tick" x={last!.cx} y={height - 4} text-anchor="end">{dateLabel(last!.date)}</text>
				<path class="area" d={area} />
				<path class="line" d={line} />
			{/if}
			{#if hover}
				<line class="crosshair" x1={hover.cx} x2={hover.cx} y1={pad.top} y2={height - pad.bottom} />
				<circle class="dot" cx={hover.cx} cy={hover.cy} r="4" />
			{/if}
			{#if last}
				<circle class="dot" cx={last.cx} cy={last.cy} r="4" />
				<text class="end" x={last.cx + 8} y={last.cy} dy="0.32em">{format(last.value)}</text>
			{/if}
		</svg>
		{#if hover}
			<div
				class="tooltip"
				style:left="{Math.min(Math.max(hover.cx, 60), width - 60)}px"
				style:top="{Math.max(hover.cy - 8, 0)}px"
			>
				<strong>{format(hover.value)}</strong>
				<span>{dateLabel(hover.date)}</span>
			</div>
		{/if}
	{/if}
</div>

<style>
	.chart {
		position: relative;
		width: 100%;
		min-width: 0;
		touch-action: pan-y;
	}
	svg {
		display: block;
		width: 100%;
		overflow: visible;
	}
	.chart:focus {
		outline: none;
	}
	.chart:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 6px;
	}
	.grid {
		stroke: var(--line);
		stroke-width: 1;
	}
	.tick {
		font-family: var(--mono);
		fill: var(--muted);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.line {
		fill: none;
		stroke: var(--series);
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.area {
		fill: var(--series);
		opacity: 0.1;
	}
	.dot {
		fill: var(--series);
		stroke: var(--surface);
		stroke-width: 2;
	}
	.end {
		font-family: var(--mono);
		fill: var(--text);
		font-size: 12px;
		font-weight: 600;
	}
	.crosshair {
		stroke: var(--muted);
		stroke-width: 1;
	}
	.tooltip {
		position: absolute;
		transform: translate(-50%, -100%);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0.3rem 0.55rem;
		display: grid;
		text-align: center;
		pointer-events: none;
		font-size: 0.85rem;
		white-space: nowrap;
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.12);
	}
	.tooltip span {
		color: var(--muted);
		font-size: 0.75rem;
	}
</style>
