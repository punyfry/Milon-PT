<script lang="ts">
	import { dev } from '$app/environment';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let storageStatus = $state<string | null>(null);

	// --- import från Craft ---------------------------------------------------
	let importData = $state<unknown>(null);
	let importFile = $state('');
	let importResult = $state<{ applied: boolean; writes: number; summary: string[] } | null>(null);
	let importIssues = $state<string[]>([]);
	let importing = $state(false);

	async function runImport(apply: boolean) {
		importing = true;
		importIssues = [];
		try {
			const res = await fetch('/api/import', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ data: importData, apply })
			});
			const body = await res.json().catch(() => null);
			if (res.ok) importResult = body;
			else {
				importResult = null;
				importIssues = body?.issues ?? [body?.message ?? `Servern svarade ${res.status}`];
			}
		} catch {
			importIssues = ['Kunde inte nå servern.'];
		} finally {
			importing = false;
		}
	}

	async function onFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		importResult = null;
		importIssues = [];
		importData = null;
		if (!file) return;
		importFile = file.name;
		if (file.size > 1_000_000) {
			importIssues = ['Filen är för stor (max 1 MB).'];
			return;
		}
		try {
			importData = JSON.parse(await file.text());
		} catch {
			importIssues = ['Filen är inte giltig JSON.'];
			return;
		}
		await runImport(false);
	}

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

	{#if dev}
		<p><button onclick={testStorage}>Testa lagring</button></p>
		{#if storageStatus}<pre>{storageStatus}</pre>{/if}
	{/if}

	<section class="import">
		<h2>Importera från Craft</h2>
		<p class="meta">
			Välj JSON-filen. Först visas vad som skulle hända; inget sparas förrän du trycker på Importera. Samma fil kan
			köras igen utan dubbletter.
		</p>
		<input type="file" accept="application/json,.json" onchange={onFile} disabled={importing} aria-label="Importfil" />
		{#if importing}<p class="meta">Arbetar…</p>{/if}
		{#if importIssues.length}
			<div class="error" role="alert">
				<p>Filen kan inte importeras:</p>
				<ul>{#each importIssues as issue, i (i)}<li>{issue}</li>{/each}</ul>
			</div>
		{/if}
		{#if importResult}
			{#if importResult.applied}
				<p role="status"><strong>Klart:</strong> {importResult.writes} filer sparades från {importFile}.</p>
			{:else if importResult.writes === 0}
				<p role="status">Inget att importera, allt i {importFile} finns redan.</p>
			{:else}
				<p><strong>{importResult.writes} filer</strong> skulle sparas från {importFile}:</p>
			{/if}
			<pre class="plan">{importResult.summary.join('\n')}</pre>
			{#if !importResult.applied && importResult.writes > 0}
				<button onclick={() => runImport(true)} disabled={importing}>Importera</button>
			{/if}
		{/if}
	</section>

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
	.import {
		margin: 2rem 0;
		display: grid;
		gap: 0.6rem;
		justify-items: start;
	}
	.import h2 {
		font-size: 1.05rem;
		margin: 0;
	}
	.meta {
		color: var(--muted);
		font-size: 0.9rem;
		margin: 0;
	}
	.plan {
		width: 100%;
		max-height: 20rem;
		overflow: auto;
		font-size: 0.8rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.6rem;
		white-space: pre-wrap;
	}
</style>
