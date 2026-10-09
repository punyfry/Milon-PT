<script lang="ts">
	import { deserialize } from '$app/forms';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import LogoToMilon from '$lib/components/LogoToMilon.svelte';
	import MilonAvatar from '$lib/components/MilonAvatar.svelte';
	import Typewriter from '$lib/components/Typewriter.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Milon's story, always the same. The images are stacked so one turns into the next. */
	const SCENES = [
		{
			image: '/intro/scen-1.png',
			alt: 'En ung man bär en kalv på axlarna.',
			text:
				'En gång i det antika Grekland…\n\n' +
				'Det sägs att Milon från Kroton, en av sin tids största brottare, fann ett enkelt sätt att bli starkare. ' +
				'Han lyfte en kalv. Varje dag lyfte han den igen.'
		},
		{
			image: '/intro/scen-2.png',
			alt: 'Samma man, nu med skägg, bär en fullvuxen tjur på axlarna.',
			text:
				'Åren gick.\n\n' +
				'Kalven växte. Och Milon fortsatte lyfta. Till slut, berättas det, bar han en fullvuxen tjur på sina axlar.\n\n' +
				'Om det verkligen hände? Tja, historien har sina... kreativa friheter.'
		},
		{
			image: '/intro/scen-3.png',
			alt: 'Milon står stark och vinkar, med Milons ansikte från appen.',
			text:
				'Men själva idén håller än.\n\n' +
				'Börja där du är. Lägg på lite mer när du är redo. Upprepa. Det är så styrka byggs – steg för steg.\n\n' +
				'Jag är Milon, din personliga tränare.'
		}
	];

	const QUESTION =
		'Vill du ha mig med som stöd?\n\n' +
		'Jag hjälper dig att bygga pass och svarar när du frågar under passet. Annars håller jag tyst. ' +
		'Du kan ändra dig när du vill under Konto.';
	const REPLY = {
		on: 'Låt oss se vad du kan bli stark nog att lyfta.',
		off: 'Helt okej, appen fungerar lika bra utan mig. Ändrar du dig hittar du mig under Konto.'
	};

	const TOUR = {
		on: [
			{ icon: 'plus', title: 'Bygg pass med mig', text: 'Berätta vad du vill träna och hur mycket tid du har, så tar vi fram passet tillsammans. Du kan alltid ändra det själv.' },
			{ icon: 'check', title: 'En övning i taget', text: 'Under passet bockar du av set. Vill du ha tips eller byta övning trycker du på mig, annars håller jag tyst.' },
			{ icon: 'chart', title: 'Lite mer, steg för steg', text: 'Appen visar vad du lyfte förra gången. När det går lätt lägger du på lite mer, precis som med kalven.' }
		],
		off: [
			{ icon: 'plus', title: 'Bygg ditt pass', text: 'Välj bland dina övningar eller skriv in nya, och sätt antal set och mål.' },
			{ icon: 'check', title: 'En övning i taget', text: 'Under passet bockar du av set. Du kan byta övning, eller skriva in en ny om maskinen är upptagen.' },
			{ icon: 'chart', title: 'Lite mer, steg för steg', text: 'Appen visar vad du lyfte förra gången. När det går lätt lägger du på lite mer, precis som med kalven.' }
		]
	} as const;

	type Step = { kind: 'opening' } | { kind: 'scene'; i: number } | { kind: 'choice' } | { kind: 'reply' } | { kind: 'tour'; i: number };
	let step = $state<Step>({ kind: 'opening' });
	let reducedMotion = $state(false);
	/** The current text is fully shown (typed out or skipped). */
	let typed = $state(false);
	let skipTyping = $state(false);
	let choice = $state<'on' | 'off' | null>(null);
	let busy = $state(false);
	let failure = $state<string | null>(null);

	onMount(() => {
		reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
	});

	const sceneIndex = $derived(step.kind === 'scene' ? step.i : -1);
	const coach = $derived(data.aiConfigured && choice !== 'off');
	const tour = $derived(TOUR[coach ? 'on' : 'off']);

	function go(next: Step) {
		step = next;
		typed = false;
		skipTyping = reducedMotion;
		failure = null;
		// The button that was tapped is gone: focus moves to the new step's text, so a screen reader reads it.
		void tick().then(() => document.querySelector<HTMLElement>('[data-step-focus]')?.focus());
	}

	/** A tap on the text or image while it is typed shows all of it; otherwise it moves on. */
	function tapStory() {
		if (busy) return;
		if (!typed) skipTyping = true;
		else next();
	}

	function next() {
		if (step.kind === 'opening') go({ kind: 'scene', i: 0 });
		else if (step.kind === 'scene') {
			if (step.i < SCENES.length - 1) go({ kind: 'scene', i: step.i + 1 });
			// Without an API key there is no Milon to choose.
			else if (data.aiConfigured) go({ kind: 'choice' });
			else void finish(null).then((ok) => ok && go({ kind: 'tour', i: 0 }));
		} else if (step.kind === 'reply') go({ kind: 'tour', i: 0 });
		else if (step.kind === 'tour') {
			if (step.i < tour.length - 1) go({ kind: 'tour', i: step.i + 1 });
			else void goto(coach ? '/skapa' : '/skapa/manuell');
		}
	}

	/** Saves that the intro is done, with the choice if one was made. */
	async function finish(coachChoice: 'on' | 'off' | null): Promise<boolean> {
		busy = true;
		failure = null;
		try {
			const body = new FormData();
			if (coachChoice) body.set('coach', coachChoice);
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

	async function choose(value: 'on' | 'off') {
		if (busy || !(await finish(value))) return;
		choice = value;
		go({ kind: 'reply' });
	}

	async function skip() {
		if (busy) return;
		// After the choice the intro is already saved as done.
		if (choice === null && !(await finish(null))) return;
		await goto('/');
	}

	const dots = $derived(
		step.kind === 'scene' ? { count: SCENES.length, at: step.i } : step.kind === 'tour' ? { count: tour.length, at: step.i } : null
	);
</script>

<svelte:head><title>Välkommen · Milon-PT</title></svelte:head>

<div class="intro">
	<header class="top">
		<span class="dots" aria-hidden="true">
			{#if dots}{#each Array.from({ length: dots.count }, (_, i) => i) as i (i)}<i class:on={i <= dots.at}></i>{/each}{/if}
		</span>
		{#if step.kind !== 'tour' || step.i < tour.length - 1}
			<button type="button" class="link skip" onclick={skip} disabled={busy}>Hoppa över</button>
		{/if}
	</header>

	{#if step.kind === 'opening'}
		<section class="opening">
			<span class="logo"><LogoToMilon size={132} {reducedMotion} /></span>
			<h1 tabindex="-1" data-step-focus>Milon-PT</h1>
			<p class="muted">En liten historia om hur styrka byggs.</p>
		</section>
		<footer class="bar">
			<button type="button" class="btn primary full" onclick={next}>Börja</button>
		</footer>
	{:else if step.kind === 'scene'}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<section class="story" onclick={tapStory}>
			<div class="stage" role="img" aria-label={SCENES[sceneIndex].alt}>
				{#each SCENES as scene, i (scene.image)}
					<img src={scene.image} alt="" class:shown={i === sceneIndex} class:still={reducedMotion} />
				{/each}
				<span class="face" class:shown={sceneIndex === SCENES.length - 1 && typed}><MilonAvatar size={44} /></span>
			</div>
			<p class="text" tabindex="-1" data-step-focus>
				<Typewriter text={SCENES[sceneIndex].text} instant={skipTyping} ondone={() => (typed = true)} />
			</p>
		</section>
		<footer class="bar">
			<button type="button" class="btn primary full" onclick={() => (typed ? next() : (skipTyping = true))} disabled={busy}>
				{typed ? 'Nästa' : 'Visa hela texten'}
			</button>
			{#if failure}<p class="error" role="alert">{failure}</p>{/if}
		</footer>
	{:else if step.kind === 'choice' || step.kind === 'reply'}
		<section class="milon">
			<MilonAvatar size={88} framed thinking={!typed} />
			<p class="said" tabindex="-1" data-step-focus>
				<Typewriter text={step.kind === 'choice' ? QUESTION : REPLY[choice ?? 'on']} instant={skipTyping} ondone={() => (typed = true)} />
			</p>
		</section>
		<footer class="bar">
			{#if step.kind === 'choice'}
				<button type="button" class="btn primary full" onclick={() => choose('on')} disabled={busy}>Ja, häng med</button>
				<button type="button" class="btn full" onclick={() => choose('off')} disabled={busy}>Nej tack, jag kör själv</button>
			{:else}
				<button type="button" class="btn primary full" onclick={next}>Visa hur appen fungerar</button>
			{/if}
			{#if failure}<p class="error" role="alert">{failure}</p>{/if}
		</footer>
	{:else}
		{@const card = tour[step.i]}
		<section class="tour">
			<span class="icon"><Icon name={card.icon} size={32} /></span>
			<h2 tabindex="-1" data-step-focus>{card.title}</h2>
			<p>{card.text}</p>
		</section>
		<footer class="bar">
			<button type="button" class="btn primary full" onclick={next}>
				{step.i < tour.length - 1 ? 'Nästa' : 'Bygg ditt första pass'}
			</button>
			{#if step.i === tour.length - 1}<a class="btn ghost full" href="/konto#import">Jag har mina pass i Craft</a>{/if}
		</footer>
	{/if}
</div>

<style>
	.intro {
		max-width: 30rem;
		margin: 0 auto;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		padding: env(safe-area-inset-top, 0px) max(20px, env(safe-area-inset-right)) env(safe-area-inset-bottom, 0px)
			max(20px, env(safe-area-inset-left));
	}
	.top {
		height: 56px;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.dots {
		display: flex;
		gap: 6px;
	}
	.dots i {
		width: 18px;
		height: 4px;
		border-radius: 2px;
		background: var(--seg);
	}
	.dots i.on {
		background: var(--accent);
	}
	.skip {
		font-size: 14px;
		color: var(--muted);
	}
	section {
		flex: 1;
	}
	.bar {
		position: sticky;
		bottom: 0;
		display: grid;
		gap: 8px;
		padding: 12px 0 16px;
		background: var(--bg);
	}
	.bar p {
		margin: 0;
		font-size: 14px;
	}

	.opening {
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 12px;
		text-align: center;
	}
	.logo {
		color: var(--accent);
	}
	.opening h1 {
		font-size: 40px;
		font-weight: 600;
		color: var(--heading);
	}
	.opening p {
		margin: 0;
	}

	.story {
		display: flex;
		flex-direction: column;
		gap: 18px;
		cursor: pointer;
	}
	/* The drawings are made for a light background, so the stage stays light in the dark theme too. */
	.stage {
		position: relative;
		width: 100%;
		max-height: 44dvh;
		aspect-ratio: 470 / 680;
		margin: 0 auto;
		border-radius: 24px;
		background: #f3f2ee;
		overflow: hidden;
		--accent: #0d6b63;
	}
	.stage img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		opacity: 0;
		transform: scale(0.96);
		transition:
			opacity 0.9s ease,
			transform 1.4s ease;
	}
	.stage img.shown {
		opacity: 1;
		transform: none;
	}
	.stage img.still {
		transition: opacity 0.3s ease;
		transform: none;
	}
	/* Milon's face from the app on the last drawing's blank face (its position in scen-3.png). */
	.face {
		position: absolute;
		left: 50.4%;
		top: 23.8%;
		width: 13%;
		transform: translate(-50%, -50%) scale(0.6);
		opacity: 0;
		display: grid;
		place-items: center;
		transition:
			opacity 0.6s ease,
			transform 0.6s ease;
	}
	.face.shown {
		opacity: 1;
		transform: translate(-50%, -50%);
	}
	[data-step-focus]:focus {
		outline: none;
	}
	.text {
		margin: 0;
		font-size: 17px;
		line-height: 1.5;
	}

	.milon {
		display: grid;
		align-content: center;
		justify-items: center;
		gap: 20px;
	}
	.said {
		margin: 0;
		font-size: 18px;
		line-height: 1.5;
		text-align: center;
	}

	.tour {
		display: grid;
		align-content: center;
		gap: 12px;
	}
	.icon {
		width: 64px;
		height: 64px;
		border-radius: 18px;
		display: grid;
		place-items: center;
		background: var(--surface-2);
		color: var(--accent);
	}
	.tour h2 {
		font-size: 28px;
		font-weight: 600;
		color: var(--heading);
	}
	.tour p {
		margin: 0;
		font-size: 17px;
		line-height: 1.5;
		color: var(--soft);
	}
</style>
