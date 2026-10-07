<script lang="ts">
	/**
	 * Visar pass som väntar på att sparas (sparades utan nät) och skickar dem
	 * när sidan laddas och när nätet kommer tillbaka.
	 */
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { discardPendingSave, flushPendingSaves, pendingSaves, type PendingSave } from '$lib/session/outbox';

	let pending = $state<PendingSave[]>([]);
	let sending = $state(false);

	async function flush() {
		if (sending) return;
		const before = pendingSaves().length;
		if (!before) return void (pending = []);
		sending = true;
		pending = await flushPendingSaves();
		sending = false;
		if (pending.length < before) await invalidateAll();
	}

	function discard(p: PendingSave) {
		if (!confirm(`Släng ${p.workoutName}? Passet sparas inte.`)) return;
		discardPendingSave(p.sessionId);
		pending = pendingSaves();
	}

	onMount(() => {
		pending = pendingSaves();
		void flush();
		const online = () => void flush();
		addEventListener('online', online);
		return () => removeEventListener('online', online);
	});
</script>

{#if pending.length}
	<aside class="pending" role="status">
		{#each pending as p (p.sessionId)}
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
		max-width: 40rem;
		margin: max(0.5rem, env(safe-area-inset-top)) auto 0;
		padding: 0.6rem 0.85rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		font-size: 0.9rem;
	}
	.pending p {
		margin: 0 0 0.25rem;
	}
	.actions {
		display: flex;
		gap: 0.75rem;
	}
</style>
