<script lang="ts">
	/**
	 * Shows sessions waiting to be saved (saved while offline) and sends them
	 * on page load, on every navigation and when the network comes back.
	 */
	import { afterNavigate, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { OUTBOX_EVENT, discardPendingSave, flushPendingSaves, pendingSaves, type PendingSave } from '$lib/session/outbox';

	const userId = $derived((page.data.userId as string | null | undefined) ?? null);
	let pending = $state<PendingSave[]>([]);
	let sending = $state(false);

	async function flush() {
		if (sending) return;
		const before = pendingSaves(userId).length;
		if (!before) return;
		sending = true;
		const left = await flushPendingSaves(userId);
		sending = false;
		pending = left;
		if (left.length < before) await invalidateAll();
	}

	function discard(p: PendingSave) {
		if (!confirm(`Släng ${p.workoutName}? Passet sparas inte.`)) return;
		discardPendingSave(p.key);
	}

	afterNavigate(() => void flush());

	onMount(() => {
		const refresh = () => (pending = pendingSaves(userId));
		const online = () => void flush();
		refresh();
		addEventListener(OUTBOX_EVENT, refresh);
		addEventListener('online', online);
		return () => {
			removeEventListener(OUTBOX_EVENT, refresh);
			removeEventListener('online', online);
		};
	});

	// Switching account (or logging in) reloads the queue.
	$effect(() => {
		pending = pendingSaves(userId);
	});
</script>

{#if pending.length}
	<aside class="pending" role="status">
		{#each pending as p (p.key)}
			<p>
				<strong>{p.workoutName}</strong>
				{#if p.error}
					kunde inte sparas: {p.error}.
				{:else}
					väntar på att sparas. Det skickas när nätet är tillbaka.
				{/if}
			</p>
			{#if p.error}
				<p class="actions">
					{#if p.error.startsWith('Logga in')}<a href="/login">Logga in</a>{/if}
					<button class="link" onclick={flush} disabled={sending}>Försök igen</button>
					<button class="link danger" onclick={() => discard(p)}>Släng</button>
				</p>
			{/if}
		{/each}
		{#if !pending.some((p) => p.error)}
			<button class="link" onclick={flush} disabled={sending}>{sending ? 'Skickar…' : 'Försök nu'}</button>
		{/if}
	</aside>
{/if}

<style>
	.pending {
		max-width: calc(30rem - 40px);
		margin: max(12px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) 0 max(20px, env(safe-area-inset-left));
		padding: 12px 14px;
		border-radius: var(--radius);
		background: var(--surface-2);
		box-shadow: inset 3px 0 0 var(--accent);
		font-size: 14px;
	}
	@media (min-width: 30rem) {
		.pending {
			margin-inline: auto;
		}
	}
	.pending p {
		margin: 0 0 0.25rem;
	}
	.actions {
		display: flex;
		gap: 0.75rem;
	}
</style>
