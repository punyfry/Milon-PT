<script lang="ts">
	import { deserialize } from '$app/forms';
	import { goto, pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, tick, untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import MilonAvatar from '$lib/components/MilonAvatar.svelte';
	import Typewriter from '$lib/components/Typewriter.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/**
	 * Milon's story, one line per tap. `scene` is the drawing behind it: 0 the calf,
	 * 1 the bull, 2 Milon himself. The narrator and Milon differ only in typography.
	 */
	type Line = { scene: 0 | 1 | 2; milon?: boolean; text: string };
	const STORY: Line[] = [
		{ scene: 0, text: 'I det antika Grekland levde Milon från Kroton, en av sin tids största brottare.' },
		{ scene: 0, text: 'Det sägs att han fann ett enkelt sätt att bli starkare.\nHan lyfte en kalv. Varje dag lyfte han den igen.' },
		{ scene: 1, text: 'Åren gick. Kalven växte.\nOch Milon fortsatte lyfta.' },
		{ scene: 1, text: 'Till slut, berättas det, bar han en fullvuxen tjur på sina axlar.' },
		{ scene: 1, text: 'Om det verkligen hände? Tja, historien har nog sina kreativa friheter.' },
		{ scene: 1, text: 'Men själva idén håller än.' },
		{ scene: 1, text: 'Börja där du är. Lägg på lite mer när du är redo. Upprepa. Det är så styrka byggs – steg för steg.' },
		{ scene: 2, milon: true, text: 'Hej! Det är jag som är Milon, din personliga tränare.' }
	];
	/** Without an API key there is no trainer to offer, so the intro ends on his hello. */
	const HELLO_SOLO = 'Hej! Jag är Milon. Nu är det din tur.';
	const HELLO = STORY.length - 1;
	const QUESTION = HELLO + 1;
	const END = QUESTION + 1;
	const QUESTION_TEXT =
		'Vill du ha mig med som stöd?\nJag hjälper dig bygga pass och finns med under passet. Du kan ändra ditt val när du vill under Konto.';
	const REPLY = {
		on: 'Toppen! Då kör vi. Låt oss se vad du kan bli stark nog att lyfta.',
		off: 'Helt okej! Appen funkar lika bra utan mig.'
	};

	type Choice = 'on' | 'off';
	type Option = { label: string; quiet?: boolean; action: () => void };

	/**
	 * Each step is a history entry with the step in the URL (`?steg=` counted from 1,
	 * plus `val` on the last view), so browser back and a reload keep the place.
	 * Shallow routing doesn't update page.url, so steps added here are read from
	 * page.state; the URL covers a reload or a link straight to a step.
	 */
	const last = $derived(data.aiConfigured ? END : HELLO);
	const choice = $derived.by((): Choice | null => {
		if (page.state.introStep !== undefined) return page.state.introChoice ?? null;
		const value = page.url.searchParams.get('val');
		return value === 'on' || value === 'off' ? value : null;
	});
	const step = $derived.by(() => {
		const n = page.state.introStep ?? Number(page.url.searchParams.get('steg')) - 1;
		const at = Number.isInteger(n) && n > 0 ? Math.min(n, last) : 0;
		// The last view needs a choice to answer.
		return at === END && !choice ? QUESTION : at;
	});

	const scene = $derived(step <= HELLO ? STORY[step].scene : 2);
	const zoomed = $derived(step >= QUESTION);
	const solo = $derived(step === HELLO && !data.aiConfigured);
	const text = $derived(
		step === END ? REPLY[choice ?? 'on'] : step === QUESTION ? QUESTION_TEXT : solo ? HELLO_SOLO : STORY[step].text
	);
	const milonVoice = $derived(step >= HELLO);
	const options = $derived.by((): Option[] | null => {
		if (step === QUESTION)
			return [
				{ label: 'Ja, häng med', action: () => choose('on') },
				{ label: 'Nej tack, jag kör själv', action: () => choose('off') }
			];
		if (step === END || solo) {
			const coach = choice === 'on' && !solo;
			return [
				{ label: coach ? 'Bygg mitt första pass med Milon' : 'Bygg mitt första pass', action: () => leave(coach ? '/skapa' : '/skapa/manuell') },
				{ label: 'Jag vill kolla mer på appen först', quiet: true, action: () => leave('/') }
			];
		}
		return null;
	});

	let reducedMotion = $state(false);
	/** The step whose line is fully shown (typed out or skipped), and the step whose typing was skipped with a tap. */
	let typedStep = $state(-1);
	let skippedStep = $state(-1);
	const typed = $derived(typedStep === step);
	const skipTyping = $derived(reducedMotion || skippedStep === step);
	/** Milon waves when he first steps forward, not when coming back to him. */
	let wave = $state(false);
	/** Wait for the picture before typing when it changes a lot, so the text doesn't race it. */
	let typeDelay = $state(250);
	let busy = $state(false);
	let failure = $state<string | null>(null);
	let previous = -1;

	onMount(() => {
		reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
	});

	$effect(() => {
		const at = step;
		untrack(() => enter(at));
	});

	/** Sets up the picture's moves for a new step. */
	function enter(at: number) {
		const before = previous;
		previous = at;
		failure = null;
		wave = at === HELLO ? before < HELLO : at > HELLO && wave;
		const sceneOf = (n: number) => (n <= HELLO ? STORY[n].scene : 2);
		const bigChange = before >= 0 && (sceneOf(before) !== sceneOf(at) || (before >= QUESTION) !== (at >= QUESTION));
		typeDelay = bigChange ? (at >= QUESTION ? 1500 : 1300) : 250;
		// The new line takes focus, so a screen reader reads it and the keyboard can carry on.
		if (before >= 0) void tick().then(() => document.querySelector<HTMLElement>('[data-step-focus]')?.focus());
	}

	function urlFor(n: number, value: Choice | null = null): string {
		const params = new URLSearchParams();
		if (n > 0) params.set('steg', String(n + 1));
		if (value) params.set('val', value);
		return `${page.url.pathname}${params.size ? `?${params}` : ''}`;
	}

	function show(n: number, value: Choice | null = null) {
		pushState(urlFor(n, value), { introStep: n, introChoice: value, introDepth: (page.state.introDepth ?? 0) + 1 });
	}

	function back() {
		if (busy || step === 0) return;
		// Back over an entry this page added; at the first one (or after a reload) step back in place instead.
		if ((page.state.introDepth ?? 0) > 0) history.back();
		else replaceState(urlFor(step - 1), { introStep: step - 1, introChoice: null });
	}

	/** A tap shows the whole line while it is typed, and otherwise moves on. Choices wait for a button. */
	function advance() {
		if (busy) return;
		if (!typed) skippedStep = step;
		else if (!options && step < last) show(step + 1);
	}

	function tapFilm(e: MouseEvent) {
		if (!(e.target as Element).closest('button, a')) advance();
	}

	function onkeydown(e: KeyboardEvent) {
		if (!['Enter', ' ', 'ArrowRight'].includes(e.key) || (e.target as Element).closest('button, a, input, textarea')) return;
		e.preventDefault();
		advance();
	}

	/** "Hoppa över" lands on the question, so the only real decision is never skipped. */
	function skip() {
		if (!busy) show(data.aiConfigured ? QUESTION : HELLO);
	}

	/** Saves that the intro is done, with the choice of Milon if one was made. */
	async function finish(coach: Choice | null): Promise<boolean> {
		busy = true;
		failure = null;
		try {
			const body = new FormData();
			if (coach) body.set('coach', coach);
			const res = await fetch('?/done', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
			const result = deserialize(await res.text());
			if (result.type === 'success') return true;
			failure = (result.type === 'failure' && (result.data?.error as string | undefined)) || 'Kunde inte spara. Försök igen.';
			return false;
		} catch {
			failure = 'Kunde inte nå servern. Kontrollera nätet och försök igen.';
			return false;
		} finally {
			busy = false;
		}
	}

	async function choose(value: Choice) {
		if (!busy && (await finish(value))) show(END, value);
	}

	/**
	 * Saves again on the way out, so a reloaded last view still marks the intro as done.
	 * The choice itself was saved when it was made; a link with `val` doesn't change it.
	 */
	async function leave(href: string) {
		if (!busy && (await finish(null))) await goto(href);
	}
</script>

<svelte:head><title>Välkommen · Milon-PT</title></svelte:head>
<svelte:window {onkeydown} />

<div class="intro">
	<div class="frame">
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="film" class:asking={zoomed} onclick={tapFilm}>
			<div class="cam" class:zoom={zoomed}>
				<img src="/intro/scen-1.png" alt="" class="scene" class:shown={scene === 0} />
				<img src="/intro/scen-2.png" alt="" class="scene" class:shown={scene === 1} />
				<div class="hero" class:shown={scene === 2} class:wave>
					<div class="fig">
						<img src="/intro/scen-3.png" alt="" class="body" />
						<img src="/intro/scen-3.png" alt="" class="hand" />
					</div>
					<span class="face"><MilonAvatar /></span>
				</div>
			</div>
			<div class="shade"></div>
			<div class="subs">
				<p class="sub" class:milon={milonVoice} class:end={step === END || solo} tabindex="-1" data-step-focus>
					<Typewriter {text} instant={skipTyping} delay={typeDelay} ondone={() => (typedStep = step)} />
				</p>
				{#if options}
					{#if typed}
						<div class="opts">
							{#each options as option (option.label)}
								<button type="button" class="opt" class:quiet={option.quiet} onclick={option.action} disabled={busy}>{option.label}</button>
							{/each}
						</div>
					{/if}
				{:else}
					<span class="more" class:on={typed} aria-hidden="true">▼</span>
				{/if}
				{#if failure}<p class="error" role="alert">{failure}</p>{/if}
			</div>
		</div>

		<header class="top">
			<button type="button" class="back" class:hidden={step === 0} onclick={back} disabled={busy} aria-label="Tillbaka">
				<Icon name="left" size={22} />
			</button>
			{#if step < (data.aiConfigured ? QUESTION : HELLO)}
				<button type="button" class="link skip" onclick={skip}>Hoppa över</button>
			{/if}
		</header>
	</div>
</div>

<style>
	@font-face {
		font-family: 'Newsreader';
		src: url('/fonts/newsreader-latin.woff2') format('woff2');
		font-weight: 400;
		font-display: swap;
	}

	/* The intro is always dark, whatever the app theme: the drawings are white lines on black.
	   The values are the dark theme's tokens in src/routes/+layout.svelte; keep them in step. */
	.intro {
		--bg: #000;
		--text: #f2f2f0;
		--soft: #bdbdc2;
		--muted: #8e8e94;
		--line: rgba(255, 255, 255, 0.12);
		--accent: #5eead4;
		--on-accent: #0a0f0c;
		--danger: #f2a49b;
		color-scheme: dark;
		position: fixed;
		inset: 0;
		background: var(--bg);
		color: var(--text);
		overflow: hidden;
		user-select: none;
		-webkit-tap-highlight-color: transparent;
	}
	.frame {
		position: relative;
		height: 100%;
		max-width: 30rem;
		margin: 0 auto;
	}

	.top {
		position: absolute;
		inset: 0 0 auto 0;
		z-index: 2;
		display: flex;
		justify-content: space-between;
		align-items: center;
		height: 56px;
		margin-top: env(safe-area-inset-top, 0px);
		padding: 0 max(8px, env(safe-area-inset-right)) 0 max(8px, env(safe-area-inset-left));
	}
	.back {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 14px;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.back.hidden {
		visibility: hidden;
	}
	.skip {
		min-height: 44px;
		padding: 0 12px;
		font-size: 14px;
		color: var(--muted);
	}

	.film {
		position: absolute;
		inset: 0;
		overflow: hidden;
		cursor: pointer;
	}

	/* The camera: the drawings fill the width at the top, and it zooms in on Milon's face for the question. */
	.cam {
		position: absolute;
		top: calc(40px + env(safe-area-inset-top, 0px));
		left: 0;
		width: 100%;
		aspect-ratio: 470 / 680;
		transform-origin: 50.4% 23.8%;
		transition: transform 1.8s cubic-bezier(0.6, 0, 0.2, 1);
	}
	.cam.zoom {
		transform: translateY(16%) scale(4.3);
	}
	.cam img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		/* The drawings are black lines on transparent; inverted they are white lines on black. */
		filter: invert(1);
	}
	.scene {
		opacity: 0;
		transition: opacity 0.6s ease;
	}
	.scene.shown {
		opacity: 1;
		transition-duration: 1s;
		animation: kenburns 16s ease-out both;
	}
	@keyframes kenburns {
		to {
			transform: scale(1.08) translateY(-2%);
		}
	}

	/* Milon steps forward: the drawing without its hand, and the hand on its own so it can wave from the wrist. */
	.hero {
		position: absolute;
		inset: 0;
		opacity: 0;
	}
	.hero.shown {
		animation: rise 1.1s cubic-bezier(0.2, 0.9, 0.3, 1.15) 0.45s both;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(7%) scale(0.94);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	.fig {
		transition: opacity 1.4s ease 0.3s;
	}
	.zoom .fig {
		opacity: 0;
	}
	/* The hand's box in scen-3.png. Move these if the final drawing moves the hand. */
	.body {
		mask:
			linear-gradient(#000 0 0) 0 0 / 100% 100% no-repeat exclude,
			linear-gradient(#000 0 0) 84% 26.6% / 14.9% 11.5% no-repeat;
	}
	.hand {
		clip-path: inset(23.5% 13.6% 65% 71.5%);
		transform-origin: 77.7% 35.2%;
	}
	.wave .hand {
		animation: wave 1.5s ease-in-out 1.7s both;
	}
	@keyframes wave {
		0%,
		100% {
			transform: rotate(0);
		}
		20%,
		60% {
			transform: rotate(-14deg);
		}
		40%,
		80% {
			transform: rotate(9deg);
		}
	}

	/* Milon's face from the app on the drawing's blank face (its position in scen-3.png). */
	.face {
		position: absolute;
		left: 50.4%;
		top: 23.8%;
		width: 12%;
		aspect-ratio: 1;
		display: grid;
		opacity: 0;
		transform: translate(-50%, -50%) scale(0.4);
		transition:
			opacity 0.6s ease,
			transform 0.7s cubic-bezier(0.3, 1.6, 0.5, 1);
	}
	.shown .face {
		opacity: 1;
		transform: translate(-50%, -50%);
		transition-delay: 1.3s;
	}
	.face :global(.avatar) {
		width: 100%;
		height: 100%;
	}
	.face :global(path) {
		transition: stroke-width 1.8s;
	}
	.zoom .face :global(path) {
		stroke-width: 6;
	}

	/* Subtitles on a fade to black, which goes away once only the avatar is left. */
	.shade {
		position: absolute;
		inset: auto 0 0 0;
		height: 55%;
		background: linear-gradient(to bottom, transparent, var(--bg) 45%);
		pointer-events: none;
		transition: height 1.2s ease;
	}
	.asking .shade {
		height: 0;
	}
	.subs {
		position: absolute;
		inset: auto 0 0 0;
		display: grid;
		gap: 14px;
		justify-items: center;
		padding: 0 26px calc(30px + env(safe-area-inset-bottom, 0px));
		text-align: center;
	}
	.sub {
		margin: 0;
		min-height: 4.5em;
		display: grid;
		align-content: end;
		font-family: 'Newsreader', Georgia, serif;
		font-size: 22px;
		line-height: 1.4;
	}
	.sub.milon {
		font-family: inherit;
		font-size: 18px;
		line-height: 1.5;
		color: var(--accent);
	}
	.sub.end {
		min-height: 0;
	}
	[data-step-focus]:focus {
		outline: none;
	}
	.more {
		font-size: 12px;
		color: var(--accent);
		opacity: 0;
		transition: opacity 0.2s;
	}
	.more.on {
		opacity: 1;
		animation: bob 1.1s ease-in-out infinite;
	}
	@keyframes bob {
		50% {
			transform: translateY(3px);
		}
	}

	/* Dialogue options, like a game: a dash in the accent, no button chrome. */
	.opts {
		width: 100%;
		display: grid;
		gap: 2px;
		padding-top: 10px;
		border-top: 1px solid var(--line);
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 48px;
		padding: 12px 8px;
		border: 0;
		border-radius: 14px;
		background: none;
		color: var(--text);
		font-size: 18px;
		text-align: left;
		cursor: pointer;
		animation: fade-up 0.45s ease both;
	}
	.opt:nth-child(2) {
		animation-delay: 0.12s;
	}
	.opt::before {
		content: '—';
		color: var(--accent);
	}
	.opt:hover,
	.opt:active {
		background: rgba(255, 255, 255, 0.06);
	}
	.opt.quiet {
		font-size: 16px;
		color: var(--soft);
	}
	@keyframes fade-up {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
	.error {
		margin: 0;
		font-size: 14px;
	}

	/* Reduced motion: text and pictures at once, no camera moves. */
	@media (prefers-reduced-motion: reduce) {
		.intro *,
		.intro *::before,
		.intro *::after {
			animation: none !important;
			transition-duration: 0s !important;
			transition-delay: 0s !important;
		}
		.hero.shown {
			opacity: 1;
		}
	}
</style>
