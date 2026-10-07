<script lang="ts">
	import { invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import Sheet from '$lib/components/Sheet.svelte';
	import type { ConversationView } from '$lib/server/builder/conversation';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	let view = $state<ConversationView | null>(data.conversation);
	let input = $state('');
	let sending = $state(false);
	let failure = $state<string | null>(null);
	let logEnd: HTMLElement | undefined = $state();
	let draftOpen = $state(false);
	let versionsOpen = $state(false);

	const title = $derived(data.editing ? `Redigera ${data.editing.name}` : 'Skapa pass');
	const draft = $derived(view?.conversationId ? view.draft : data.initialDraft);

	function targetText(t: { reps: number } | { seconds: number }) {
		return 'seconds' in t ? `${t.seconds} s` : `${t.reps} reps`;
	}

	async function send(text: string) {
		const message = text.trim();
		if (!message || sending) return;
		sending = true;
		failure = null;
		// Show the message immediately while Milon responds.
		view = view
			? { ...view, log: [...view.log, { role: 'user', text: message }] }
			: { conversationId: '', editingSlug: data.editing?.slug ?? null, saved: null, draft: [], log: [{ role: 'user', text: message }] };
		input = '';
		await scrollDown();
		try {
			const res = await fetch('/api/builder', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					message,
					...(view.conversationId ? { conversationId: view.conversationId } : { editSlug: data.editing?.slug })
				})
			});
			const body = await res.json().catch(() => null);
			if (body && Array.isArray(body.log)) {
				view = body as ConversationView;
				if (page.url.searchParams.get('c') !== view.conversationId) {
					replaceState(`/skapa?c=${view.conversationId}`, {});
				}
				if (view.saved) await invalidateAll();
			}
			if (!res.ok && !body?.log) {
				// Nothing was saved: remove the bubble and restore the text so it can be resent.
				failure = body?.message ?? `Servern svarade ${res.status}`;
				view = view && { ...view, log: view.log.slice(0, -1) };
				input = message;
			}
		} catch {
			failure = 'Kunde inte nå servern. Försök igen.';
			input = message;
		} finally {
			sending = false;
			await scrollDown();
		}
	}

	async function scrollDown() {
		await tick();
		logEnd?.scrollIntoView({ behavior: 'smooth', block: 'end' });
		draftOpen = false;
	}

	async function restore(version: number) {
		if (!data.editing || !confirm(`Återställa version ${version}? Den sparas som en ny version.`)) return;
		const res = await fetch(`/api/workouts/${data.editing.slug}/restore`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ version })
		});
		if (res.ok) {
			versionsOpen = false;
			await invalidateAll();
		} else failure = 'Kunde inte återställa versionen.';
	}

	/** Enter sends with a keyboard; on a phone Enter adds a new line and the send button sends. */
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) {
			e.preventDefault();
			void send(input);
		}
	}
</script>

<svelte:head><title>{title} · Milon-PT</title></svelte:head>

<div class="page">
	<header class="top">
		<div class="row">
			<h1>{title}</h1>
			{#if data.versions.length}
				<button class="btn small" onclick={() => (versionsOpen = true)}>Versioner</button>
			{:else if data.editing}
				<a class="btn small" href="/skapa">Nytt pass</a>
			{/if}
		</div>
		<button class="draft" aria-expanded={draftOpen} aria-controls="draftlist" onclick={() => (draftOpen = !draftOpen)} disabled={!draft.length}>
			<span>
				{#if draft.length}<strong>{draft.length} {draft.length === 1 ? 'övning' : 'övningar'}</strong> <span class="muted">i passet</span>{:else}<span class="muted">Inga övningar än</span>{/if}
			</span>
			{#if draft.length}<Icon name={draftOpen ? 'up' : 'down'} />{/if}
		</button>
		{#if draftOpen && draft.length}
			<ol class="draftlist" id="draftlist">
				{#each draft as item, i (item.exerciseId)}
					<li><span>{i + 1}. {item.name}</span><span class="num">{item.sets} × {targetText(item.target)}</span></li>
				{/each}
			</ol>
		{/if}
		{#if view?.saved}
			<p class="saved">Sparat som version {view.saved.version}. <a href={`/pass/${view.saved.slug}`}>Starta passet</a></p>
		{/if}
	</header>

	<section class="chat" aria-live="polite">
		{#if !data.configured}
			<p class="bubble error">Pass-byggaren behöver <code>ANTHROPIC_API_KEY</code> på servern.</p>
		{/if}
		{#if !view && !data.editing && data.workouts.length}
			<div class="existing">
				<span class="label">Eller redigera ett befintligt pass</span>
				<div class="chips">
					{#each data.workouts as w (w.slug)}<a class="btn small" href={`/skapa?pass=${w.slug}`}>{w.name}</a>{/each}
				</div>
			</div>
		{/if}
		{#if !view?.log.length}
			<p class="bubble assistant">
				{data.editing ? `Vad vill du ändra i ${data.editing.name}?` : 'Hej! Vad ska passet fokusera på, och hur lång tid har du?'}
			</p>
		{/if}
		{#each view?.log ?? [] as item, i (i)}
			{#if item.role === 'assistant'}
				<div class="bubble assistant"><Markdown text={item.text} /></div>
			{:else}
				<p class="bubble {item.role}">{item.text}</p>
			{/if}
		{/each}
		{#if sending}<p class="bubble assistant typing">Milon skriver…</p>{/if}
		{#if failure}<p class="bubble error" role="alert">{failure}</p>{/if}
		<div class="end" bind:this={logEnd}></div>
	</section>

	<form class="composer" onsubmit={(e) => (e.preventDefault(), send(input))}>
		<textarea
			bind:value={input}
			onkeydown={onKeydown}
			rows="1"
			maxlength="2000"
			placeholder="Skriv till Milon…"
			aria-label="Meddelande till Milon"
			enterkeyhint="enter"
			disabled={!data.configured}
		></textarea>
		<div class="buttons">
			<button type="submit" class="btn primary" disabled={sending || !input.trim() || !data.configured}>Skicka</button>
			<button type="button" class="btn" disabled={sending || !draft.length || !data.configured} onclick={() => send('Spara passet.')}>Spara pass</button>
		</div>
	</form>
</div>

{#if versionsOpen && data.versions.length}
	<Sheet title="Versioner" onclose={() => (versionsOpen = false)}>
		<h2>Versioner av {data.editing?.name}</h2>
		<p class="muted">Att återställa en äldre version sparar den som en ny version.</p>
		<ul class="versions">
			{#each data.versions as v, i (v.version)}
				<li>
					<div>
						<strong class="num">v{v.version}</strong>
						<span class="muted">{v.createdAt} · {v.exerciseCount} övningar</span>
						{#if v.changeNote}<div class="muted note">{v.changeNote}</div>{/if}
					</div>
					{#if i > 0}
						<button class="btn small" onclick={() => restore(v.version)}>Återställ</button>
					{:else}
						<span class="tag quiet">Aktuell</span>
					{/if}
				</li>
			{/each}
		</ul>
		<button class="btn ghost full" onclick={() => (versionsOpen = false)}>Stäng</button>
	</Sheet>
{/if}

<style>
	.page {
		max-width: 30rem;
		margin: 0 auto;
		min-height: calc(100dvh - var(--tabbar-h));
		display: flex;
		flex-direction: column;
	}
	.top {
		position: sticky;
		top: 0;
		z-index: 5;
		background: var(--bg);
		padding: calc(12px + env(safe-area-inset-top, 0px)) 20px 10px;
		border-bottom: 1px solid var(--line);
		display: grid;
		gap: 8px;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	h1 {
		font-size: 24px;
		font-weight: 600;
		color: var(--heading);
	}
	.draft {
		width: 100%;
		min-height: 48px;
		border: 0;
		border-radius: var(--radius);
		background: var(--surface);
		padding: 0 14px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		text-align: left;
		font-size: 14px;
		cursor: pointer;
	}
	.draft:disabled {
		cursor: default;
	}
	.draftlist {
		list-style: none;
		margin: -10px 0 0;
		padding: 4px 14px 10px;
		background: var(--surface);
		border-radius: 0 0 var(--radius) var(--radius);
		display: grid;
		gap: 4px;
	}
	.draftlist li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 14px;
		padding-top: 6px;
	}
	.draftlist .num {
		font-size: 13px;
		color: var(--muted);
		white-space: nowrap;
	}
	.saved {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
	}
	.chat {
		flex: 1;
		padding: 16px 20px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.existing {
		display: grid;
		gap: 8px;
		margin-bottom: 8px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.bubble {
		margin: 0;
		padding: 10px 14px;
		border-radius: 14px;
		max-width: 88%;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	.bubble.user {
		align-self: flex-end;
		background: var(--surface-2);
		box-shadow: inset 0 0 0 1px var(--ring);
	}
	.bubble.assistant {
		align-self: flex-start;
		border: 1px solid var(--line);
	}
	.bubble.event {
		align-self: center;
		font-size: 13px;
		font-weight: 500;
		color: var(--accent);
		padding: 4px 0;
	}
	.bubble.error {
		align-self: center;
		font-size: 14px;
		color: var(--danger);
	}
	.typing {
		color: var(--muted);
		font-style: italic;
	}
	/* The last message scrolls into view above the composer and the menu, never behind them. */
	.end {
		scroll-margin-bottom: calc(150px + var(--tabbar-h));
	}
	.composer {
		position: sticky;
		bottom: var(--tabbar-h);
		z-index: 5;
		background: var(--bg);
		border-top: 1px solid var(--line);
		padding: 10px 20px 12px;
		display: grid;
		gap: 8px;
	}
	textarea {
		width: 100%;
		min-height: 48px;
		max-height: 140px;
		field-sizing: content;
		border-radius: var(--radius);
		border: 0;
		background: var(--surface-2);
		padding: 12px 14px;
		resize: none;
	}
	.buttons {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
	}
	.versions {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.versions li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 12px 0;
		border-bottom: 1px solid var(--line);
	}
	.versions li > div {
		display: grid;
		gap: 2px;
		font-size: 14px;
	}
	.note {
		font-size: 13px;
	}
</style>
