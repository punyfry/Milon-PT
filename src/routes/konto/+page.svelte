<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let storageStatus = $state<string | null>(null);

	async function testStorage() {
		storageStatus = 'Testar…';
		const res = await fetch('/api/storage/selftest', { method: 'POST' });
		const body = await res.json().catch(() => null);
		storageStatus = res.ok ? `OK: ${JSON.stringify(body)}` : `Fel ${res.status}: ${body?.message ?? ''}`;
	}
</script>

<svelte:head><title>Konto · Milon-PT</title></svelte:head>

<main>
	<p><a href="/">← Tillbaka</a></p>
	<h1>Konto</h1>
	<p>Inloggad som {data.user?.name ?? data.user?.email}</p>
	<p><small>Användar-ID (för importskriptet): <code>{data.user?.id}</code></small></p>

	<form method="POST" action="?/goal" class="goal">
		<label for="goal">Veckomål (pass per vecka)</label>
		<div class="row">
			<input id="goal" name="weeklySessionGoal" type="number" inputmode="numeric" min="0" max="14" value={data.weeklySessionGoal ?? ''} />
			<button type="submit">Spara</button>
		</div>
	</form>
	{#if form?.goalError}<p class="error" role="alert">{form.goalError}</p>{/if}
	{#if form?.goalSaved}<p role="status">Veckomålet är sparat.</p>{/if}

	<p><button onclick={testStorage}>Testa lagring</button></p>
	{#if storageStatus}<pre>{storageStatus}</pre>{/if}

	<form method="POST" action="/signout">
		<input type="hidden" name="redirectTo" value="/login" />
		<button type="submit">Logga ut</button>
	</form>
</main>

<style>
	.goal {
		display: grid;
		gap: 0.25rem;
		margin: 1rem 0;
	}
	.goal .row {
		display: flex;
		gap: 0.5rem;
	}
	.goal input {
		width: 5rem;
		font: inherit;
		padding: 0.4rem;
	}
	.error {
		color: var(--danger);
	}
</style>
