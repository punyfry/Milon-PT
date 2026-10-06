<script lang="ts">
	import { invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import type { ConversationView } from '$lib/server/builder/conversation';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	let view = $state<ConversationView | null>(data.conversation);
	let input = $state('');
	let sending = $state(false);
	let failure = $state<string | null>(null);
	let logEnd: HTMLElement | undefined = $state();

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
		// Visa meddelandet direkt medan Milon svarar.
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
			if (!res.ok && !body?.log) failure = body?.message ?? `Servern svarade ${res.status}`;
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
	}

	async function restore(version: number) {
		if (!data.editing || !confirm(`Återställa version ${version}? Den sparas som en ny version.`)) return;
		const res = await fetch(`/api/workouts/${data.editing.slug}/restore`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ version })
		});
		if (res.ok) await invalidateAll();
		else failure = 'Kunde inte återställa versionen.';
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void send(input);
		}
	}
</script>

<svelte:head><title>{title} · Milon-PT</title></svelte:head>

<main>
	<p><a href="/" class="back">← Start</a></p>
	<h1>{title}</h1>

	{#if !data.configured}
		<p class="warning">Pass-byggaren behöver <code>ANTHROPIC_API_KEY</code> på servern.</p>
	{/if}

	{#if !view && !data.editing && data.workouts.length}
		<p class="meta">
			Redigera ett befintligt pass:
			{#each data.workouts as w, i (w.slug)}{i > 0 ? ', ' : ''}<a href={`/skapa?pass=${w.slug}`}>{w.name}</a>{/each}
		</p>
	{/if}

	<section class="draft" aria-label="Övningar i passet">
		<h2>Övningar</h2>
		{#if draft.length}
			<ol>
				{#each draft as item, i (item.exerciseId)}
					<li><span class="n">{i + 1}.</span><span class="name">{item.name}</span><span class="meta">{item.sets} × {targetText(item.target)}</span></li>
				{/each}
			</ol>
		{:else}
			<p class="meta">Inga än. Berätta för Milon vad passet ska träna.</p>
		{/if}
		{#if view?.saved}
			<p class="saved">Sparat som version {view.saved.version}. <a href={`/pass/${view.saved.slug}`}>Starta passet</a></p>
		{/if}
	</section>

	<section class="chat" aria-live="polite">
		{#if !view?.log.length}
			<p class="bubble assistant">
				{data.editing
					? `Vad vill du ändra i ${data.editing.name}?`
					: 'Hej! Vad ska passet fokusera på, och hur lång tid har du?'}
			</p>
		{/if}
		{#each view?.log ?? [] as item, i (i)}
			<p class="bubble {item.role}">{item.text}</p>
		{/each}
		{#if sending}<p class="bubble assistant typing">Milon skriver…</p>{/if}
		{#if failure}<p class="bubble error" role="alert">{failure}</p>{/if}
		<div bind:this={logEnd}></div>
	</section>

	<form class="composer" onsubmit={(e) => (e.preventDefault(), send(input))}>
		<textarea
			bind:value={input}
			onkeydown={onKeydown}
			rows="2"
			maxlength="2000"
			placeholder="Skriv till Milon…"
			aria-label="Meddelande till Milon"
			disabled={!data.configured}
		></textarea>
		<div class="buttons">
			<button type="submit" class="primary" disabled={sending || !input.trim() || !data.configured}>Skicka</button>
			<button type="button" disabled={sending || !draft.length || !data.configured} onclick={() => send('Spara passet.')}>
				Spara pass
			</button>
		</div>
	</form>

	{#if data.versions.length}
		<section class="versions">
			<h2>Versioner</h2>
			<ul>
				{#each data.versions as v, i (v.version)}
					<li>
						<div>
							<strong>v{v.version}</strong>
							<span class="meta">{v.createdAt} · {v.exerciseCount} övningar</span>
							{#if v.changeNote}<div class="meta">{v.changeNote}</div>{/if}
						</div>
						{#if i > 0}
							<button class="link" onclick={() => restore(v.version)}>Återställ</button>
						{:else}
							<span class="meta">Aktuell</span>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<p class="model meta">Modell: {data.model}</p>
</main>

<style>
	.back {
		color: var(--muted);
		text-decoration: none;
	}
	h1 {
		margin: 0.25rem 0 1rem;
	}
	h2 {
		font-size: 1rem;
		margin: 0 0 0.5rem;
	}
	.meta {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.warning {
		color: var(--danger);
	}
	.draft,
	.versions {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.9rem 1rem;
		margin-bottom: 1rem;
	}
	.draft ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.draft .n {
		color: var(--muted);
		min-width: 1.25rem;
	}
	.draft li {
		padding: 0.2rem 0;
	}
	.draft li,
	.versions li {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.draft .name {
		flex: 1;
	}
	.saved {
		margin: 0.75rem 0 0;
		font-weight: 600;
	}
	.chat {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.bubble {
		margin: 0;
		padding: 0.6rem 0.85rem;
		border-radius: 14px;
		max-width: 85%;
		white-space: pre-line;
	}
	.bubble.user {
		align-self: flex-end;
		background: var(--accent);
		color: var(--on-accent);
	}
	.bubble.assistant {
		align-self: flex-start;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.bubble.event {
		align-self: center;
		font-size: 0.85rem;
		color: var(--accent);
		background: var(--done);
	}
	.bubble.error {
		align-self: center;
		font-size: 0.9rem;
		color: var(--danger);
	}
	.typing {
		color: var(--muted);
		font-style: italic;
	}
	.composer {
		position: sticky;
		bottom: 0;
		background: var(--bg);
		padding: 0.5rem 0 calc(0.75rem + env(safe-area-inset-bottom));
		display: grid;
		gap: 0.5rem;
	}
	textarea {
		width: 100%;
		font: inherit;
		padding: 0.6rem 0.75rem;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		resize: vertical;
	}
	.buttons {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.buttons button {
		padding: 0.75rem;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font-weight: 600;
		cursor: pointer;
	}
	.buttons .primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.versions ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.versions li {
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--border);
		align-items: center;
	}
	.versions li:last-child {
		border-bottom: none;
	}
	.model {
		text-align: center;
		margin-top: 2rem;
	}
</style>
