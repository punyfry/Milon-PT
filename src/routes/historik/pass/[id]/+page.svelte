<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import Sheet from '$lib/components/Sheet.svelte';
	import { formatDuration, formatSet } from '$lib/format';
	import type { ExerciseType } from '$lib/model';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const s = $derived(data.session);
	const startDate = $derived(s.startedAt.slice(0, 10));
	const longDate = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
	const shortDate = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
	/** "18:05", or "8 okt 09:30" when the session ended on another day. */
	const endText = $derived(s.endedAt.slice(0, 10) === startDate ? s.endedAt.slice(11, 16) : `${shortDate(s.endedAt.slice(0, 10))} ${s.endedAt.slice(11, 16)}`);

	// --- editing ------------------------------------------------------------

	/** Values as typed, so a half-typed "42," doesn't jump. */
	interface DraftSet {
		weight: string;
		reps: string;
		seconds: string;
	}
	interface Draft {
		startTime: string;
		end: string;
		kcal: string;
		exercises: { id: string; name: string; type: ExerciseType; removed: boolean; sets: DraftSet[]; note: string }[];
	}
	let draft = $state<Draft | null>(null);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let confirmDelete = $state(false);

	/** Exact values (no rounding or thousands separator), with a decimal comma. */
	function toDraft(set: { weight?: number; reps?: number; seconds?: number }): DraftSet {
		return { weight: String(set.weight ?? 0).replace('.', ','), reps: String(set.reps ?? 0), seconds: String(set.seconds ?? 0) };
	}

	function failure(e: unknown): string {
		if (e instanceof TypeError) return 'Ingen anslutning. Försök igen när du har nät.';
		return e instanceof Error ? e.message : 'Något gick fel. Försök igen.';
	}

	function edit() {
		error = null;
		draft = {
			startTime: s.startedAt.slice(11, 16),
			end: s.endedAt.slice(0, 16),
			kcal: s.kcalEstimate === undefined ? '' : String(s.kcalEstimate),
			exercises: data.exercises.map((e) => ({ id: e.id, name: e.name, type: e.type, removed: false, sets: e.sets.map(toDraft), note: e.note ?? '' }))
		};
	}

	const kept = $derived(draft ? draft.exercises.filter((e) => !e.removed).length : 0);

	/** Typed values to sets; null if something is not a number. */
	function toSets(type: ExerciseType, sets: DraftSet[]) {
		const int = (v: string) => (/^\d{1,5}$/.test(v.trim()) ? Number(v.trim()) : NaN);
		const out = sets.map((d) => {
			if (type === 'weight') {
				const raw = d.weight.replace(',', '.').trim();
				return { weight: /^\d{1,4}(\.\d+)?$/.test(raw) ? Number(raw) : NaN, reps: int(d.reps) };
			}
			return type === 'time' ? { seconds: int(d.seconds) } : { reps: int(d.reps) };
		});
		return out.every((set) => Object.values(set).every(Number.isFinite)) ? out : null;
	}

	async function save() {
		if (!draft || saving) return;
		const exercises = [];
		for (const e of draft.exercises.filter((x) => !x.removed)) {
			const sets = toSets(e.type, e.sets);
			if (!sets) return void (error = `Kontrollera värdena för ${e.name}.`);
			exercises.push({ exerciseId: e.id, sets, note: e.note.trim() });
		}
		const kcal = draft.kcal.trim();
		if (kcal && !(/^\d{1,4}$/.test(kcal) && Number(kcal) <= 5000)) return void (error = 'Ange kcal som ett heltal mellan 0 och 5000.');
		saving = true;
		error = null;
		try {
			const res = await fetch(`/api/sessions/${s.id}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					version: data.version,
					startTime: draft.startTime,
					end: draft.end,
					kcalEstimate: kcal ? Number(kcal) : null,
					exercises
				})
			});
			if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Servern svarade ${res.status}`);
			await invalidate('app:session');
			draft = null;
		} catch (e) {
			error = failure(e);
			// Part of the change may have been written; the view must show what is stored.
			await invalidate('app:session').catch(() => {});
		} finally {
			saving = false;
		}
	}

	async function remove() {
		saving = true;
		error = null;
		try {
			const res = await fetch(`/api/sessions/${s.id}`, {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ version: data.version })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Servern svarade ${res.status}`);
			await goto(`/historik?vecka=${startDate}`, { invalidateAll: true });
		} catch (e) {
			error = failure(e);
			confirmDelete = false;
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>{data.workoutName} · Historik · Milon-PT</title></svelte:head>

<header class="topbar">
	<a class="icon-btn" href={`/historik?vecka=${startDate}`} aria-label="Tillbaka till historik"><Icon name="left" /></a>
	<span class="label">Historik</span>
	<span></span>
</header>

<main>
	<div class="pagehead">
		<span class="label date">{longDate(startDate)}</span>
		<h1>{data.workoutName}</h1>
	</div>

	{#if !draft}
		<dl class="stats">
			<div><dt class="label">Start</dt><dd class="num">{s.startedAt.slice(11, 16)}</dd></div>
			<div><dt class="label">Slut</dt><dd class="num">{endText}</dd></div>
			<div><dt class="label">Tid</dt><dd class="num">{formatDuration(Date.parse(s.endedAt) - Date.parse(s.startedAt))}</dd></div>
			{#if s.kcalEstimate !== undefined}<div><dt class="label">Kcal</dt><dd class="num">{s.kcalEstimate}</dd></div>{/if}
		</dl>

		<ul class="exlist">
			{#each data.exercises as e (e.id)}
				<li>
					<a class="exname" href={`/historik/ovning/${e.id}`}>{e.name}</a>
					<span class="sets num">{e.sets.map((set) => formatSet(e.type, set)).join(' · ')}</span>
					{#if e.note}<p class="note">{e.note}</p>{/if}
				</li>
			{:else}
				<li class="muted">Inga set sparade.</li>
			{/each}
		</ul>

		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<div class="buttons">
			<button class="btn primary full" onclick={edit}>Redigera</button>
			<button class="btn ghost full" onclick={() => (confirmDelete = true)}>Ta bort pass</button>
		</div>
	{:else}
		<section class="times" aria-label="Tider">
			<label>
				<span class="label">Start · {shortDate(startDate)}</span>
				<input type="time" bind:value={draft.startTime} required />
			</label>
			<label>
				<span class="label">Slut</span>
				<input type="datetime-local" bind:value={draft.end} min={`${startDate}T00:00`} required />
			</label>
			<label>
				<span class="label">Kcal</span>
				<input type="text" inputmode="numeric" bind:value={draft.kcal} placeholder="–" />
			</label>
		</section>

		{#each draft.exercises as e, ei (e.id)}
			<section class="excard" class:removed={e.removed} aria-label={e.name}>
				<div class="exhead">
					<h2>{e.name}</h2>
					{#if e.removed}
						<button class="link" onclick={() => (e.removed = false)}>Ångra</button>
					{:else}
						<button class="link" disabled={kept <= 1} onclick={() => (e.removed = true)}>Ta bort övningen</button>
					{/if}
				</div>
				{#if e.removed}
					<p class="muted small">Tas bort ur passet när du sparar.</p>
				{:else}
					<!-- Not named "set": that clashes with the setter Svelte generates for the bindings. -->
					{#each e.sets as row, si (si)}
						<div class="setrow">
							<span class="n num">{si + 1}</span>
							{#if e.type === 'weight'}
								<label><input class="num" type="text" inputmode="decimal" bind:value={row.weight} aria-label="Vikt i kg, set {si + 1}" /><small>kg</small></label>
								<label><input class="num" type="text" inputmode="numeric" bind:value={row.reps} aria-label="Reps, set {si + 1}" /><small>reps</small></label>
							{:else if e.type === 'time'}
								<label><input class="num" type="text" inputmode="numeric" bind:value={row.seconds} aria-label="Sekunder, set {si + 1}" /><small>s</small></label>
							{:else}
								<label><input class="num" type="text" inputmode="numeric" bind:value={row.reps} aria-label="Reps, set {si + 1}" /><small>reps</small></label>
							{/if}
							<button
								class="icon-btn"
								disabled={e.sets.length <= 1}
								onclick={() => draft!.exercises[ei].sets.splice(si, 1)}
								aria-label="Ta bort set {si + 1}"><Icon name="x" /></button
							>
						</div>
					{/each}
					<button class="btn small" onclick={() => e.sets.push({ ...e.sets[e.sets.length - 1] })}><Icon name="plus" /> Lägg till set</button>
					<label class="notefield">
						<span class="label">Anteckning</span>
						<textarea bind:value={e.note} maxlength="1000" rows="2" placeholder="T.ex. prova 25 kg nästa gång"></textarea>
					</label>
				{/if}
			</section>
		{/each}

		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<div class="buttons">
			<button class="btn primary full" onclick={save} disabled={saving}>{saving ? 'Sparar…' : 'Spara ändringar'}</button>
			<button class="btn ghost full" onclick={() => (draft = null)} disabled={saving}>Avbryt</button>
		</div>
	{/if}
</main>

{#if confirmDelete}
	<Sheet title="Ta bort passet?" onclose={() => (confirmDelete = false)}>
		<h2 class="sheet-title">Ta bort passet?</h2>
		<p class="muted">{data.workoutName} {longDate(startDate)} och alla dess set tas bort ur historiken. Det går inte att ångra.</p>
		<button class="btn primary full" onclick={remove} disabled={saving}>{saving ? 'Tar bort…' : 'Ta bort passet'}</button>
		<button class="btn ghost full" onclick={() => (confirmDelete = false)}>Avbryt</button>
	</Sheet>
{/if}

<style>
	.topbar {
		position: sticky;
		top: 0;
		z-index: 5;
		max-width: 30rem;
		margin: 0 auto;
		height: calc(56px + env(safe-area-inset-top, 0px));
		padding: env(safe-area-inset-top, 0px) 8px 0 6px;
		display: grid;
		grid-template-columns: 56px 1fr 56px;
		align-items: center;
		text-align: center;
		background: var(--bg);
	}
	main {
		padding-top: 0;
	}
	.date::first-letter {
		text-transform: uppercase;
	}
	.stats {
		margin: 20px 0 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.stats div {
		background: var(--surface);
		border-radius: var(--radius);
		padding: 10px 12px;
	}
	.stats dd {
		margin: 2px 0 0;
		font-size: 17px;
	}
	.exlist {
		list-style: none;
		margin: 20px 0 0;
		padding: 0;
	}
	.exlist li {
		padding: 12px 0;
		border-bottom: 1px solid var(--line);
		display: grid;
		gap: 4px;
	}
	.exname {
		font-weight: 500;
		color: var(--text);
		text-decoration: none;
	}
	.sets {
		font-size: 14px;
		color: var(--soft);
	}
	.note {
		margin: 0;
		font-size: 14px;
		color: var(--muted);
		white-space: pre-line;
	}
	.buttons {
		margin-top: 24px;
		display: grid;
		gap: 8px;
	}
	.times {
		margin-top: 20px;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.times label {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	.times label:nth-child(2) {
		grid-column: span 2;
		grid-row: 2;
	}
	input {
		width: 100%;
		min-width: 0;
		min-height: 44px;
		padding: 0 12px;
		border-radius: 12px;
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.excard {
		margin-top: 16px;
		padding: 14px 16px;
		border-radius: var(--radius);
		background: var(--surface);
		display: grid;
		gap: 8px;
		justify-items: start;
	}
	.excard.removed h2 {
		text-decoration: line-through;
		color: var(--muted);
	}
	.exhead {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	.exhead h2 {
		font-size: 18px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.link {
		background: none;
		border: 0;
		padding: 8px 0;
		color: var(--muted);
		font: inherit;
		font-size: 14px;
		text-decoration: underline;
		cursor: pointer;
		white-space: nowrap;
	}
	.link:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.setrow {
		width: 100%;
		display: grid;
		grid-template-columns: 20px 1fr 1fr 44px;
		gap: 8px;
		align-items: center;
	}
	.setrow label {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.setrow label:only-of-type {
		grid-column: span 2;
	}
	.setrow input {
		background: var(--surface-2);
	}
	.setrow small {
		color: var(--muted);
		font-size: 12px;
	}
	.n {
		color: var(--muted);
		font-size: 13px;
	}
	.notefield {
		width: 100%;
		display: grid;
		gap: 4px;
	}
	textarea {
		width: 100%;
		padding: 10px 12px;
		border-radius: 12px;
		border: 1px solid var(--line);
		background: var(--surface-2);
		color: var(--text);
		font: inherit;
		resize: vertical;
	}
	.small {
		margin: 0;
		font-size: 14px;
	}
</style>
