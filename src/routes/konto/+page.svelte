<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Sheet from '$lib/components/Sheet.svelte';
	import { notesDiff, type CoachNotes } from '$lib/model';
	import { pendingSaves } from '$lib/session/outbox';
	import { clearUserData, loadActiveSession } from '$lib/session/storage';
	import { applyTheme, loadTheme, type Theme } from '$lib/theme';
	import type { SubmitFunction } from '@sveltejs/kit';
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

	// --- sign-out -------------------------------------------------------------
	// Signing out empties what the app keeps in the browser. A workout in progress or
	// waiting to be sent would be lost, so that is confirmed first.
	let signoutForm: HTMLFormElement | undefined = $state();
	let signoutWarning = $state<{ active: boolean; pending: number } | null>(null);
	let signoutConfirmed = false;

	function onSignout(e: SubmitEvent) {
		if (!signoutConfirmed) {
			const active = loadActiveSession(page.data.userId);
			const warning = { active: Boolean(active && !active.preparing), pending: pendingSaves(page.data.userId).length };
			if (warning.active || warning.pending) {
				e.preventDefault();
				signoutWarning = warning;
				return;
			}
		}
		clearUserData(page.data.userId);
	}

	function confirmSignout() {
		signoutConfirmed = true;
		signoutWarning = null;
		signoutForm?.requestSubmit();
	}

	const signoutText = $derived.by(() => {
		if (!signoutWarning) return '';
		const { active, pending } = signoutWarning;
		const unsent = pending === 1 ? 'ett pass som inte har skickats än' : `${pending} pass som inte har skickats än`;
		const what = [...(active ? ['ett pågående pass'] : []), ...(pending ? [unsent] : [])].join(' och ');
		const several = (active && pending > 0) || pending > 1;
		return `På den här enheten finns ${what}. ${several ? 'De raderas' : 'Det raderas'} när du loggar ut.`;
	});

	// --- delete account ---------------------------------------------------------
	// The server deletes every file; the page then empties the browser's copy and signs out.
	let confirmDeleteAccount = $state(false);
	let deletingAccount = $state(false);
	let deleteError = $state('');

	function closeDeleteAccount() {
		if (deletingAccount) return;
		confirmDeleteAccount = false;
		deleteError = '';
	}

	const enhanceDeleteAccount: SubmitFunction = () => {
		deletingAccount = true;
		deleteError = '';
		return async ({ result }) => {
			if (result.type === 'success') {
				confirmDeleteAccount = false;
				signoutConfirmed = true;
				clearUserData(page.data.userId);
				signoutForm?.requestSubmit();
				return;
			}
			// Kept in the sheet, so a lost network doesn't end on an error page.
			deletingAccount = false;
			deleteError =
				result.type === 'failure' && typeof result.data?.deleteError === 'string'
					? result.data.deleteError
					: 'Kunde inte nå servern. Inget har raderats, försök igen.';
		};
	};

	// --- what Milon knows (#110) -------------------------------------------
	// Milon proposes new lists from what the user says has changed; nothing is saved until "Spara ändringarna".
	let change = $state('');
	let asking = $state(false);
	let askError = $state('');
	let proposal = $state<{ base: CoachNotes; proposal: CoachNotes; summary: string } | null>(null);
	const diff = $derived(proposal ? notesDiff(proposal.base, proposal.proposal) : null);
	const noChange = $derived(
		diff ? !diff.rules.added.length && !diff.rules.removed.length && !diff.context.added.length && !diff.context.removed.length : false
	);
	const notesCount = $derived(data.notes.rules.length + data.notes.context.length);

	async function askMilon(e: SubmitEvent) {
		e.preventDefault();
		if (asking || !change.trim()) return;
		asking = true;
		askError = '';
		proposal = null;
		try {
			const res = await fetch('/api/notes', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ change })
			});
			const body = await res.json().catch(() => null);
			if (res.ok) proposal = body;
			else askError = body?.message ?? `Servern svarade ${res.status}`;
		} catch {
			askError = 'Kunde inte nå servern. Försök igen.';
		} finally {
			asking = false;
		}
	}

	const enhanceNotes: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success') {
				proposal = null;
				change = '';
			}
			await update({ reset: false });
		};
	};

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

		{#if data.aiConfigured}
			<section class="notes" aria-labelledby="notes-title">
				<div class="t">
					<h2 id="notes-title">Det här vet Milon om dig</h2>
					<span>{notesCount ? 'Milon tar hänsyn till det när han bygger pass och svarar' : 'Inget än. Det du sparar från frågorna i Skapa hamnar här.'}{form?.notesSaved ? ' · sparat' : ''}</span>
				</div>
				{#each [['rules', 'Regler'], ['context', 'Om dig']] as const as [kind, label] (kind)}
					{#if data.notes[kind].length}
						<h3 class="label">{label}</h3>
						<ul class="notelist">
							{#each data.notes[kind] as text (text)}
								<li>
									<span>{text}</span>
									<form method="POST" action="?/forget" use:enhance={enhanceNotes}>
										<input type="hidden" name="kind" value={kind} />
										<input type="hidden" name="text" value={text} />
										<button class="btn small ghost" aria-label="Ta bort: {text}">Ta bort</button>
									</form>
								</li>
							{/each}
						</ul>
					{/if}
				{/each}
				{#if form?.notesError}<p class="error" role="alert">{form.notesError}</p>{/if}

				{#if data.coach}
					<form class="ask" onsubmit={askMilon}>
						<label for="notes-change">Har något ändrats? Berätta för Milon</label>
						<textarea id="notes-change" rows="2" maxlength="500" bind:value={change} placeholder="T.ex. ”knät är bra nu” eller ”jag tränar hemma i stället”"></textarea>
						<button class="btn" disabled={asking || !change.trim()}>{asking ? 'Milon tänker…' : 'Fråga Milon'}</button>
					</form>
					{#if askError}<p class="error" role="alert">{askError}</p>{/if}
					{#if proposal && diff}
						<div class="proposal" role="status">
							{#if proposal.summary}<p>{proposal.summary}</p>{/if}
							{#if noChange}
								<p class="muted">Milon föreslår ingen ändring.</p>
							{:else}
								<ul class="changes">
									{#each [...diff.rules.removed, ...diff.context.removed] as text (text)}<li class="removed"><span class="sr-only">Tas bort:</span> {text}</li>{/each}
									{#each [...diff.rules.added, ...diff.context.added] as text (text)}<li class="added"><span class="sr-only">Läggs till:</span> {text}</li>{/each}
								</ul>
								<form method="POST" action="?/notes" use:enhance={enhanceNotes}>
									<input type="hidden" name="base" value={JSON.stringify(proposal.base)} />
									<input type="hidden" name="proposal" value={JSON.stringify(proposal.proposal)} />
									<button class="btn primary full">Spara ändringarna</button>
								</form>
							{/if}
							<button type="button" class="btn ghost full" onclick={() => (proposal = null)}>{noChange ? 'Stäng' : 'Avbryt'}</button>
						</div>
					{/if}
				{/if}
			</section>
		{/if}

		<div class="row">
			<div class="t">Tema<span>Följer telefonen som standard</span></div>
			<div class="seg" role="group" aria-label="Tema">
				{#each [['system', 'System'], ['dark', 'Mörkt'], ['light', 'Ljust']] as const as [key, label] (key)}
					<button type="button" aria-pressed={theme === key} onclick={() => setTheme(key)}>{label}</button>
				{/each}
			</div>
		</div>

		{#if data.canImport}
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
		{/if}

		<div class="row">
			<div class="t">Introt<span>Milons historia och hur appen fungerar</span></div>
			<a class="btn small" href="/valkommen">Visa igen</a>
		</div>
	</div>

	<form method="POST" action="/signout" class="logout" bind:this={signoutForm} onsubmit={onSignout}>
		<input type="hidden" name="redirectTo" value="/login" />
		<button type="submit" class="btn full">Logga ut</button>
	</form>

	<button type="button" class="btn ghost full danger delete-account" onclick={() => (confirmDeleteAccount = true)}>Radera konto</button>
</main>

{#if confirmDeleteAccount}
	<Sheet title="Radera konto" onclose={closeDeleteAccount}>
		<h2 class="sheet-title">Radera kontot?</h2>
		<p class="muted">
			Allt du har sparat raderas: pass, övningar, historik, mål och samtal med Milon. Det går inte att ångra. Du loggas ut, och loggar du in igen
			börjar du från början.
		</p>
		{#if deleteError}<p class="error" role="alert">{deleteError}</p>{/if}
		<button class="btn primary full" onclick={closeDeleteAccount} disabled={deletingAccount}>Avbryt</button>
		<form method="POST" action="?/deleteAccount" use:enhance={enhanceDeleteAccount}>
			<button type="submit" class="btn ghost full danger" disabled={deletingAccount}>{deletingAccount ? 'Raderar…' : 'Radera allt'}</button>
		</form>
	</Sheet>
{/if}

{#if signoutWarning}
	<Sheet title="Logga ut" onclose={() => (signoutWarning = null)}>
		<h2 class="sheet-title">Logga ut?</h2>
		<p class="muted">{signoutText}</p>
		<button class="btn primary full" onclick={() => (signoutWarning = null)}>Avbryt</button>
		<button class="btn full" onclick={confirmSignout}>Logga ut ändå</button>
	</Sheet>
{/if}

<style>
	.sheet-title {
		font-size: 20px;
		font-weight: 600;
	}
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
	.notes {
		display: grid;
		gap: 10px;
		padding: 16px 0;
		border-bottom: 1px solid var(--line);
	}
	.notes h2 {
		font-size: 16px;
		font-weight: 500;
	}
	.notes h3 {
		margin: 4px 0 0;
	}
	.notelist,
	.changes {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.notelist li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		background: var(--surface);
		border-radius: 12px;
		padding: 6px 6px 6px 14px;
		font-size: 14px;
		overflow-wrap: anywhere;
	}
	.ask {
		display: grid;
		gap: 8px;
		margin-top: 6px;
		font-size: 14px;
	}
	.ask textarea {
		width: 100%;
		min-height: 48px;
		border-radius: var(--radius);
		border: 0;
		background: var(--surface-2);
		padding: 12px 14px;
		resize: vertical;
	}
	.proposal {
		display: grid;
		gap: 8px;
		background: var(--surface);
		border-radius: var(--radius);
		padding: 14px;
	}
	.proposal p {
		margin: 0;
	}
	.changes li {
		font-size: 14px;
		overflow-wrap: anywhere;
	}
	.changes .removed {
		color: var(--muted);
		text-decoration: line-through;
	}
	.changes .removed::before {
		content: '− ';
	}
	.changes .added::before {
		content: '+ ';
		color: var(--accent);
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
	.delete-account {
		margin-top: 12px;
	}
	.danger {
		color: var(--danger);
	}
	.error p {
		margin: 12px 0 4px;
	}
</style>
