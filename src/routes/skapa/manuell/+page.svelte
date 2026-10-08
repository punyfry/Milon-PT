<script lang="ts">
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import ExerciseFields, { TYPE_LABEL } from '$lib/components/ExerciseFields.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Sheet from '$lib/components/Sheet.svelte';
	import VersionsSheet from '$lib/components/VersionsSheet.svelte';
	import { Issues, issueText, normalizeName, validateExerciseInput, type ExerciseType, type Target } from '$lib/model';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** One exercise in the workout being built: from the catalog, or written in and created on save. */
	interface Item {
		key: number;
		exerciseId?: string;
		newExercise?: { name: string; type: ExerciseType; instruction: string };
		name: string;
		type: ExerciseType;
		sets: number;
		/** Reps, or seconds for a timed exercise. */
		amount: number;
	}

	let nextKey = 0;
	const byId = $derived(new Map(data.catalog.map((e) => [e.id, e])));

	function fromWorkout(): Item[] {
		return (data.editing?.items ?? []).map((e) => {
			const ex = byId.get(e.exerciseId);
			return {
				key: nextKey++,
				exerciseId: e.exerciseId,
				name: ex?.name ?? e.exerciseId,
				type: ex?.type ?? ('seconds' in e.target ? 'time' : 'weight'),
				sets: e.sets,
				amount: 'seconds' in e.target ? e.target.seconds : e.target.reps
			};
		});
	}

	// svelte-ignore state_referenced_locally
	let name = $state(data.editing?.name ?? '');
	let items = $state<Item[]>(fromWorkout());
	let saved = $state(snapshot());
	let saving = $state(false);
	let failure = $state<string | null>(null);
	let notice = $state<{ text: string; slug: string } | null>(null);
	let versionsOpen = $state(false);

	const title = $derived(data.editing ? `Redigera ${data.editing.name}` : 'Skapa pass');
	const dirty = $derived(snapshot() !== saved);

	function snapshot() {
		return JSON.stringify({ name: name.trim(), items: items.map(({ key: _, ...rest }) => rest) });
	}

	/** Back to the stored workout, e.g. after saving or when another workout is opened. */
	function reset() {
		name = data.editing?.name ?? '';
		items = fromWorkout();
		saved = snapshot();
	}

	beforeNavigate((nav) => {
		if (dirty && !saving && !confirm('Passet är inte sparat. Lämna ändå?')) nav.cancel();
	});

	// --- the list -----------------------------------------------------------

	function move(i: number, d: -1 | 1) {
		const j = i + d;
		if (j < 0 || j >= items.length) return;
		[items[i], items[j]] = [items[j], items[i]];
	}

	function remove(i: number) {
		items.splice(i, 1);
	}

	function stepSets(item: Item, d: number) {
		item.sets = Math.min(20, Math.max(1, item.sets + d));
	}

	const unit = (type: ExerciseType) => (type === 'time' ? 'sekunder' : 'reps');
	const defaultAmount = (type: ExerciseType) => (type === 'time' ? 30 : 10);

	// --- adding -------------------------------------------------------------

	let adding = $state(false);
	let query = $state('');
	let writing = $state(false);
	let fresh = $state({ name: '', type: 'weight' as ExerciseType, instruction: '' });
	let addError = $state<string | null>(null);

	const inList = $derived(new Set(items.map((i) => i.exerciseId).filter(Boolean)));
	const candidates = $derived(
		data.catalog.filter((e) => !e.archived && !inList.has(e.id) && normalizeName(e.name).includes(normalizeName(query)))
	);

	function openAdd() {
		query = '';
		writing = false;
		addError = null;
		adding = true;
	}

	function add(item: Omit<Item, 'key' | 'sets' | 'amount'>) {
		items.push({ ...item, key: nextKey++, sets: 3, amount: defaultAmount(item.type) });
		adding = false;
	}

	function startWriting() {
		fresh = { name: query.trim(), type: 'weight', instruction: '' };
		addError = null;
		writing = true;
	}

	function addNew(e: SubmitEvent) {
		e.preventDefault();
		const issues = new Issues();
		const input = validateExerciseInput(fresh, issues, '');
		if (!input) return void (addError = issueText(issues.list[0] ?? 'Kontrollera övningen'));
		const key = normalizeName(input.name);
		const same = (n: string, t: ExerciseType) => t === input.type && normalizeName(n) === key;
		if (items.some((i) => same(i.name, i.type))) return void (addError = `${input.name} finns redan i passet.`);
		// The same exercise already exists: use it rather than creating a copy.
		const existing = data.catalog.find((c) => !c.archived && same(c.name, c.type));
		if (existing) return add({ exerciseId: existing.id, name: existing.name, type: existing.type });
		add({ newExercise: input, name: input.name, type: input.type });
	}

	// --- saving -------------------------------------------------------------

	const target = (item: Item): Target => (item.type === 'time' ? { seconds: item.amount } : { reps: item.amount });

	async function save() {
		if (saving) return;
		saving = true;
		failure = null;
		notice = null;
		try {
			const res = await fetch('/api/workouts', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					editSlug: data.editing?.slug ?? null,
					name,
					items: items.map((i) => ({
						...(i.exerciseId ? { exerciseId: i.exerciseId } : { newExercise: i.newExercise }),
						sets: i.sets,
						target: target(i)
					}))
				})
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.message ?? `Servern svarade ${res.status}`);
			saved = snapshot();
			if (data.editing?.slug !== body.slug) await goto(`/skapa/manuell?pass=${body.slug}`, { invalidateAll: true });
			else await invalidateAll();
			reset();
			notice = { text: body.saved ? `Sparat som version ${body.version}.` : 'Inga ändringar att spara.', slug: body.slug };
		} catch (e) {
			failure = e instanceof Error ? e.message : 'Kunde inte spara passet. Försök igen.';
		} finally {
			saving = false;
		}
	}

	async function restore(version: number) {
		if (!data.editing || !confirm(`Återställa version ${version}? Den sparas som en ny version.`)) return;
		const res = await fetch(`/api/workouts/${data.editing.slug}/restore`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ version })
		});
		if (!res.ok) return void (failure = 'Kunde inte återställa versionen.');
		versionsOpen = false;
		await invalidateAll();
		reset();
	}
</script>

<svelte:head><title>{title} · Milon-PT</title></svelte:head>

<div class="page">
	<header class="top">
		<h1>{title}</h1>
		<div class="actions">
			{#if data.versions.length}<button class="btn small" onclick={() => (versionsOpen = true)}>Versioner</button>{/if}
			{#if data.editing}<a class="btn small" href="/skapa/manuell">Nytt pass</a>{/if}
		</div>
	</header>

	<main class="body">
		{#if !data.editing && data.workouts.length}
			<div class="existing">
				<span class="label">Eller ändra ett befintligt pass</span>
				<div class="chips">
					{#each data.workouts as w (w.slug)}<a class="btn small" href={`/skapa/manuell?pass=${w.slug}`}>{w.name}</a>{/each}
				</div>
			</div>
		{/if}

		<label class="field">
			<span class="label">Passets namn</span>
			<input bind:value={name} maxlength="60" placeholder="T.ex. Pass A" autocomplete="off" />
		</label>

		<section aria-label="Övningar">
			<span class="label">Övningar</span>
			{#if items.length}
				<ol class="items">
					{#each items as item, i (item.key)}
						<li>
							<div class="itemhead">
								<span class="itemname">
									<strong>{item.name}</strong>
									<span class="muted">{TYPE_LABEL[item.type]}{item.newExercise ? ' · ny övning' : ''}</span>
								</span>
								<span class="tools">
									<button type="button" class="icon-btn" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Flytta upp {item.name}"><Icon name="up" /></button>
									<button type="button" class="icon-btn" onclick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Flytta ner {item.name}"><Icon name="down" /></button>
									<button type="button" class="icon-btn" onclick={() => remove(i)} aria-label="Ta bort {item.name}"><Icon name="x" /></button>
								</span>
							</div>
							<div class="numbers">
								<div class="stepper" role="group" aria-label="Antal set för {item.name}">
									<button type="button" class="step" onclick={() => stepSets(item, -1)} disabled={item.sets <= 1} aria-label="Färre set">−</button>
									<span class="num">{item.sets}</span>
									<button type="button" class="step" onclick={() => stepSets(item, 1)} disabled={item.sets >= 20} aria-label="Fler set">+</button>
									<span class="muted">set ×</span>
								</div>
								<label class="amount">
									<input class="num" type="number" inputmode="numeric" min="1" max={item.type === 'time' ? 3600 : 999} bind:value={item.amount} aria-label="Mål i {unit(item.type)} för {item.name}" />
									<span class="muted">{unit(item.type)}</span>
								</label>
							</div>
						</li>
					{/each}
				</ol>
			{:else}
				<p class="muted">Inga övningar än.</p>
			{/if}
			<button type="button" class="btn full" onclick={openAdd}><Icon name="plus" /> Lägg till övning</button>
		</section>

		{#if data.coach}
			<a class="coach" href={data.editing ? `/skapa?pass=${data.editing.slug}` : '/skapa'}>Bygg med Milon i stället</a>
		{/if}
	</main>

	<footer class="bar">
		{#if failure}<p class="error" role="alert">{failure}</p>{/if}
		{#if notice && !dirty}
			<p class="saved" role="status">{notice.text} <a href={`/pass/${notice.slug}`}>Starta passet</a></p>
		{/if}
		<button class="btn primary full" onclick={save} disabled={saving || !items.length || !name.trim() || (!!data.editing && !dirty)}>
			{saving ? 'Sparar…' : 'Spara pass'}
		</button>
	</footer>
</div>

{#if adding}
	<Sheet title="Lägg till övning" onclose={() => (adding = false)}>
		<div class="sheethead">
			<h2>Lägg till övning</h2>
			<button type="button" class="icon-btn" onclick={() => (adding = false)} aria-label="Stäng"><Icon name="x" /></button>
		</div>
		{#if writing}
			<form class="new" onsubmit={addNew}>
				<ExerciseFields bind:name={fresh.name} bind:type={fresh.type} bind:instruction={fresh.instruction} idPrefix="add-new" />
				{#if addError}<p class="error" role="alert">{addError}</p>{/if}
				<button type="submit" class="btn primary full">Lägg till {fresh.name.trim() || 'övningen'}</button>
				<button type="button" class="btn ghost full" onclick={() => (writing = false)}>Tillbaka till listan</button>
			</form>
		{:else}
			<input class="search" type="search" bind:value={query} placeholder="Sök bland dina övningar" aria-label="Sök övning" enterkeyhint="search" />
			{#if candidates.length}
				<ul class="list">
					{#each candidates as c (c.id)}
						<li>
							<button type="button" class="row" onclick={() => add({ exerciseId: c.id, name: c.name, type: c.type })}>
								<span class="name">{c.name}</span>
								<span class="meta">{TYPE_LABEL[c.type]}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted">{query.trim() ? `Ingen övning matchar "${query.trim()}".` : 'Inga fler övningar finns än.'}</p>
			{/if}
			<button type="button" class="btn full" onclick={startWriting}><Icon name="plus" /> Skriv in en ny övning</button>
		{/if}
	</Sheet>
{/if}

{#if versionsOpen && data.editing}
	<VersionsSheet name={data.editing.name} versions={data.versions} onrestore={restore} onclose={() => (versionsOpen = false)} />
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
	.actions {
		display: flex;
		gap: 8px;
	}
	.body {
		flex: 1;
		padding: 16px 20px;
		display: grid;
		align-content: start;
		gap: 20px;
	}
	.existing,
	.field,
	section {
		display: grid;
		gap: 8px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	input {
		width: 100%;
		min-height: 48px;
		padding: 0 14px;
		border-radius: var(--radius);
		border: 1px solid var(--line);
		background: var(--surface-2);
		color: var(--text);
		font: inherit;
	}
	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 10px;
	}
	.items li {
		background: var(--surface);
		border-radius: var(--radius);
		padding: 10px 12px 12px;
		display: grid;
		gap: 8px;
	}
	.itemhead {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 8px;
	}
	.itemname {
		display: grid;
		gap: 2px;
		padding-top: 6px;
		overflow-wrap: anywhere;
	}
	.itemname .muted {
		font-size: 13px;
	}
	.tools {
		display: flex;
		flex-shrink: 0;
	}
	.tools .icon-btn:disabled {
		opacity: 0.3;
	}
	.numbers {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.stepper {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.stepper .num {
		min-width: 24px;
		text-align: center;
		font-size: 18px;
	}
	.step {
		width: 40px;
		height: 40px;
		border-radius: 12px;
		border: 0;
		background: var(--step);
		font-family: var(--mono);
		font-size: 18px;
		cursor: pointer;
	}
	.step:disabled {
		opacity: 0.4;
	}
	.amount {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.amount input {
		width: 80px;
		min-height: 40px;
		text-align: center;
	}
	.coach {
		font-size: 14px;
	}
	.bar {
		position: sticky;
		bottom: var(--tabbar-h);
		z-index: 5;
		background: var(--bg);
		border-top: 1px solid var(--line);
		padding: 10px 20px 12px;
		display: grid;
		gap: 8px;
	}
	.bar p {
		margin: 0;
		font-size: 14px;
	}
	.saved {
		font-weight: 600;
	}
	.sheethead {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	h2 {
		font-size: 20px;
		font-weight: 600;
	}
	.new {
		display: grid;
		gap: 12px;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		max-height: 45dvh;
		overflow: auto;
	}
	.row {
		width: 100%;
		min-height: 52px;
		display: grid;
		gap: 2px;
		text-align: left;
		padding: 8px 2px;
		background: none;
		border: 0;
		border-bottom: 1px solid var(--line);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.name {
		font-weight: 500;
	}
	.meta {
		font-size: 13px;
		color: var(--muted);
	}
</style>
