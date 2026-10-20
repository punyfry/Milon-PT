<script lang="ts">
	import { goto, invalidateAll, pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { PHASE_LABEL } from '$lib/format';
	import Markdown from '$lib/components/Markdown.svelte';
	import MilonMessage from '$lib/components/MilonMessage.svelte';
	import Questionnaire from '$lib/components/Questionnaire.svelte';
	import { QUESTIONS } from '$lib/builder/questionnaire';
	import VersionsSheet from '$lib/components/VersionsSheet.svelte';
	import { dragHandle } from '$lib/reorder/drag';
	import { moveWithinPhase } from '$lib/reorder/move';
	import type { ConversationView, DraftItem } from '$lib/server/builder/conversation';
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
	/** The input holds a message written from the questionnaire's answers, not yet sent. */
	let fromQuestions = $state(false);

	const title = $derived(data.editing ? `Redigera ${data.editing.name}` : 'Skapa pass');
	const draft = $derived(view?.conversationId ? view.draft : data.initialDraft);

	function targetText(t: { reps: number } | { seconds: number }) {
		return 'seconds' in t ? `${t.seconds} s` : `${t.reps} reps`;
	}

	/** `save` marks the "Spara pass" button, which the server lets through a few turns past the limit. */
	async function send(text: string, save = false) {
		const message = text.trim();
		if (!message || sending) return;
		// A new order is saved first, so Milon hears about it with this message.
		if (order && !(await finishOrder())) return;
		sending = true;
		failure = null;
		fromQuestions = false;
		// Show the message immediately while Milon responds.
		view = view
			? { ...view, log: [...view.log, { role: 'user', text: message }] }
			: { conversationId: '', editingSlug: data.editing?.slug ?? null, saved: null, turnsLeft: 0, draft: [], log: [{ role: 'user', text: message }] };
		input = '';
		await scrollDown();
		try {
			const res = await fetch('/api/builder', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					message,
					...(save ? { save: true } : {}),
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

	// --- the user's own order ------------------------------------------------

	/** The list while it is unlocked for reordering; null when locked. */
	let order = $state<DraftItem[] | null>(null);
	let saving = $state(false);
	/** The exercise being dragged, for its style. */
	let dragged = $state<string | null>(null);

	function startOrder() {
		order = [...draft];
		draftOpen = true;
		failure = null;
	}

	function moveItem(from: number, to: number): boolean {
		const next = order && moveWithinPhase(order, from, to);
		if (!next) return false;
		order = next;
		return true;
	}

	/** Saves a changed order and locks the list again. Returns false if it couldn't be saved. */
	async function finishOrder(): Promise<boolean> {
		if (!order || saving) return false;
		const ids = order.map((d) => d.exerciseId);
		if (ids.every((id, i) => id === draft[i]?.exerciseId)) {
			order = null;
			return true;
		}
		saving = true;
		failure = null;
		try {
			const res = await fetch('/api/builder/order', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ order: ids, ...(view?.conversationId ? { conversationId: view.conversationId } : { editSlug: data.editing?.slug }) })
			});
			const body = await res.json().catch(() => null);
			if (!res.ok || !body || !Array.isArray(body.log)) {
				failure = body?.message ?? `Kunde inte spara ordningen (${res.status}).`;
				return false;
			}
			view = body as ConversationView;
			if (page.url.searchParams.get('c') !== view.conversationId) replaceState(`/skapa?c=${view.conversationId}`, {});
			order = null;
			return true;
		} catch {
			failure = 'Kunde inte nå servern. Försök igen.';
			return false;
		} finally {
			saving = false;
		}
	}

	/** The latest card in the chat is the one with "Byt" buttons. */
	const lastCard = $derived(view ? view.log.findLastIndex((l) => l.role === 'workout') : -1);

	/** Starts over with a new conversation, for the same workout when one is being edited. */
	async function newConversation() {
		view = null;
		failure = null;
		await goto(data.editing ? `/skapa?pass=${data.editing.slug}` : '/skapa', { replaceState: true });
	}

	/**
	 * The questionnaire (#102), only for a new workout before the conversation
	 * starts. Its step is in the URL (`?steg=`, from 1), like the intro: steps added
	 * here are read from page.state, since shallow routing doesn't update page.url.
	 */
	const askStep = $derived.by(() => {
		if (data.editing || view?.log.length) return 0;
		const n = page.state.askStep ?? Number(page.url.searchParams.get('steg'));
		return Number.isInteger(n) && n > 0 ? Math.min(n, QUESTIONS.length) : 0;
	});

	const askUrl = (n: number) => (n > 0 ? `/skapa?steg=${n}` : '/skapa');

	function ask(n: number) {
		const depth = page.state.askDepth ?? 0;
		// Back over an entry this page added; at the first one (or after a reload) step back in place instead.
		if (n === askStep - 1 && depth > 0) history.back();
		else if (n < askStep) replaceState(askUrl(n), { askStep: n, askDepth: 0 });
		else pushState(askUrl(n), { askStep: n, askDepth: depth + 1 });
	}

	async function useQuestionnaire(text: string) {
		// Leave the questionnaire's own history entries, so back doesn't return to a question.
		const depth = page.state.askDepth ?? 0;
		if (depth > 0) {
			const popped = new Promise((resolve) => addEventListener('popstate', resolve, { once: true }));
			history.go(-depth);
			await popped;
			await tick();
		}
		replaceState('/skapa', { askStep: 0 });
		input = text;
		fromQuestions = true;
		await tick();
		document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
	}

	/** Only for a conversation the server knows; null hides the hint. */
	const turnsLeft = $derived(view?.conversationId ? view.turnsLeft : null);

	async function scrollDown() {
		await tick();
		logEnd?.scrollIntoView({ behavior: 'smooth', block: 'end' });
		draftOpen = false;
	}

	async function restored() {
		versionsOpen = false;
		await invalidateAll();
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
		{#if draft.length}
			<button class="draft" aria-expanded={draftOpen} aria-controls="draftlist" onclick={() => (draftOpen = !draftOpen)} disabled={!!order}>
				<span><strong>{draft.length} {draft.length === 1 ? 'övning' : 'övningar'}</strong> <span class="muted">i passet</span></span>
				<Icon name={draftOpen ? 'up' : 'down'} />
			</button>
		{:else}
			<!-- Plain text until there is something to open, so it doesn't look like an input field. -->
			<p class="empty muted">Inga övningar än</p>
		{/if}
		{#if draftOpen && draft.length}
			<div class="draftlist" id="draftlist">
				{#if order}
					<ol class="ordering" data-sortable aria-label="Ändra ordning">
						{#each order as item, i (item.exerciseId)}
							<li data-sort-index={i} class:dragged={dragged === item.exerciseId}>
								<span
									class="handle"
									aria-hidden="true"
									use:dragHandle={{ index: i, onmove: moveItem, ondrag: (on) => (dragged = on ? item.exerciseId : null) }}
								><Icon name="grip" /></span>
								<span class="name">{item.name}{#if item.phase}<span class="tag quiet">{PHASE_LABEL[item.phase]}</span>{/if}</span>
								<button type="button" class="icon-btn" onclick={() => moveItem(i, i - 1)} disabled={!moveWithinPhase(order, i, i - 1)} aria-label="Flytta upp {item.name}"><Icon name="up" /></button>
								<button type="button" class="icon-btn" onclick={() => moveItem(i, i + 1)} disabled={!moveWithinPhase(order, i, i + 1)} aria-label="Flytta ner {item.name}"><Icon name="down" /></button>
							</li>
						{/each}
					</ol>
					<div class="orderbar">
						<button type="button" class="link" onclick={() => (order = null)} disabled={saving}>Avbryt</button>
						<button type="button" class="btn small primary" onclick={finishOrder} disabled={saving}>Klar</button>
					</div>
				{:else}
					<ol>
						{#each draft as item, i (item.exerciseId)}
							<li>
								<span>{i + 1}. {item.name}{#if item.phase}<span class="tag quiet">{PHASE_LABEL[item.phase]}</span>{/if}</span>
								<span class="num">{item.sets} × {targetText(item.target)}</span>
							</li>
						{/each}
					</ol>
					{#if draft.length > 1}
						<div class="orderbar">
							<button type="button" class="btn small" onclick={startOrder} disabled={sending}>Ändra ordning</button>
						</div>
					{/if}
				{/if}
			</div>
		{/if}
		{#if view?.saved}
			<p class="saved">Sparat som version {view.saved.version}. <a href={`/pass/${view.saved.slug}`}>Starta passet</a></p>
		{/if}
	</header>

	{#if askStep}
		<!-- Outside the chat's live region: each question is read once, when its heading takes focus. -->
		<section class="chat">
			<Questionnaire step={askStep} known={data.known} ongo={ask} oncancel={() => ask(0)} onfinish={useQuestionnaire} />
		</section>
	{:else}
		<section class="chat" aria-live="polite">
			{#if !view?.log.length}
				<MilonMessage>
					{data.editing ? `Vad vill du ändra i ${data.editing.name}?` : 'Hej! Vad ska passet fokusera på, och hur lång tid har du?'}
				</MilonMessage>
				{#if !data.editing}
					<!-- A suggested reply on the user's side of the chat, since it leads to the first message. -->
					<button type="button" class="reply" onclick={() => ask(1)}>
						<strong>Svara på några frågor</strong>
						<span>{QUESTIONS.length} snabba frågor, sen skriver Milon passet</span>
					</button>
				{/if}
				<a class="manual" href={data.editing ? `/skapa/manuell?pass=${data.editing.slug}` : '/skapa/manuell'}>
					{data.editing ? 'Ändra själv utan Milon' : 'Bygg själv utan Milon'}
				</a>
			{/if}
			{#if !view && !data.editing && data.workouts.length}
				<div class="existing">
					<span class="label">Eller redigera ett befintligt pass</span>
					<div class="chips">
						{#each data.workouts as w (w.slug)}<a class="btn small" href={`/skapa?pass=${w.slug}`}>{w.name}</a>{/each}
					</div>
				</div>
			{/if}
			{#each view?.log ?? [] as item, i (i)}
				{#if item.role === 'assistant'}
					<MilonMessage><Markdown text={item.text} /></MilonMessage>
				{:else if item.role === 'workout' && item.items}
					<!-- The list as Milon left it this turn; the latest one can swap exercises and be reordered. -->
					<div class="card" role="group" aria-label="Passet">
						<ol>
							{#each item.items as ex (ex.exerciseId)}
								<li>
									<span class="name">
										<span>{ex.name}{#if ex.phase}<span class="tag quiet">{PHASE_LABEL[ex.phase]}</span>{/if}</span>
										<span class="num">{ex.sets} × {targetText(ex.target)}</span>
									</span>
									{#if i === lastCard}
										<button type="button" class="btn small" onclick={() => send(`Byt ut ${ex.name}.`)} disabled={sending || !!order} aria-label="Byt {ex.name}">Byt</button>
									{/if}
								</li>
							{/each}
						</ol>
						{#if i === lastCard && draft.length > 1}
							<button type="button" class="link" onclick={startOrder} disabled={sending || !!order}>Ändra ordning</button>
						{/if}
					</div>
				{:else}
					<p class="bubble {item.role}">{item.text}</p>
				{/if}
			{/each}
			{#if sending}<MilonMessage thinking>Milon skriver…</MilonMessage>{/if}
			{#if failure}<p class="bubble error" role="alert">{failure}</p>{/if}
			{#if turnsLeft === 0}
				<p class="limit">Samtalet är fullt. Spara passet, eller <button type="button" class="link" onclick={newConversation}>börja ett nytt samtal</button>.</p>
			{:else if turnsLeft !== null && turnsLeft <= 5}
				<p class="limit">{turnsLeft === 1 ? '1 meddelande' : `${turnsLeft} meddelanden`} kvar i samtalet. Spara passet innan dess.</p>
			{/if}
			<div class="end" bind:this={logEnd}></div>
		</section>
	{/if}

	<form class="composer" hidden={askStep > 0} onsubmit={(e) => (e.preventDefault(), send(input))}>
		{#if fromQuestions && input.trim()}<p class="hint" id="composer-hint">Ändra meddelandet om du vill, och tryck Skicka.</p>{/if}
		<textarea
			bind:value={input}
			onkeydown={onKeydown}
			oninput={() => {
				// Emptied: whatever is typed next is the user's own message, not the questionnaire's.
				if (!input.trim()) fromQuestions = false;
			}}
			rows="1"
			maxlength="2000"
			placeholder="Skriv till Milon…"
			aria-label="Meddelande till Milon"
			aria-describedby={fromQuestions && input.trim() ? 'composer-hint' : undefined}
			enterkeyhint="enter"
		></textarea>
		<div class="buttons">
			<button type="submit" class="btn primary" disabled={sending || !input.trim() || turnsLeft === 0}>Skicka</button>
			<button type="button" class="btn" disabled={sending || !draft.length} onclick={() => send('Spara passet.', true)}>Spara pass</button>
		</div>
	</form>
</div>

{#if versionsOpen && data.versions.length && data.editing}
	<VersionsSheet
		slug={data.editing.slug}
		name={data.editing.name}
		versions={data.versions}
		onrestored={restored}
		onclose={() => (versionsOpen = false)}
	/>
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
	.empty {
		margin: 0;
		font-size: 14px;
	}
	.draftlist {
		margin: -10px 0 0;
		padding: 4px 14px 10px;
		background: var(--surface);
		border-radius: 0 0 var(--radius) var(--radius);
		display: grid;
		gap: 8px;
		max-height: 55dvh;
		overflow-y: auto;
	}
	.draftlist ol {
		list-style: none;
		margin: 0;
		padding: 0;
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
	.draftlist .ordering {
		gap: 0;
	}
	.draftlist .ordering li {
		align-items: center;
		gap: 4px;
		padding: 0;
		border-radius: 10px;
	}
	.ordering li.dragged {
		background: var(--surface-2);
	}
	.ordering .name {
		flex: 1;
		min-width: 0;
	}
	/* The drag handle: a 44 px target that doesn't scroll the page. */
	.handle {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		color: var(--muted);
		touch-action: none;
		cursor: grab;
		flex: none;
	}
	.orderbar {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 8px;
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
		margin-top: 16px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	/* Milon's proposal as a card, indented like his bubbles. */
	.card {
		margin-left: 44px;
		padding: 6px 14px 10px;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--surface);
		display: grid;
		gap: 4px;
	}
	.card ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.card li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 48px;
		border-bottom: 1px solid var(--line);
	}
	.card li:last-child {
		border-bottom: 0;
	}
	.card .name {
		display: grid;
		min-width: 0;
		font-size: 15px;
	}
	.card .num {
		font-size: 13px;
		color: var(--muted);
	}
	.card .link {
		justify-self: start;
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
	/* Like the user's own bubbles, but outlined in the accent: a reply to tap. */
	.reply {
		align-self: flex-end;
		max-width: 88%;
		min-height: 48px;
		display: grid;
		gap: 2px;
		padding: 10px 14px;
		border: 1px solid var(--accent);
		border-radius: 14px;
		background: var(--surface-2);
		color: var(--text);
		text-align: left;
		font-size: 15px;
		cursor: pointer;
	}
	.reply strong {
		font-weight: 500;
	}
	.reply span {
		font-size: 13px;
		color: var(--muted);
	}
	.reply:active {
		transform: scale(0.98);
	}
	.manual {
		align-self: flex-start;
		font-size: 14px;
	}
	.limit {
		margin: 0;
		color: var(--muted);
		font-size: 14px;
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
	.composer[hidden] {
		display: none;
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
	.hint {
		margin: 0;
		font-size: 13px;
		color: var(--muted);
	}
	.buttons {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
	}
</style>
