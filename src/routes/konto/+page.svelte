<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { applyTheme, loadTheme, type Theme } from '$lib/theme';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	let goal = $state(data.weeklySessionGoal ?? 0);
	let goalForm: HTMLFormElement | undefined = $state();
	let theme = $state<Theme>('system');
	onMount(() => (theme = loadTheme()));

	function setTheme(t: Theme) {
		theme = t;
		applyTheme(t);
	}

	function stepGoal(d: number) {
		goal = Math.min(14, Math.max(0, (goal || 0) + d));
		// Saved right away; the form also works without JavaScript.
		queueMicrotask(() => goalForm?.requestSubmit());
	}

	// --- Craft import -------------------------------------------------------
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
</script>

<svelte:head><title>Konto · Milon-PT</title></svelte:head>

<main>
	<div class="pagehead">
		<span class="label">Konto</span>
		<h1>{data.user?.name ?? 'Konto'}</h1>
		{#if data.user?.email}<span class="muted email">{data.user.email}</span>{/if}
	</div>

	<div class="rows">
		<form method="POST" action="?/goal" class="row" bind:this={goalForm} use:enhance={() => ({ update }) => update({ reset: false })}>
			<div class="t">
				<label for="goal">Veckomål</label>
				<span>Pass per vecka{form?.goalSaved ? ' · sparat' : ''}</span>
			</div>
			<div class="stepper">
				<button type="button" class="step" onclick={() => stepGoal(-1)} aria-label="Minska veckomål" disabled={goal <= 0}>−</button>
				<input id="goal" class="num" name="weeklySessionGoal" type="number" inputmode="numeric" min="0" max="14" bind:value={goal} onchange={() => goalForm?.requestSubmit()} />
				<button type="button" class="step" onclick={() => stepGoal(1)} aria-label="Öka veckomål" disabled={goal >= 14}>+</button>
			</div>
		</form>
		{#if form?.goalError}<p class="error" role="alert">{form.goalError}</p>{/if}

		{#if data.aiConfigured}
			<form method="POST" action="?/coach" class="row" use:enhance={() => ({ update }) => update({ reset: false })}>
				<div class="t">
					Milon
					<span>{data.coach ? 'Hjälper dig bygga pass och svarar under passet' : 'Avstängd, du bygger passen själv'}{form?.coachSaved ? ' · sparat' : ''}</span>
				</div>
				<div class="seg" role="group" aria-label="Milon">
					<button name="coach" value="on" aria-pressed={data.coach}>På</button>
					<button name="coach" value="off" aria-pressed={!data.coach}>Av</button>
				</div>
			</form>
			{#if form?.coachError}<p class="error" role="alert">{form.coachError}</p>{/if}
		{/if}

		<div class="row">
			<div class="t">Tema<span>Följer telefonen som standard</span></div>
			<div class="seg" role="group" aria-label="Tema">
				{#each [['system', 'System'], ['dark', 'Mörkt'], ['light', 'Ljust']] as const as [key, label] (key)}
					<button type="button" aria-pressed={theme === key} onclick={() => setTheme(key)}>{label}</button>
				{/each}
			</div>
		</div>

		<section class="import" id="import">
			<div class="row">
				<div class="t">Importera från Craft<span>Visas först, sparas när du trycker Importera</span></div>
				<label class="btn small file">
					Välj fil
					<input type="file" accept="application/json,.json" onchange={onFile} disabled={importing} class="sr-only" />
				</label>
			</div>
			{#if importing}<p class="muted">Arbetar…</p>{/if}
			{#if importIssues.length}
				<div class="error" role="alert">
					<p>{importFile || 'Filen'} kan inte importeras:</p>
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
					<button class="btn primary full" onclick={() => runImport(true)} disabled={importing}>Importera</button>
				{/if}
			{/if}
		</section>

		<div class="row">
			<div class="t">Introt<span>Milons historia och hur appen fungerar</span></div>
			<a class="btn small" href="/valkommen">Visa igen</a>
		</div>
	</div>

	<form method="POST" action="/signout" class="logout">
		<input type="hidden" name="redirectTo" value="/login" />
		<button type="submit" class="btn full">Logga ut</button>
	</form>
</main>

<style>
	.email {
		font-size: 14px;
	}
	.rows {
		margin-top: 20px;
		border-top: 1px solid var(--line);
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		min-height: 68px;
		border-bottom: 1px solid var(--line);
	}
	.t {
		display: grid;
	}
	.t span {
		font-size: 13px;
		color: var(--muted);
	}
	.stepper {
		display: flex;
		align-items: center;
		gap: 3px;
	}
	.stepper input {
		width: 44px;
		text-align: center;
		font-size: 20px;
		font-weight: 500;
		background: none;
		border: 0;
		-moz-appearance: textfield;
		appearance: textfield;
	}
	.stepper input::-webkit-inner-spin-button {
		display: none;
	}
	.step {
		width: 44px;
		height: 44px;
		border-radius: 14px;
		border: 0;
		background: var(--step);
		font-family: var(--mono);
		font-size: 18px;
		cursor: pointer;
	}
	.step:disabled {
		opacity: 0.4;
	}
	.seg {
		display: inline-flex;
		background: var(--surface-2);
		border-radius: 14px;
		padding: 3px;
		gap: 3px;
	}
	.seg button {
		min-height: 38px;
		border: 0;
		background: none;
		border-radius: 11px;
		padding: 0 12px;
		font-size: 14px;
		font-weight: 500;
		color: var(--soft);
		cursor: pointer;
	}
	.seg button[aria-pressed='true'] {
		background: var(--bg);
		color: var(--text);
	}
	.file {
		cursor: pointer;
	}
	.import {
		display: grid;
		gap: 10px;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--line);
	}
	.import .row {
		border-bottom: 0;
	}
	.import p {
		margin: 0;
	}
	.plan {
		max-height: 20rem;
		overflow: auto;
		margin: 0;
		font-family: var(--mono);
		font-size: 12px;
		background: var(--surface);
		border-radius: 10px;
		padding: 10px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.logout {
		margin-top: 28px;
	}
	.error p {
		margin: 12px 0 4px;
	}
</style>
